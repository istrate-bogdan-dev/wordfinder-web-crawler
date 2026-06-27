"""
main.py — FastAPI server. Exposes:
- GET  /                -> serves the static frontend
- WS   /ws/crawl         -> receives crawl config, emits live events

Design decision: we use WebSocket (not Server-Sent Events or polling)
because we need a simple bidirectional channel (the client might send
a "stop" message later) and because updates are frequent and small —
exactly the use case WebSocket is suited for.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import os
import time
from collections import defaultdict, deque
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from crawler import CrawlConfig, WordFinderCrawler

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
INITIAL_WS_MESSAGE_TIMEOUT_SECONDS = 10


def _env_int(name: str, fallback: int, env=os.environ) -> int:
    try:
        return int(env.get(name, str(fallback)))
    except ValueError:
        return fallback


def _env_bool(name: str, fallback: bool = False, env=os.environ) -> bool:
    value = env.get(name)
    if value is None:
        return fallback
    return value.strip().lower() in {"1", "true", "yes", "on"}


def parse_allowed_origins(value: str | None) -> list[str]:
    if not value:
        return []
    return [origin.strip() for origin in value.split(",") if origin.strip()]


def server_runtime_config(env=os.environ) -> dict:
    port = env.get("WORDFINDER_PORT", env.get("PORT", "8000"))
    return {
        "host": env.get("WORDFINDER_HOST", "127.0.0.1"),
        "port": _env_int("WORDFINDER_PORT", int(port) if port.isdigit() else 8000, env=env),
        "reload": _env_bool("WORDFINDER_DEV_RELOAD", False, env=env),
    }


app = FastAPI(title="Word-Finder Crawler")

ALLOWED_ORIGINS = parse_allowed_origins(os.getenv("WORDFINDER_ALLOWED_ORIGINS"))
if ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET"],
        allow_headers=["x-wordfinder-token"],
    )

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


def client_ip_from_headers(headers, fallback: str, trust_proxy: bool = False) -> str:
    if not trust_proxy:
        return fallback

    forwarded_for = headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip() or fallback
    real_ip = headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip() or fallback
    return fallback


@dataclass
class CrawlAccessControl:
    required_token: str = ""
    scans_per_minute: int = 4
    max_active_sessions: int = 4
    max_active_sessions_per_ip: int = 2
    trust_proxy_headers: bool = False
    clock: Callable[[], float] = time.monotonic
    _recent_scans: dict[str, deque] = field(default_factory=lambda: defaultdict(deque))
    _active_sessions: int = 0
    _active_sessions_by_ip: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def authorize(self, token: str | None) -> tuple[bool, str | None]:
        if not self.required_token:
            return True, None
        if hmac.compare_digest(token or "", self.required_token):
            return True, None
        return False, "unauthorized"

    def check_rate_limit(self, client_ip: str) -> tuple[bool, str | None]:
        if self.scans_per_minute <= 0:
            return True, None

        now = self.clock()
        window_start = now - 60
        recent = self._recent_scans[client_ip]
        while recent and recent[0] <= window_start:
            recent.popleft()
        if len(recent) >= self.scans_per_minute:
            return False, "rate_limited"
        recent.append(now)
        return True, None

    def acquire_session(self, client_ip: str) -> tuple[bool, str | None]:
        if self.max_active_sessions > 0 and self._active_sessions >= self.max_active_sessions:
            return False, "too_many_sessions"
        if (
            self.max_active_sessions_per_ip > 0
            and self._active_sessions_by_ip[client_ip] >= self.max_active_sessions_per_ip
        ):
            return False, "too_many_sessions_for_ip"

        self._active_sessions += 1
        self._active_sessions_by_ip[client_ip] += 1
        return True, None

    def release_session(self, client_ip: str):
        self._active_sessions = max(0, self._active_sessions - 1)
        if self._active_sessions_by_ip[client_ip] <= 1:
            self._active_sessions_by_ip.pop(client_ip, None)
        else:
            self._active_sessions_by_ip[client_ip] -= 1


ACCESS_CONTROL = CrawlAccessControl(
    required_token=os.getenv("WORDFINDER_ACCESS_TOKEN", ""),
    scans_per_minute=_env_int("WORDFINDER_SCANS_PER_MINUTE", 4),
    max_active_sessions=_env_int("WORDFINDER_MAX_ACTIVE_SESSIONS", 4),
    max_active_sessions_per_ip=_env_int("WORDFINDER_MAX_ACTIVE_SESSIONS_PER_IP", 2),
    trust_proxy_headers=_env_bool("WORDFINDER_TRUST_PROXY", False),
)


def _close_reason(reason: str) -> str:
    return {
        "unauthorized": "Unauthorized.",
        "rate_limited": "Too many scans. Try again in a minute.",
        "too_many_sessions": "Too many scans are already running.",
        "too_many_sessions_for_ip": "Too many scans are already running from this address.",
    }.get(reason, "Connection rejected.")


@app.get("/")
async def index():
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.websocket("/ws/crawl")
async def crawl_ws(websocket: WebSocket):
    fallback_ip = websocket.client.host if websocket.client else "unknown"
    client_ip = client_ip_from_headers(
        websocket.headers,
        fallback=fallback_ip,
        trust_proxy=ACCESS_CONTROL.trust_proxy_headers,
    )
    crawler: WordFinderCrawler | None = None
    session_acquired = False

    try:
        await websocket.accept()
        raw_config = await asyncio.wait_for(
            websocket.receive_text(),
            timeout=INITIAL_WS_MESSAGE_TIMEOUT_SECONDS,
        )
        data = json.loads(raw_config)
        fallback_token = websocket.query_params.get("access_token") or websocket.headers.get("x-wordfinder-token")
        token = fallback_token or data.get("access_token")

        allowed, reason = ACCESS_CONTROL.authorize(token)
        if not allowed:
            await websocket.send_json({"type": "error", "payload": {"message": _close_reason(reason)}})
            await websocket.close(code=1008, reason=_close_reason(reason))
            return

        allowed, reason = ACCESS_CONTROL.acquire_session(client_ip)
        if not allowed:
            await websocket.send_json({"type": "error", "payload": {"message": _close_reason(reason)}})
            await websocket.close(code=1013, reason=_close_reason(reason))
            return
        session_acquired = True

        allowed, reason = ACCESS_CONTROL.check_rate_limit(client_ip)
        if not allowed:
            await websocket.send_json({"type": "error", "payload": {"message": _close_reason(reason)}})
            await websocket.close(code=1008, reason=_close_reason(reason))
            return

        config = CrawlConfig(
            start_url=data["start_url"],
            keyword=data["keyword"],
            max_depth=int(data.get("max_depth", 2)),
            max_pages=int(data.get("max_pages", 60)),
            max_concurrency=int(data.get("max_concurrency", 8)),
            whole_word=bool(data.get("whole_word", True)),
            case_sensitive=bool(data.get("case_sensitive", False)),
            match_mode=str(data.get("match_mode", "exact_word")),
            include_variants=bool(data.get("include_variants", False)),
            search_scope=str(data.get("search_scope", "visible_text")),
        )

        crawler = WordFinderCrawler(config)

        # listen in parallel for a possible "stop" message from the client
        async def listen_for_stop():
            try:
                while True:
                    msg = await websocket.receive_text()
                    if msg == "stop":
                        crawler.stop()
                        break
            except WebSocketDisconnect:
                if crawler:
                    crawler.stop()

        stop_listener = asyncio.create_task(listen_for_stop())

        async for event in crawler.run():
            await websocket.send_json({"type": event.type, "payload": event.payload})

        stop_listener.cancel()
        with suppress(asyncio.CancelledError):
            await stop_listener
        await websocket.close()

    except WebSocketDisconnect:
        if crawler:
            crawler.stop()
    except asyncio.TimeoutError:
        with suppress(Exception):
            await websocket.send_json({"type": "error", "payload": {"message": "Authentication timed out."}})
            await websocket.close(code=1008, reason="Authentication timed out.")
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "payload": {"message": str(e)}})
            await websocket.close()
        except Exception:
            pass
    finally:
        if session_acquired:
            ACCESS_CONTROL.release_session(client_ip)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", **server_runtime_config())
