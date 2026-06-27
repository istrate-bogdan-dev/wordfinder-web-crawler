"""
crawler.py — Asynchronous, bounded crawling engine, with:
- controlled concurrency (global semaphore + per-domain rate limit)
- retry with exponential backoff on transient errors
- robots.txt compliance
- BFS bounded by depth, page count, and origin domain

Design decision: the crawler is an event generator (async generator),
not a function that returns a final result. This lets the UI receive
live updates (page in progress, match found, error) as they happen,
without coupling the crawler to the WebSocket transport.
"""

from __future__ import annotations

import asyncio
import ipaddress
import os
import re
import socket
import time
import urllib.robotparser as robotparser
from collections import deque
from dataclasses import dataclass, field
from typing import AsyncGenerator, Literal, Optional, cast
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse, urldefrag

import httpx
import httpcore
from bs4 import BeautifulSoup

USER_AGENT = "WordFinderBot/1.0 (+POC terminology audit tool)"
MAX_SNIPPETS_PER_PAGE = 25
MAX_DEPTH = 4
MAX_PAGES = 200
MAX_CONCURRENCY = 10
MatchMode = Literal["exact_word", "partial", "phrase"]
SearchScope = Literal["visible_text", "visible_plus_metadata", "full_html"]
PageStatus = Literal["ok", "error", "skipped_robots", "skipped_type", "no_match"]
CrawlEventType = Literal["page_done", "done"]

MATCH_MODES: tuple[MatchMode, ...] = ("exact_word", "partial", "phrase")
SEARCH_SCOPES: tuple[SearchScope, ...] = (
    "visible_text",
    "visible_plus_metadata",
    "full_html",
)
MAX_REDIRECTS = 5
MAX_RESPONSE_BYTES = 5 * 1024 * 1024
LOCAL_HOSTNAMES = {"localhost", "localhost.localdomain"}
NUMERIC_HOST_RE = re.compile(r"[0-9A-Fa-fxX.]+")
TRACKING_QUERY_PARAMS = {
    "fbclid",
    "gclid",
    "gbraid",
    "wbraid",
    "msclkid",
    "mc_cid",
    "mc_eid",
}

# Extensions that don't make sense to treat as HTML pages
NON_HTML_EXT = re.compile(
    r"\.(pdf|jpg|jpeg|png|gif|svg|webp|css|js|ico|zip|mp4|mp3|woff2?|ttf|xml|json)$",
    re.IGNORECASE,
)


class UnsafeUrlError(ValueError):
    """Raised when a user-supplied URL points at a non-public network target."""


class ResponseTooLargeError(ValueError):
    """Raised when a response body exceeds the configured in-memory cap."""


def _env_int(name: str, fallback: int, minimum: int | None = None) -> int:
    try:
        value = int(os.getenv(name, str(fallback)))
    except ValueError:
        return fallback
    if minimum is not None and value < minimum:
        return fallback
    return value


def _max_depth_limit() -> int:
    return _env_int("WORDFINDER_MAX_DEPTH", MAX_DEPTH, minimum=0)


def _max_pages_limit() -> int:
    return _env_int("WORDFINDER_MAX_PAGES", MAX_PAGES, minimum=1)


def _max_concurrency_limit() -> int:
    return _env_int("WORDFINDER_MAX_CONCURRENCY", MAX_CONCURRENCY, minimum=1)


def _default_max_response_bytes() -> int:
    return _env_int("WORDFINDER_MAX_RESPONSE_BYTES", MAX_RESPONSE_BYTES, minimum=1)


def _coerce_match_mode(value: str) -> MatchMode:
    cleaned = value.strip()
    if cleaned not in MATCH_MODES:
        raise ValueError("Match mode must be one of: exact_word, partial, phrase.")
    return cast(MatchMode, cleaned)


def _coerce_search_scope(value: str) -> SearchScope:
    cleaned = value.strip()
    if cleaned not in SEARCH_SCOPES:
        raise ValueError(
            "Search scope must be one of: visible_text, visible_plus_metadata, full_html."
        )
    return cast(SearchScope, cleaned)


def _is_internal_ip(address: str) -> bool:
    return not ipaddress.ip_address(address).is_global


def _hostname_from_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise UnsafeUrlError("URL must be a valid public http(s) URL.")
    return parsed.hostname.rstrip(".").lower()


def _reject_obvious_internal_url(url: str):
    hostname = _hostname_from_url(url)
    if hostname in LOCAL_HOSTNAMES:
        raise UnsafeUrlError("URL points to an internal or reserved network address.")
    try:
        is_internal = _is_internal_ip(hostname)
    except ValueError:
        try:
            legacy_ipv4 = socket.inet_ntoa(socket.inet_aton(hostname))
        except OSError:
            legacy_ipv4 = None
        if legacy_ipv4 is not None:
            if _is_internal_ip(legacy_ipv4):
                raise UnsafeUrlError("URL points to an internal or reserved network address.")
            return
        if NUMERIC_HOST_RE.fullmatch(hostname):
            _resolve_public_ip(hostname)
        return
    if is_internal:
        raise UnsafeUrlError("URL points to an internal or reserved network address.")


def _resolve_public_ip(hostname: str, resolver=socket.getaddrinfo) -> str:
    try:
        addresses = resolver(
            hostname,
            None,
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror as exc:
        raise UnsafeUrlError(f"Could not verify target host: {hostname}.") from exc

    public_ip = None
    for _family, _type, _proto, _canonname, sockaddr in addresses:
        if _is_internal_ip(sockaddr[0]):
            raise UnsafeUrlError("URL resolves to an internal or reserved network address.")
        if public_ip is None:
            public_ip = sockaddr[0]

    if public_ip is None:
        raise UnsafeUrlError(f"Could not verify target host: {hostname}.")
    return public_ip


class PinnedDNSAsyncBackend(httpcore.AsyncNetworkBackend):
    def __init__(self, resolver=socket.getaddrinfo, inner_backend=None):
        self._resolver = resolver
        self._inner_backend = inner_backend or httpcore.AnyIOBackend()

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options=None,
    ):
        clean_host = host.rstrip(".").lower()
        if clean_host in LOCAL_HOSTNAMES:
            raise UnsafeUrlError("URL points to an internal or reserved network address.")
        try:
            pinned_ip = _resolve_public_ip(clean_host, self._resolver)
        except ValueError as exc:
            raise UnsafeUrlError("URL points to an internal or reserved network address.") from exc
        return await self._inner_backend.connect_tcp(
            pinned_ip,
            port,
            timeout=timeout,
            local_address=local_address,
            socket_options=socket_options,
        )

    async def connect_unix_socket(self, path: str, timeout: float | None = None, socket_options=None):
        return await self._inner_backend.connect_unix_socket(
            path,
            timeout=timeout,
            socket_options=socket_options,
        )

    async def sleep(self, seconds: float) -> None:
        await self._inner_backend.sleep(seconds)


class PinnedDNSAsyncTransport(httpx.AsyncHTTPTransport):
    def __init__(self):
        super().__init__(http2=False, trust_env=False)
        self._pool = httpcore.AsyncConnectionPool(
            http1=True,
            http2=False,
            network_backend=PinnedDNSAsyncBackend(),
        )


@dataclass
class CrawlConfig:
    start_url: str
    keyword: str
    max_depth: int = 2
    max_pages: int = 60
    max_concurrency: int = 8           # simultaneous requests, global
    per_domain_delay: float = 0.4      # minimum seconds between 2 requests to the same domain
    whole_word: bool = True
    case_sensitive: bool = False
    match_mode: MatchMode = "exact_word"
    include_variants: bool = False
    search_scope: SearchScope = "visible_text"
    request_timeout: float = 10.0
    max_retries: int = 2
    respect_robots: bool = True
    max_response_bytes: int = field(default_factory=_default_max_response_bytes)

    def __post_init__(self):
        self.start_url = self.start_url.strip()
        self.keyword = self.keyword.strip()
        self.match_mode = _coerce_match_mode(self.match_mode)
        self.search_scope = _coerce_search_scope(self.search_scope)

        parsed = urlparse(self.start_url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("Start URL must be a valid http(s) URL.")
        try:
            _reject_obvious_internal_url(self.start_url)
        except UnsafeUrlError as exc:
            raise ValueError(str(exc)) from exc
        if not self.keyword:
            raise ValueError("Keyword must not be empty.")
        if self.max_depth < 0:
            raise ValueError("Depth must be 0 or greater.")
        max_depth_limit = _max_depth_limit()
        if self.max_depth > max_depth_limit:
            raise ValueError(f"Depth must be {max_depth_limit} or lower.")
        if self.max_pages < 1:
            raise ValueError("Page limit must be at least 1.")
        max_pages_limit = _max_pages_limit()
        if self.max_pages > max_pages_limit:
            raise ValueError(f"Page limit must be {max_pages_limit} or lower.")
        if self.max_concurrency < 1:
            raise ValueError("Concurrency must be at least 1.")
        max_concurrency_limit = _max_concurrency_limit()
        if self.max_concurrency > max_concurrency_limit:
            raise ValueError(f"Concurrency must be {max_concurrency_limit} or lower.")
        if self.request_timeout <= 0:
            raise ValueError("Request timeout must be greater than 0.")
        if self.max_retries < 0:
            raise ValueError("Max retries must be 0 or greater.")
        if self.max_response_bytes < 1:
            raise ValueError("Response size limit must be at least 1 byte.")


@dataclass
class PageResult:
    url: str
    depth: int
    status: PageStatus
    match_count: int = 0
    snippets: list[str] = field(default_factory=list)
    title: Optional[str] = None
    error: Optional[str] = None
    elapsed_ms: int = 0
    links_found: int = 0
    parent_url: Optional[str] = None  # set in run(), not in _fetch_one


@dataclass
class CrawlEvent:
    """A single event emitted to the consumer (e.g. WebSocket)."""
    type: CrawlEventType
    payload: dict


class DomainRateLimiter:
    """Guarantees a minimum delay between successive requests to the same domain,
    without blocking requests to other domains."""

    def __init__(self, delay: float):
        self.delay = delay
        self._last_request: dict[str, float] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def _lock_for(self, domain: str) -> asyncio.Lock:
        if domain not in self._locks:
            self._locks[domain] = asyncio.Lock()
        return self._locks[domain]

    async def wait(self, domain: str):
        async with self._lock_for(domain):
            now = time.monotonic()
            last = self._last_request.get(domain, 0.0)
            wait_for = self.delay - (now - last)
            if wait_for > 0:
                await asyncio.sleep(wait_for)
            self._last_request[domain] = time.monotonic()


class WordFinderCrawler:
    def __init__(self, config: CrawlConfig):
        self.cfg = config
        self.origin = urlparse(config.start_url)
        self.allowed_domain = self.origin.netloc
        self.allowed_domains: set[str] = {self.allowed_domain}
        self.visited: set[str] = set()
        self.semaphore = asyncio.Semaphore(config.max_concurrency)
        self.rate_limiter = DomainRateLimiter(config.per_domain_delay)
        self._robots: Optional[robotparser.RobotFileParser] = None
        self._stop = False

        self.pattern = re.compile(self._build_match_pattern(), self._match_flags())

    def _match_flags(self) -> int:
        return 0 if self.cfg.case_sensitive else re.IGNORECASE

    async def _ensure_public_url(self, url: str):
        _reject_obvious_internal_url(url)

    async def _read_limited_response(self, resp: httpx.Response) -> httpx.Response:
        content_length = resp.headers.get("content-length")
        if content_length is not None:
            try:
                declared_size = int(content_length)
            except ValueError:
                declared_size = None
            if declared_size is not None and declared_size > self.cfg.max_response_bytes:
                raise ResponseTooLargeError(
                    f"Response too large: declared {declared_size} bytes, "
                    f"limit is {self.cfg.max_response_bytes} bytes."
                )

        body = bytearray()
        async for chunk in resp.aiter_bytes():
            body.extend(chunk)
            if len(body) > self.cfg.max_response_bytes:
                raise ResponseTooLargeError(
                    f"Response too large: exceeded {self.cfg.max_response_bytes} bytes."
                )

        decoded_headers = httpx.Headers(
            [
                (key, value)
                for key, value in resp.headers.items()
                if key.lower() not in ("content-encoding", "content-length", "transfer-encoding")
            ]
        )

        return httpx.Response(
            status_code=resp.status_code,
            headers=decoded_headers,
            content=bytes(body),
            request=resp.request,
            extensions=resp.extensions,
        )

    async def _safe_get(self, client: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
        current_url = url
        for _redirect_index in range(MAX_REDIRECTS + 1):
            await self._ensure_public_url(current_url)
            async with client.stream(
                "GET",
                current_url,
                follow_redirects=False,
                **kwargs,
            ) as resp:
                if not resp.is_redirect:
                    return await self._read_limited_response(resp)

                location = resp.headers.get("location")
                if not location:
                    raise httpx.HTTPStatusError(
                        "Redirect response missing Location header.",
                        request=resp.request,
                        response=resp,
                    )
                current_url = urljoin(str(resp.url), location)

        raise httpx.TooManyRedirects(
            f"Exceeded maximum redirect limit ({MAX_REDIRECTS})."
        )

    @staticmethod
    def _simple_variants(word: str) -> set[str]:
        if not re.fullmatch(r"[A-Za-z]+", word):
            return {word}

        variants = {word}
        lower = word.lower()
        if lower.endswith("y") and len(word) > 1 and lower[-2] not in "aeiou":
            variants.add(word[:-1] + "ies")
        elif lower.endswith(("s", "x", "z", "ch", "sh")):
            variants.add(word + "es")
        else:
            variants.add(word + "s")
        return variants

    def _keyword_terms(self) -> list[str]:
        if self.cfg.include_variants and self.cfg.match_mode != "phrase":
            return sorted(self._simple_variants(self.cfg.keyword), key=len, reverse=True)
        return [self.cfg.keyword]

    def _build_match_pattern(self) -> str:
        if self.cfg.match_mode == "phrase":
            words = [re.escape(part) for part in self.cfg.keyword.split()]
            phrase = r"\s+".join(words)
            return rf"\b{phrase}\b"

        alternatives = "|".join(re.escape(term) for term in self._keyword_terms())
        if self.cfg.match_mode == "partial" or not self.cfg.whole_word:
            return rf"(?:{alternatives})"
        return rf"\b(?:{alternatives})\b"

    async def _load_robots(self, client: httpx.AsyncClient):
        if not self.cfg.respect_robots:
            return
        robots_url = f"{self.origin.scheme}://{self.origin.netloc}/robots.txt"
        rp = robotparser.RobotFileParser()
        try:
            resp = await self._safe_get(client, robots_url, timeout=5.0)
            if resp.status_code == 200:
                rp.parse(resp.text.splitlines())
            else:
                rp.parse([])  # no restrictions if robots.txt doesn't exist
        except Exception:
            rp.parse([])
        self._robots = rp

    def _allowed_by_robots(self, url: str) -> bool:
        if not self.cfg.respect_robots or self._robots is None:
            return True
        try:
            return self._robots.can_fetch(USER_AGENT, url)
        except Exception:
            return True

    @staticmethod
    def _canonical_domain(domain: str) -> str:
        return domain.removeprefix("www.")

    def _remember_redirect_domain(self, original_url: str, final_url: str):
        original_domain = urlparse(original_url).netloc
        final_domain = urlparse(final_url).netloc
        if (
            final_domain
            and self._canonical_domain(original_domain) == self._canonical_domain(final_domain)
        ):
            self.allowed_domains.add(final_domain)

    def _normalize_link(self, base_url: str, href: str) -> Optional[str]:
        if not href or href.startswith(("mailto:", "tel:", "javascript:")):
            return None
        absolute = urljoin(base_url, href)
        absolute, _frag = urldefrag(absolute)  # strip #fragment
        parsed = urlparse(absolute)
        if parsed.scheme not in ("http", "https"):
            return None
        if parsed.netloc not in self.allowed_domains:
            return None  # stay strictly within the start domain
        if NON_HTML_EXT.search(parsed.path):
            return None

        path = parsed.path or "/"
        if path != "/":
            path = path.rstrip("/")

        query_params = []
        for key, value in parse_qsl(parsed.query, keep_blank_values=True):
            normalized_key = key.lower()
            if normalized_key.startswith("utm_") or normalized_key in TRACKING_QUERY_PARAMS:
                continue
            query_params.append((key, value))

        return urlunparse(
            (
                parsed.scheme,
                parsed.netloc,
                path,
                "",
                urlencode(query_params, doseq=True),
                "",
            )
        )

    def _extract_text_and_links(self, html: str, base_url: str) -> tuple[str, str, list[str]]:
        soup = BeautifulSoup(html, "lxml")
        for tag in soup(["script", "style", "noscript", "template"]):
            tag.decompose()

        title_tag = soup.find("title")
        title = title_tag.get_text(strip=True) if title_tag else base_url

        body = soup.body or soup
        visible_text = body.get_text(separator=" ", strip=True)

        links = []
        for a in soup.find_all("a", href=True):
            normalized = self._normalize_link(base_url, a["href"])
            if normalized:
                links.append(normalized)

        return title, visible_text, links

    def _extract_metadata_text(self, soup: BeautifulSoup, title: str) -> str:
        metadata = [title]
        for meta in soup.find_all("meta"):
            content = meta.get("content")
            if content:
                metadata.append(content)
        for tag in soup.find_all(True):
            for attr in ("alt", "aria-label", "title"):
                value = tag.get(attr)
                if value:
                    metadata.append(value)
        return " ".join(metadata)

    def _extract_search_document(self, html: str, base_url: str) -> tuple[str, str, list[str]]:
        title, visible_text, links = self._extract_text_and_links(html, base_url)
        if self.cfg.search_scope == "visible_text":
            return title, visible_text, links
        if self.cfg.search_scope == "full_html":
            return title, html, links

        soup = BeautifulSoup(html, "lxml")
        metadata_text = self._extract_metadata_text(soup, title)
        return title, f"{visible_text} {metadata_text}".strip(), links

    def _find_match_summary(self, text: str) -> tuple[int, list[str]]:
        snippets = []
        match_count = 0
        for m in self.pattern.finditer(text):
            match_count += 1
            if len(snippets) < MAX_SNIPPETS_PER_PAGE:  # cap snippets, not the real match count
                start = max(0, m.start() - 40)
                end = min(len(text), m.end() + 40)
                snippet = text[start:end].strip()
                snippets.append(f"…{snippet}…")
        return match_count, snippets

    async def _fetch_one(
        self, client: httpx.AsyncClient, url: str, depth: int
    ) -> tuple[PageResult, list[str]]:
        domain = urlparse(url).netloc
        attempt = 0
        last_error = None
        elapsed_ms = 0

        try:
            await self._ensure_public_url(url)
        except UnsafeUrlError as e:
            return PageResult(url=url, depth=depth, status="error", error=str(e)), []

        if not self._allowed_by_robots(url):
            return PageResult(url=url, depth=depth, status="skipped_robots"), []

        while attempt <= self.cfg.max_retries:
            await self.rate_limiter.wait(domain)
            async with self.semaphore:
                t0 = time.monotonic()
                try:
                    resp = await self._safe_get(
                        client,
                        url,
                        timeout=self.cfg.request_timeout,
                        headers={"User-Agent": USER_AGENT},
                    )
                    elapsed_ms = int((time.monotonic() - t0) * 1000)

                    content_type = resp.headers.get("content-type", "")
                    if resp.status_code >= 400:
                        last_error = f"HTTP {resp.status_code}"
                        raise httpx.HTTPStatusError(
                            last_error, request=resp.request, response=resp
                        )
                    if "text/html" not in content_type:
                        return (
                            PageResult(
                                url=url, depth=depth, status="skipped_type",
                                elapsed_ms=elapsed_ms,
                            ),
                            [],
                        )

                    final_url = str(resp.url)
                    self._remember_redirect_domain(url, final_url)
                    title, text, links = self._extract_search_document(resp.text, final_url)
                    match_count, snippets = self._find_match_summary(text)
                    status = "ok" if match_count else "no_match"

                    return (
                        PageResult(
                            url=final_url,
                            depth=depth,
                            status=status,
                            match_count=match_count,
                            snippets=snippets,
                            title=title,
                            elapsed_ms=elapsed_ms,
                            links_found=len(links),
                        ),
                        links,
                    )

                except (httpx.TimeoutException, httpx.TransportError) as e:
                    last_error = f"{type(e).__name__}: {e}"
                    elapsed_ms = int((time.monotonic() - t0) * 1000)
                except UnsafeUrlError as e:
                    last_error = str(e)
                    elapsed_ms = int((time.monotonic() - t0) * 1000)
                    break
                except ResponseTooLargeError as e:
                    last_error = str(e)
                    elapsed_ms = int((time.monotonic() - t0) * 1000)
                    break
                except httpx.HTTPStatusError as e:
                    last_error = str(e)
                    elapsed_ms = int((time.monotonic() - t0) * 1000)
                    if e.response is not None and e.response.status_code in (404, 410):
                        break  # permanent errors: not worth retrying
            attempt += 1
            if attempt <= self.cfg.max_retries:
                await asyncio.sleep(0.5 * (2 ** (attempt - 1)))  # exponential backoff

        return (
            PageResult(url=url, depth=depth, status="error", error=last_error, elapsed_ms=elapsed_ms),
            [],
        )

    async def run(self) -> AsyncGenerator[CrawlEvent, None]:
        async with httpx.AsyncClient(
            http2=False,
            transport=PinnedDNSAsyncTransport(),
            trust_env=False,
        ) as client:
            await self._load_robots(client)

            # queue holds (url, depth, parent_url) — parent_url is None only for start_url
            queue = deque([(self.cfg.start_url, 0, None)])
            self.visited.add(self.cfg.start_url)
            pages_started = 0
            pages_done = 0
            matches_total = 0
            found_by_depth: dict[int, int] = {0: 1}
            checked_by_depth: dict[int, int] = {}
            in_flight: set[asyncio.Task] = set()
            task_context: dict[asyncio.Task, tuple[str, int, Optional[str]]] = {}

            def depth_stats_payload() -> list[dict[str, int]]:
                rows = []
                for depth in range(self.cfg.max_depth + 1):
                    found = found_by_depth.get(depth, 0)
                    checked = checked_by_depth.get(depth, 0)
                    rows.append({
                        "depth": depth,
                        "found": found,
                        "checked": checked,
                        "remaining": max(0, found - checked),
                    })
                return rows

            def schedule_available():
                nonlocal pages_started
                while (
                    queue
                    and len(in_flight) < self.cfg.max_concurrency
                    and pages_started < self.cfg.max_pages
                    and not self._stop
                ):
                    url, depth, parent_url = queue.popleft()
                    task = asyncio.create_task(self._fetch_one(client, url, depth))
                    in_flight.add(task)
                    task_context[task] = (url, depth, parent_url)
                    pages_started += 1

            try:
                while (queue or in_flight) and pages_done < self.cfg.max_pages and not self._stop:
                    schedule_available()
                    if not in_flight:
                        break

                    completed, in_flight = await asyncio.wait(
                        in_flight,
                        return_when=asyncio.FIRST_COMPLETED,
                        timeout=0.1,
                    )

                    if not completed:
                        continue

                    for task in completed:
                        _url, _depth, parent_url = task_context.pop(task)
                        result, links = task.result()
                        pages_done += 1
                        matches_total += result.match_count
                        checked_by_depth[result.depth] = checked_by_depth.get(result.depth, 0) + 1
                        result.parent_url = parent_url
                        links_enqueued = 0
                        self.visited.add(result.url)

                        if result.depth < self.cfg.max_depth:
                            for link in links:
                                if link not in self.visited and len(self.visited) < self.cfg.max_pages * 4:
                                    self.visited.add(link)
                                    found_by_depth[result.depth + 1] = found_by_depth.get(result.depth + 1, 0) + 1
                                    queue.append((link, result.depth + 1, result.url))
                                    links_enqueued += 1

                        yield CrawlEvent(
                            type="page_done",
                            payload={
                                "url": result.url,
                                "depth": result.depth,
                                "current_depth": result.depth,
                                "parent_url": result.parent_url,
                                "status": result.status,
                                "match_count": result.match_count,
                                "snippets": result.snippets,
                                "title": result.title,
                                "error": result.error,
                                "elapsed_ms": result.elapsed_ms,
                                "links_found": result.links_found,
                                "links_enqueued": links_enqueued,
                                "queue_waiting": len(queue),
                                "depth_stats": depth_stats_payload(),
                                "pages_done": pages_done,
                                "matches_total": matches_total,
                            },
                        )

                        if pages_done >= self.cfg.max_pages or self._stop:
                            break
            finally:
                for task in in_flight:
                    task.cancel()
                if in_flight:
                    await asyncio.gather(*in_flight, return_exceptions=True)

            if self._stop:
                finish_reason = "stopped"
            elif pages_done >= self.cfg.max_pages:
                finish_reason = "page_limit_reached"
            else:
                finish_reason = "queue_exhausted"

            yield CrawlEvent(
                type="done",
                payload={
                    "pages_done": pages_done,
                    "matches_total": matches_total,
                    "finish_reason": finish_reason,
                    "depth_stats": depth_stats_payload(),
                },
            )

    def stop(self):
        self._stop = True
