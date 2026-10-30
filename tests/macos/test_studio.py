"""Offline regression tests; never call a model or change installed pet files."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import io
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
spec = importlib.util.spec_from_file_location("mac_studio", ROOT / "tools/mac_studio.py")
studio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(studio)
from utils.audio_handle.playback_meter import PlaybackFileMeter


class StudioTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.assets = self.root / "assets"
        self.assets.mkdir()
        entries = []
        for aid in ("idle", "01", "17", "18", "20", "work04"):
            (self.assets / (aid + ".webp")).write_bytes(b"fixture-not-for-decoding")
            entries.append({"id": aid, "file": aid + ".webp", "name": aid, "durationMs": 500})
        self.manifest = {"character": "test", "idle": entries[0], "variants": entries[1:]}
        (self.assets / "素材清单.json").write_text(json.dumps(self.manifest))
        self.pack = studio.AssetPack(self.assets)
        self.app = studio.Studio(self.pack, self.root / "out", speech=False,
                                 client=lambda *args: ("你好，饼干分你一块。", {"input_tokens": 12, "output_tokens": 8}))

    def tearDown(self):
        self.app.stop()
        self.temp.cleanup()

    def test_no_model_call_without_explicit_key(self):
        with self.assertRaises(studio.StudioError):
            self.app.enqueue("chat", {"text": "你好"})
        self.assertEqual(self.app.snapshot()["messages"], 0)

    def test_key_is_memory_only_and_not_in_state(self):
        fake = "test-only-not-a-real-key-1234567890"
        self.app.configure({"api_key": fake})
        self.assertTrue(self.app.snapshot()["key_ready"])
        self.assertNotIn(fake, json.dumps(self.app.snapshot()))
        self.assertEqual(list((self.root / "out").iterdir()), [])
        self.app.configure({"clear_key": True})
        self.assertFalse(self.app.snapshot()["key_ready"])

    def test_chat_keeps_context_usage_and_complete_reply(self):
        self.app.configure({"api_key": "test-only-not-a-real-key-1234567890"})
        self.app.enqueue("chat", {"text": "你好"})
        self.app.jobs.join()
        result = self.app.snapshot()
        self.assertEqual(result["caption"], "你好，饼干分你一块。")
        self.assertEqual(result["replies"], 1)
        self.assertEqual(result["input_tokens"], 12)
        self.assertEqual(len(self.app.history), 2)

    def test_duplicate_gift_does_not_double_count(self):
        first = self.app.enqueue("gift", {"gift_name": "人气票", "event_id": "gift-42"})
        second = self.app.enqueue("gift", {"gift_name": "人气票", "event_id": "gift-42"})
        self.app.jobs.join()
        self.assertTrue(first["accepted"])
        self.assertTrue(second["duplicate"])
        self.assertEqual(self.app.snapshot()["gifts"], 1)
        self.assertEqual(self.app.snapshot()["action"], "17")

    def test_action_completes_back_to_idle(self):
        self.app.action("17")
        self.assertEqual(self.app.snapshot()["action"], "17")
        self.app.state["action_until"] = time.monotonic() - 1
        self.assertEqual(self.app.snapshot()["action"], "idle")

    def test_asset_manifest_cannot_escape_root(self):
        (self.root / "outside.webp").write_bytes(b"private")
        self.manifest["idle"]["file"] = "../outside.webp"
        (self.assets / "素材清单.json").write_text(json.dumps(self.manifest))
        with self.assertRaises(studio.StudioError):
            studio.AssetPack(self.assets)

    def test_unknown_action_is_rejected(self):
        with self.assertRaises(studio.StudioError):
            self.app.action("../../secrets")

    def test_interruption_discards_late_model_reply(self):
        entered, finish = threading.Event(), threading.Event()
        def delayed(*args):
            entered.set()
            finish.wait(2)
            return "不应播报", {}
        self.app.client = delayed
        self.app.configure({"api_key": "test-only-not-a-real-key-1234567890"})
        self.app.enqueue("chat", {"text": "你好"})
        self.assertTrue(entered.wait(2))
        self.app.stop()
        finish.set()
        self.app.jobs.join()
        self.assertNotEqual(self.app.snapshot()["caption"], "不应播报")
        self.assertEqual(self.app.snapshot()["replies"], 0)

    def test_response_requires_terminal_completion(self):
        result = {"status": "incomplete", "output": [{"type": "message", "content": [
            {"type": "output_text", "text": "部分文字"}]}]}
        with self.assertRaises(studio.StudioError):
            studio.response_text(result)
        result["status"] = "completed"
        self.assertEqual(studio.response_text(result), "部分文字")

    def test_openai_request_preserves_requested_model_and_disables_storage(self):
        result = {"status": "completed", "output": [{"type": "message", "content": [
            {"type": "output_text", "text": "你好"}]}], "usage": {"input_tokens": 4}}
        def respond(request, timeout):
            self.assertEqual(request.full_url, "https://api.openai.com/v1/responses")
            payload = json.loads(request.data)
            self.assertEqual(payload["model"], "gpt-6.1-terra")
            self.assertFalse(payload["store"])
            self.assertEqual(payload["reasoning"], {"effort": "none"})
            self.assertEqual(payload["input"][-1]["content"], "你好")
            return io.BytesIO(json.dumps(result).encode())
        with patch.object(studio.urllib.request, "urlopen", side_effect=respond):
            text, usage = studio.ask_openai("test-only", "你好", [])
        self.assertEqual(text, "你好")
        self.assertEqual(usage["input_tokens"], 4)

    def test_provider_error_does_not_echo_sensitive_response(self):
        error = urllib.error.HTTPError("https://api.openai.com/v1/responses", 401, "Unauthorized", {},
                                       io.BytesIO(b"sensitive-provider-body"))
        with patch.object(studio.urllib.request, "urlopen", side_effect=error) as mocked:
            with self.assertRaises(studio.StudioError) as caught:
                studio.ask_openai("test-only", "hello", [])
        self.assertNotIn("sensitive-provider-body", str(caught.exception))
        self.assertEqual(mocked.call_count, 1)

    def test_stale_audio_meter_returns_silence(self):
        path = self.root / "meter.json"
        path.write_text(json.dumps({"updated_at": time.time()-10, "peak": 1}))
        self.assertEqual(PlaybackFileMeter(path).read()["peak"], 0)
        path.write_text(json.dumps({"updated_at": time.time(), "peak": 0.5, "source_pid": 123}))
        self.assertEqual(PlaybackFileMeter(path).read()["peak"], 0.5)

    def test_http_only_serves_allowlisted_files_and_rejects_foreign_origin(self):
        server = studio.Server(("127.0.0.1", 0), studio.Handler)
        server.studio = self.app
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = "http://127.0.0.1:" + str(server.server_port)
        try:
            with urllib.request.urlopen(base + "/health") as response:
                self.assertTrue(json.load(response)["ok"])
            for path in ("/config.json", "/.git/config", "/character/../../config.json"):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(base + path)
                self.assertEqual(error.exception.code, 404)
            request = urllib.request.Request(base + "/api/configure", data=b"{}",
                      headers={"Content-Type":"application/json", "Origin":"https://example.com"})
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request)
            self.assertEqual(error.exception.code, 403)
            for path in ("/send_message?content=forged", "/effect?name=clap"):
                request = urllib.request.Request(base + path, headers={"Sec-Fetch-Site": "cross-site"})
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request)
                self.assertEqual(error.exception.code, 403)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
