import asyncio
import gzip
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, str(Path(__file__).parent))

from crawler import (
    CrawlConfig,
    DomainRateLimiter,
    PageResult,
    PinnedDNSAsyncBackend,
    ResponseTooLargeError,
    WordFinderCrawler,
    _env_int,
    _is_internal_ip,
)


async def _allow_public_url(_url):
    return None


class AsyncStreamContext:
    def __init__(self, response):
        self.response = response

    async def __aenter__(self):
        return self.response

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class CrawlConfigTests(unittest.TestCase):
    def test_env_int_uses_fallback_for_missing_invalid_or_too_small_values(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(_env_int("WORDFINDER_TEST_LIMIT", 4, minimum=1), 4)

        with patch.dict(os.environ, {"WORDFINDER_TEST_LIMIT": "abc"}):
            self.assertEqual(_env_int("WORDFINDER_TEST_LIMIT", 4, minimum=1), 4)

        with patch.dict(os.environ, {"WORDFINDER_TEST_LIMIT": "0"}):
            self.assertEqual(_env_int("WORDFINDER_TEST_LIMIT", 4, minimum=1), 4)

    def test_crawler_hard_limits_can_be_tightened_from_environment(self):
        with patch.dict(os.environ, {"WORDFINDER_MAX_PAGES": "5"}):
            with self.assertRaisesRegex(ValueError, "Page limit must be 5 or lower"):
                CrawlConfig(
                    start_url="https://example.com",
                    keyword="energy",
                    max_pages=6,
                )

    def test_response_size_default_can_be_tightened_from_environment(self):
        with patch.dict(os.environ, {"WORDFINDER_MAX_RESPONSE_BYTES": "1234"}):
            config = CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
            )

        self.assertEqual(config.max_response_bytes, 1234)

    def test_rejects_zero_concurrency(self):
        with self.assertRaises(ValueError):
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                max_concurrency=0,
            )

    def test_rejects_depth_above_limit(self):
        with self.assertRaises(ValueError):
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                max_depth=5,
            )

    def test_rejects_page_limit_above_limit(self):
        with self.assertRaises(ValueError):
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                max_pages=201,
            )

    def test_rejects_concurrency_above_limit(self):
        with self.assertRaises(ValueError):
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                max_concurrency=11,
            )

    def test_rejects_empty_keyword(self):
        with self.assertRaises(ValueError):
            CrawlConfig(start_url="https://example.com", keyword="   ")

    def test_rejects_localhost_start_url(self):
        with self.assertRaisesRegex(ValueError, "internal or reserved"):
            CrawlConfig(start_url="http://localhost:8000", keyword="energy")

    def test_rejects_cloud_metadata_start_url(self):
        with self.assertRaisesRegex(ValueError, "internal or reserved"):
            CrawlConfig(start_url="http://169.254.169.254/latest/meta-data", keyword="energy")

    def test_rejects_encoded_loopback_start_urls(self):
        for url in (
            "http://2130706433/",
            "http://0x7f000001/",
            "http://017700000001/",
            "http://127.1/",
        ):
            with self.subTest(url=url):
                with self.assertRaisesRegex(ValueError, "internal or reserved"):
                    CrawlConfig(start_url=url, keyword="energy")

    def test_treats_cgnat_address_as_internal(self):
        self.assertTrue(_is_internal_ip("100.64.0.1"))

    def test_rejects_unknown_match_mode(self):
        with self.assertRaises(ValueError):
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                match_mode="contains",
            )

    def test_rejects_unknown_search_scope(self):
        with self.assertRaises(ValueError):
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                search_scope="everything",
            )

    def test_trims_and_keeps_known_match_mode_and_search_scope(self):
        config = CrawlConfig(
            start_url="https://example.com",
            keyword="energy",
            match_mode=" phrase ",
            search_scope=" full_html ",
        )

        self.assertEqual(config.match_mode, "phrase")
        self.assertEqual(config.search_scope, "full_html")


class MatchTests(unittest.TestCase):
    def test_counts_all_matches_while_capping_snippets_payload(self):
        crawler = WordFinderCrawler(CrawlConfig("https://example.com", "energy"))
        text = " ".join(["energy"] * 30)

        count, snippets = crawler._find_match_summary(text)

        self.assertEqual(count, 30)
        self.assertEqual(len(snippets), 25)

    def test_visible_text_excludes_title(self):
        crawler = WordFinderCrawler(CrawlConfig("https://example.com", "TitleOnly"))
        html = """
        <html>
          <head><title>TitleOnly</title></head>
          <body><p>Body content</p></body>
        </html>
        """

        title, text, _links = crawler._extract_text_and_links(html, "https://example.com")

        self.assertEqual(title, "TitleOnly")
        self.assertNotIn("TitleOnly", text)
        self.assertIn("Body content", text)

    def test_exact_word_does_not_match_inside_larger_word(self):
        crawler = WordFinderCrawler(
            CrawlConfig("https://example.com", "energy", match_mode="exact_word")
        )

        count, snippets = crawler._find_match_summary("energy energetic bioenergy")

        self.assertEqual(count, 1)
        self.assertEqual(len(snippets), 1)

    def test_partial_match_finds_word_inside_larger_word(self):
        crawler = WordFinderCrawler(
            CrawlConfig("https://example.com", "energy", match_mode="partial")
        )

        count, _snippets = crawler._find_match_summary("energy energyplus bioenergy")

        self.assertEqual(count, 3)

    def test_phrase_match_allows_flexible_whitespace(self):
        crawler = WordFinderCrawler(
            CrawlConfig("https://example.com", "clean energy", match_mode="phrase")
        )

        count, _snippets = crawler._find_match_summary("clean   energy and clean power")

        self.assertEqual(count, 1)

    def test_simple_variants_include_common_plural_forms(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                "https://example.com",
                "battery",
                match_mode="exact_word",
                include_variants=True,
            )
        )

        count, _snippets = crawler._find_match_summary("battery batteries batterylife")

        self.assertEqual(count, 2)

    def test_simple_variants_do_not_guess_non_english_or_alphanumeric_terms(self):
        self.assertEqual(WordFinderCrawler._simple_variants("energie2"), {"energie2"})
        self.assertEqual(WordFinderCrawler._simple_variants("cafe-ro"), {"cafe-ro"})
        self.assertEqual(WordFinderCrawler._simple_variants("țeavă"), {"țeavă"})

    def test_visible_plus_metadata_searches_title_meta_and_alt_text(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                "https://example.com",
                "Energy",
                search_scope="visible_plus_metadata",
            )
        )
        html = """
        <html>
          <head>
            <title>Energy services</title>
            <meta name="description" content="Energy transition overview">
          </head>
          <body><img alt="Energy storage" /><p>Body content</p></body>
        </html>
        """

        title, text, _links = crawler._extract_search_document(html, "https://example.com")

        self.assertEqual(title, "Energy services")
        self.assertIn("Energy services", text)
        self.assertIn("Energy transition overview", text)
        self.assertIn("Energy storage", text)

    def test_full_html_scope_can_match_attribute_names_and_values(self):
        crawler = WordFinderCrawler(
            CrawlConfig("https://example.com", "data-term", search_scope="full_html")
        )
        html = '<html><body><span data-term="Energy">Visible copy</span></body></html>'

        _title, text, _links = crawler._extract_search_document(html, "https://example.com")

        self.assertIn("data-term", text)


class RedirectTests(unittest.IsolatedAsyncioTestCase):
    async def test_pinned_dns_backend_connects_to_validated_ip_not_hostname(self):
        class FakeInnerBackend:
            def __init__(self):
                self.connected_hosts = []

            async def connect_tcp(self, host, port, **kwargs):
                self.connected_hosts.append(host)
                return object()

            async def connect_unix_socket(self, path, **kwargs):
                raise AssertionError("unexpected unix socket connection")

            async def sleep(self, seconds):
                return None

        def resolver(host, port, type=0):
            self.assertEqual(host, "rebind.example")
            return [
                (
                    2,
                    1,
                    6,
                    "",
                    ("93.184.216.34", 0),
                )
            ]

        inner = FakeInnerBackend()
        backend = PinnedDNSAsyncBackend(resolver=resolver, inner_backend=inner)

        await backend.connect_tcp("rebind.example", 443)

        self.assertEqual(inner.connected_hosts, ["93.184.216.34"])

    async def test_fetch_extracts_links_relative_to_final_url(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                respect_robots=False,
            )
        )
        captured_base_urls = []
        original_extract = crawler._extract_text_and_links

        def capture_extract(html, base_url):
            captured_base_urls.append(base_url)
            return original_extract(html, base_url)

        class FakeClient:
            def stream(self, method, url, *args, **kwargs):
                response = httpx.Response(
                    200,
                    headers={"content-type": "text/html"},
                    text="<html><body>energy <a href='/next'>Next</a></body></html>",
                    request=httpx.Request("GET", "https://www.example.com/final"),
                )
                return AsyncStreamContext(response)

        crawler._extract_text_and_links = capture_extract
        crawler._ensure_public_url = _allow_public_url

        result, links = await crawler._fetch_one(FakeClient(), "https://example.com", 0)

        self.assertEqual(result.status, "ok")
        self.assertEqual(captured_base_urls, ["https://www.example.com/final"])
        self.assertEqual(links, ["https://www.example.com/next"])

    async def test_fetch_rejects_redirect_to_internal_address(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                respect_robots=False,
            )
        )
        requested_urls = []

        async def allow_only_example(url):
            if url != "https://example.com/start":
                await WordFinderCrawler._ensure_public_url(crawler, url)

        class RedirectToInternalClient:
            def stream(self, method, url, *args, **kwargs):
                requested_urls.append(url)
                response = httpx.Response(
                    302,
                    headers={"location": "http://127.0.0.1/private"},
                    request=httpx.Request("GET", url),
                )
                return AsyncStreamContext(response)

        crawler._ensure_public_url = allow_only_example

        result, links = await crawler._fetch_one(
            RedirectToInternalClient(),
            "https://example.com/start",
            0,
        )

        self.assertEqual(result.status, "error")
        self.assertIn("internal or reserved", result.error)
        self.assertEqual(links, [])
        self.assertEqual(requested_urls, ["https://example.com/start"])


class UrlNormalizationTests(unittest.TestCase):
    def test_normalize_link_strips_trailing_slash_from_non_root_paths(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
            )
        )

        normalized = crawler._normalize_link("https://example.com", "/services/")

        self.assertEqual(normalized, "https://example.com/services")

    def test_normalize_link_removes_common_tracking_query_params(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
            )
        )

        normalized = crawler._normalize_link(
            "https://example.com",
            "/services/?utm_source=newsletter&utm_campaign=launch&gclid=abc&topic=energy",
        )

        self.assertEqual(normalized, "https://example.com/services?topic=energy")

    def test_normalize_link_keeps_root_slash(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
            )
        )

        normalized = crawler._normalize_link("https://example.com", "/?utm_medium=email")

        self.assertEqual(normalized, "https://example.com/")


class ResponseSizeLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_rejects_content_length_above_limit_without_reading_body(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                respect_robots=False,
                max_retries=0,
                max_response_bytes=10,
            )
        )
        body_was_read = False

        class LargeResponse(httpx.Response):
            async def aiter_bytes(self, chunk_size=None):
                nonlocal body_was_read
                body_was_read = True
                yield b"energy"

        class FakeClient:
            def stream(self, method, url, *args, **kwargs):
                response = LargeResponse(
                    200,
                    headers={"content-type": "text/html", "content-length": "11"},
                    request=httpx.Request("GET", url),
                )
                return AsyncStreamContext(response)

        crawler._ensure_public_url = _allow_public_url

        result, links = await crawler._fetch_one(FakeClient(), "https://example.com", 0)

        self.assertEqual(result.status, "error")
        self.assertIn("too large", result.error.lower())
        self.assertFalse(body_was_read)
        self.assertEqual(links, [])

    async def test_fetch_stops_when_decompressed_body_exceeds_limit(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                respect_robots=False,
                max_retries=0,
                max_response_bytes=10,
            )
        )
        chunks_read = 0

        class ChunkedResponse(httpx.Response):
            async def aiter_bytes(self, chunk_size=None):
                nonlocal chunks_read
                for chunk in (b"12345", b"67890", b"X-energy"):
                    chunks_read += 1
                    yield chunk

        class FakeClient:
            def stream(self, method, url, *args, **kwargs):
                response = ChunkedResponse(
                    200,
                    headers={"content-type": "text/html"},
                    request=httpx.Request("GET", url),
                )
                return AsyncStreamContext(response)

        crawler._ensure_public_url = _allow_public_url

        result, links = await crawler._fetch_one(FakeClient(), "https://example.com", 0)

        self.assertEqual(result.status, "error")
        self.assertIn("too large", result.error.lower())
        self.assertEqual(chunks_read, 3)
        self.assertEqual(links, [])

    async def test_read_limit_applies_after_gzip_decompression(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                max_response_bytes=10,
            )
        )
        compressed_body = gzip.compress(b"energy " * 20)
        response = httpx.Response(
            200,
            headers={
                "content-type": "text/html",
                "content-encoding": "gzip",
                "content-length": str(len(compressed_body)),
            },
            content=compressed_body,
            request=httpx.Request("GET", "https://example.com"),
        )

        with self.assertRaisesRegex(ResponseTooLargeError, "too large"):
            await crawler._read_limited_response(response)

    async def test_limited_gzip_response_keeps_readable_decoded_text(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                max_response_bytes=1024,
            )
        )
        html = b"<html><body>energy page</body></html>"
        compressed_body = gzip.compress(html)
        response = httpx.Response(
            200,
            headers={
                "content-type": "text/html",
                "content-encoding": "gzip",
                "content-length": str(len(compressed_body)),
            },
            content=compressed_body,
            request=httpx.Request("GET", "https://example.com"),
        )

        limited = await crawler._read_limited_response(response)

        self.assertEqual(limited.text, html.decode())
        self.assertNotIn("content-encoding", limited.headers)
        self.assertEqual(limited.headers["content-length"], str(len(html)))


class DomainRateLimiterTests(unittest.IsolatedAsyncioTestCase):
    async def test_wait_is_per_domain_and_sleeps_only_when_needed(self):
        limiter = DomainRateLimiter(delay=1.0)
        ticks = iter([10.0, 10.0, 10.1, 10.1, 10.2, 11.0])

        with (
            patch("crawler.time.monotonic", side_effect=lambda: next(ticks)),
            patch("crawler.asyncio.sleep", new_callable=AsyncMock) as sleep,
        ):
            await limiter.wait("example.com")
            await limiter.wait("other.example")
            await limiter.wait("example.com")

        sleep.assert_awaited_once()
        self.assertAlmostEqual(sleep.await_args.args[0], 0.8)


class RetryAndRobotsTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_retries_transient_transport_errors_with_backoff(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                max_retries=1,
                respect_robots=False,
            )
        )
        attempts = 0

        async def flaky_safe_get(_client, url, **_kwargs):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise httpx.TransportError("temporary network failure")
            return httpx.Response(
                200,
                headers={"content-type": "text/html"},
                text="<html><body>energy</body></html>",
                request=httpx.Request("GET", url),
            )

        crawler._safe_get = flaky_safe_get
        crawler._ensure_public_url = _allow_public_url
        crawler.rate_limiter.wait = AsyncMock(return_value=None)

        with patch("crawler.asyncio.sleep", new_callable=AsyncMock) as sleep:
            result, _links = await crawler._fetch_one(object(), "https://example.com", 0)

        self.assertEqual(result.status, "ok")
        self.assertEqual(attempts, 2)
        sleep.assert_awaited_once_with(0.5)

    async def test_fetch_does_not_retry_permanent_not_found_errors(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                max_retries=3,
                respect_robots=False,
            )
        )
        attempts = 0

        async def not_found_safe_get(_client, url, **_kwargs):
            nonlocal attempts
            attempts += 1
            return httpx.Response(
                404,
                headers={"content-type": "text/html"},
                text="not found",
                request=httpx.Request("GET", url),
            )

        crawler._safe_get = not_found_safe_get
        crawler._ensure_public_url = _allow_public_url
        crawler.rate_limiter.wait = AsyncMock(return_value=None)

        with patch("crawler.asyncio.sleep", new_callable=AsyncMock) as sleep:
            result, links = await crawler._fetch_one(object(), "https://example.com/missing", 0)

        self.assertEqual(result.status, "error")
        self.assertIn("HTTP 404", result.error)
        self.assertEqual(links, [])
        self.assertEqual(attempts, 1)
        sleep.assert_not_awaited()

    async def test_load_robots_blocks_disallowed_paths(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
            )
        )

        async def robots_safe_get(_client, url, **_kwargs):
            self.assertEqual(url, "https://example.com/robots.txt")
            return httpx.Response(
                200,
                headers={"content-type": "text/plain"},
                text="User-agent: *\nDisallow: /private",
                request=httpx.Request("GET", url),
            )

        crawler._safe_get = robots_safe_get

        await crawler._load_robots(object())

        self.assertFalse(crawler._allowed_by_robots("https://example.com/private/page"))
        self.assertTrue(crawler._allowed_by_robots("https://example.com/public/page"))


class RunLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_does_not_launch_more_fetches_than_page_limit(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                max_pages=2,
                max_concurrency=5,
                respect_robots=False,
            )
        )
        fetched_urls = []

        async def fake_fetch(_client, url, depth):
            fetched_urls.append(url)
            if url == "https://example.com":
                return (
                    PageResult(
                        url=url,
                        depth=depth,
                        status="ok",
                        match_count=1,
                        links_found=5,
                    ),
                    [f"https://example.com/page-{index}" for index in range(5)],
                )
            return (
                PageResult(
                    url=url,
                    depth=depth,
                    status="no_match",
                ),
                [],
            )

        crawler._fetch_one = fake_fetch

        events = [event async for event in crawler.run()]
        page_events = [event for event in events if event.type == "page_done"]

        self.assertEqual(len(page_events), 2)
        self.assertEqual(len(fetched_urls), 2)

    async def test_run_does_not_enqueue_links_beyond_max_depth(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                max_pages=5,
                max_concurrency=2,
                max_depth=0,
                respect_robots=False,
            )
        )
        fetched_urls = []

        async def fake_fetch(_client, url, depth):
            fetched_urls.append(url)
            return (
                PageResult(
                    url=url,
                    depth=depth,
                    status="ok",
                    match_count=1,
                    links_found=1,
                ),
                ["https://example.com/next"],
            )

        crawler._fetch_one = fake_fetch

        events = [event async for event in crawler.run()]
        page_events = [event for event in events if event.type == "page_done"]

        self.assertEqual(len(page_events), 1)
        self.assertEqual(fetched_urls, ["https://example.com"])

    async def test_run_starts_next_url_when_a_worker_slot_frees(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                max_pages=4,
                max_concurrency=2,
                max_depth=1,
                respect_robots=False,
            )
        )
        slow_release = asyncio.Event()
        fast_done = asyncio.Event()
        later_started = asyncio.Event()

        async def fake_fetch(_client, url, depth):
            if url == "https://example.com":
                return (
                    PageResult(
                        url=url,
                        depth=depth,
                        status="ok",
                        match_count=1,
                        links_found=3,
                    ),
                    [
                        "https://example.com/slow",
                        "https://example.com/fast",
                        "https://example.com/later",
                    ],
                )

            if url == "https://example.com/slow":
                await slow_release.wait()
            elif url == "https://example.com/fast":
                fast_done.set()
            elif url == "https://example.com/later":
                later_started.set()

            return PageResult(url=url, depth=depth, status="no_match"), []

        crawler._fetch_one = fake_fetch

        async def consume():
            return [event async for event in crawler.run()]

        task = asyncio.create_task(consume())
        await asyncio.wait_for(fast_done.wait(), timeout=1)

        try:
            await asyncio.wait_for(later_started.wait(), timeout=0.05)
            later_started_before_slow_finished = True
        except asyncio.TimeoutError:
            later_started_before_slow_finished = False

        slow_release.set()
        await task

        self.assertTrue(later_started_before_slow_finished)

    async def test_run_never_exceeds_configured_concurrency(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                max_pages=5,
                max_concurrency=2,
                max_depth=1,
                respect_robots=False,
            )
        )
        active_fetches = 0
        max_active_fetches = 0
        child_fetches_started = 0
        two_children_started = asyncio.Event()
        release_children = asyncio.Event()

        async def fake_fetch(_client, url, depth):
            nonlocal active_fetches, max_active_fetches, child_fetches_started
            active_fetches += 1
            max_active_fetches = max(max_active_fetches, active_fetches)
            try:
                if url == "https://example.com":
                    return (
                        PageResult(
                            url=url,
                            depth=depth,
                            status="ok",
                            match_count=1,
                            links_found=4,
                        ),
                        [f"https://example.com/page-{index}" for index in range(4)],
                    )

                child_fetches_started += 1
                if child_fetches_started == 2:
                    two_children_started.set()
                await release_children.wait()
                return PageResult(url=url, depth=depth, status="no_match"), []
            finally:
                active_fetches -= 1

        crawler._fetch_one = fake_fetch

        async def consume():
            return [event async for event in crawler.run()]

        task = asyncio.create_task(consume())
        await asyncio.wait_for(two_children_started.wait(), timeout=1)

        self.assertEqual(active_fetches, 2)
        self.assertEqual(max_active_fetches, 2)

        release_children.set()
        await task

        self.assertLessEqual(max_active_fetches, 2)

    async def test_page_event_reports_unique_links_enqueued_for_depth_fallback(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                max_pages=3,
                max_concurrency=2,
                max_depth=1,
                respect_robots=False,
            )
        )

        async def fake_fetch(_client, url, depth):
            if url == "https://example.com":
                return (
                    PageResult(
                        url=url,
                        depth=depth,
                        status="ok",
                        match_count=1,
                        links_found=4,
                    ),
                    [
                        "https://example.com/a",
                        "https://example.com/a",
                        "https://example.com/b",
                    ],
                )
            return PageResult(url=url, depth=depth, status="no_match"), []

        crawler._fetch_one = fake_fetch

        events = [event async for event in crawler.run()]
        first_page = next(event for event in events if event.type == "page_done")

        self.assertEqual(first_page.payload["links_found"], 4)
        self.assertEqual(first_page.payload["links_enqueued"], 2)
        self.assertEqual(first_page.payload["depth_stats"][1]["found"], 2)

    async def test_stop_cancels_in_flight_fetches_without_waiting_for_completion(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                max_pages=1,
                max_concurrency=1,
                respect_robots=False,
            )
        )
        fetch_started = asyncio.Event()
        never_finish = asyncio.Event()

        async def fake_fetch(_client, url, depth):
            fetch_started.set()
            await never_finish.wait()
            return PageResult(url=url, depth=depth, status="no_match"), []

        crawler._fetch_one = fake_fetch

        async def consume():
            return [event async for event in crawler.run()]

        task = asyncio.create_task(consume())
        await asyncio.wait_for(fetch_started.wait(), timeout=1)
        crawler.stop()

        try:
            events = await asyncio.wait_for(task, timeout=0.2)
        except asyncio.TimeoutError:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            self.fail("crawler.stop() did not unblock run() while a fetch was in flight")

        self.assertEqual(events[-1].type, "done")
        self.assertEqual(events[-1].payload["finish_reason"], "stopped")

    async def test_run_deduplicates_redirected_start_url(self):
        crawler = WordFinderCrawler(
            CrawlConfig(
                start_url="https://example.com",
                keyword="energy",
                max_pages=2,
                max_concurrency=1,
                max_depth=1,
                respect_robots=False,
            )
        )
        crawler.allowed_domains.add("www.example.com")
        fetched_urls = []

        async def fake_fetch(_client, url, depth):
            fetched_urls.append(url)
            if url == "https://example.com":
                return (
                    PageResult(
                        url="https://www.example.com/",
                        depth=depth,
                        status="ok",
                        match_count=1,
                        links_found=1,
                    ),
                    ["https://www.example.com/"],
                )
            return PageResult(url=url, depth=depth, status="no_match"), []

        crawler._fetch_one = fake_fetch

        events = [event async for event in crawler.run()]
        page_events = [event for event in events if event.type == "page_done"]

        self.assertEqual(len(page_events), 1)
        self.assertEqual(fetched_urls, ["https://example.com"])


if __name__ == "__main__":
    unittest.main()
