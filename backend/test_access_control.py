import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

sys.path.insert(0, str(Path(__file__).parent))

import main
from main import CrawlAccessControl, client_ip_from_headers, parse_allowed_origins, server_runtime_config


class FakeCrawlerEvent:
    type = "done"
    payload = {"pages_done": 0, "matches_total": 0, "reason": "test"}


class FakeCrawler:
    def __init__(self, config):
        self.config = config

    async def run(self):
        yield FakeCrawlerEvent()

    def stop(self):
        pass


class AccessControlTests(unittest.TestCase):
    def test_parse_allowed_origins_ignores_empty_values(self):
        self.assertEqual(
            parse_allowed_origins(" https://wordfinder.example.com, ,https://admin.example.com "),
            ["https://wordfinder.example.com", "https://admin.example.com"],
        )

    def test_server_runtime_config_is_production_safe_by_default(self):
        config = server_runtime_config({})

        self.assertEqual(config["host"], "127.0.0.1")
        self.assertEqual(config["port"], 8000)
        self.assertFalse(config["reload"])

    def test_server_runtime_config_can_enable_dev_reload_explicitly(self):
        config = server_runtime_config(
            {
                "WORDFINDER_HOST": "0.0.0.0",
                "WORDFINDER_PORT": "9000",
                "WORDFINDER_DEV_RELOAD": "true",
            }
        )

        self.assertEqual(config["host"], "0.0.0.0")
        self.assertEqual(config["port"], 9000)
        self.assertTrue(config["reload"])

    def test_server_runtime_config_uses_platform_port_fallback(self):
        config = server_runtime_config({"PORT": "7000"})

        self.assertEqual(config["port"], 7000)

    def test_allows_when_no_token_is_configured(self):
        access = CrawlAccessControl(required_token="")

        allowed, reason = access.authorize(token=None)

        self.assertTrue(allowed)
        self.assertIsNone(reason)

    def test_rejects_missing_or_wrong_token_when_configured(self):
        access = CrawlAccessControl(required_token="secret")

        self.assertEqual(access.authorize(token=None), (False, "unauthorized"))
        self.assertEqual(access.authorize(token="wrong"), (False, "unauthorized"))

    def test_allows_correct_token_when_configured(self):
        access = CrawlAccessControl(required_token="secret")

        allowed, reason = access.authorize(token="secret")

        self.assertTrue(allowed)
        self.assertIsNone(reason)

    def test_rate_limits_per_ip(self):
        now = [100.0]
        access = CrawlAccessControl(
            required_token="",
            scans_per_minute=2,
            clock=lambda: now[0],
        )

        self.assertEqual(access.check_rate_limit("203.0.113.10"), (True, None))
        self.assertEqual(access.check_rate_limit("203.0.113.10"), (True, None))
        self.assertEqual(access.check_rate_limit("203.0.113.10"), (False, "rate_limited"))

        now[0] = 161.0

        self.assertEqual(access.check_rate_limit("203.0.113.10"), (True, None))

    def test_limits_active_sessions_per_ip_and_globally(self):
        access = CrawlAccessControl(
            required_token="",
            max_active_sessions=2,
            max_active_sessions_per_ip=1,
        )

        self.assertEqual(access.acquire_session("203.0.113.10"), (True, None))
        self.assertEqual(access.acquire_session("203.0.113.10"), (False, "too_many_sessions_for_ip"))
        self.assertEqual(access.acquire_session("203.0.113.20"), (True, None))
        self.assertEqual(access.acquire_session("203.0.113.30"), (False, "too_many_sessions"))

        access.release_session("203.0.113.10")

        self.assertEqual(access.acquire_session("203.0.113.30"), (True, None))

    def test_ignores_forwarded_headers_by_default(self):
        headers = {"x-forwarded-for": "198.51.100.10, 10.0.0.12"}

        self.assertEqual(client_ip_from_headers(headers, fallback="127.0.0.1"), "127.0.0.1")

    def test_uses_first_forwarded_for_ip_only_when_proxy_is_trusted(self):
        headers = {"x-forwarded-for": "198.51.100.10, 10.0.0.12"}

        self.assertEqual(
            client_ip_from_headers(headers, fallback="127.0.0.1", trust_proxy=True),
            "198.51.100.10",
        )

    def test_uses_fallback_ip_without_forwarded_header(self):
        self.assertEqual(client_ip_from_headers({}, fallback="127.0.0.1"), "127.0.0.1")

    def test_health_endpoint_reports_ok(self):
        client = TestClient(main.app)

        response = client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})


class WebSocketAccessTests(unittest.TestCase):
    def setUp(self):
        self.original_access_control = main.ACCESS_CONTROL

    def tearDown(self):
        main.ACCESS_CONTROL = self.original_access_control

    def test_rejects_unauthorized_websocket_before_scan_starts(self):
        main.ACCESS_CONTROL = CrawlAccessControl(required_token="secret")
        client = TestClient(main.app)

        with client.websocket_connect("/ws/crawl") as websocket:
            websocket.send_json(
                {
                    "start_url": "https://example.com",
                    "keyword": "example",
                }
            )
            self.assertEqual(websocket.receive_json()["type"], "error")
            close_message = websocket.receive()

        self.assertEqual(close_message["type"], "websocket.close")
        self.assertEqual(close_message["code"], 1008)

    def test_accepts_access_token_in_first_websocket_message(self):
        main.ACCESS_CONTROL = CrawlAccessControl(required_token="secret")
        client = TestClient(main.app)

        with patch.object(main, "WordFinderCrawler", FakeCrawler):
            with client.websocket_connect("/ws/crawl") as websocket:
                websocket.send_json(
                    {
                        "access_token": "secret",
                        "start_url": "https://example.com",
                        "keyword": "example",
                        "max_depth": 0,
                        "max_pages": 1,
                        "max_concurrency": 1,
                    }
                )

                self.assertEqual(websocket.receive_json()["type"], "done")

        self.assertEqual(main.ACCESS_CONTROL._active_sessions, 0)

    def test_rejects_query_token_without_first_message_token_after_transition(self):
        main.ACCESS_CONTROL = CrawlAccessControl(required_token="secret")
        client = TestClient(main.app)

        with patch.object(main, "WordFinderCrawler", FakeCrawler):
            with client.websocket_connect("/ws/crawl?access_token=secret") as websocket:
                websocket.send_json(
                    {
                        "start_url": "https://example.com",
                        "keyword": "example",
                        "max_depth": 0,
                        "max_pages": 1,
                        "max_concurrency": 1,
                    }
                )

                self.assertEqual(websocket.receive_json()["type"], "error")
                close_message = websocket.receive()

        self.assertEqual(close_message["type"], "websocket.close")
        self.assertEqual(close_message["code"], 1008)

    def test_wrong_first_message_token_does_not_consume_session_or_rate_limit(self):
        main.ACCESS_CONTROL = CrawlAccessControl(
            required_token="secret",
            scans_per_minute=1,
            max_active_sessions=1,
            max_active_sessions_per_ip=1,
        )
        client = TestClient(main.app)

        with client.websocket_connect("/ws/crawl") as websocket:
            websocket.send_json(
                {
                    "access_token": "wrong",
                    "start_url": "https://example.com",
                    "keyword": "example",
                }
            )
            self.assertEqual(websocket.receive_json()["type"], "error")
            close_message = websocket.receive()

        self.assertEqual(close_message["type"], "websocket.close")
        self.assertEqual(close_message["code"], 1008)
        self.assertEqual(main.ACCESS_CONTROL._active_sessions, 0)
        self.assertEqual(dict(main.ACCESS_CONTROL._active_sessions_by_ip), {})
        self.assertEqual(dict(main.ACCESS_CONTROL._recent_scans), {})


class AcceptFailureWebSocket:
    client = SimpleNamespace(host="203.0.113.10")
    headers = {}
    query_params = {}

    async def close(self, *args, **kwargs):
        pass

    async def accept(self):
        raise RuntimeError("handshake failed")

    async def send_json(self, *args, **kwargs):
        pass


class WebSocketSessionCleanupTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original_access_control = main.ACCESS_CONTROL

    def tearDown(self):
        main.ACCESS_CONTROL = self.original_access_control

    async def test_releases_session_when_accept_fails(self):
        main.ACCESS_CONTROL = CrawlAccessControl(
            required_token="",
            scans_per_minute=0,
            max_active_sessions=1,
            max_active_sessions_per_ip=1,
        )

        try:
            await main.crawl_ws(AcceptFailureWebSocket())
        except RuntimeError:
            pass

        self.assertEqual(main.ACCESS_CONTROL._active_sessions, 0)
        self.assertEqual(dict(main.ACCESS_CONTROL._active_sessions_by_ip), {})


if __name__ == "__main__":
    unittest.main()
