"""Offline acceptance for timers, gift choreography and natural voice validation."""
import base64
import json
from pathlib import Path
import sys
import tempfile
import unittest
import wave
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
from mac_stage import StageTimer
from mac_voice import voice_request, save_result
import test_studio


class TimerTests(unittest.TestCase):
    def setUp(self):
        self.now = 100.0
        self.timer = StageTimer(lambda: self.now)

    def test_pause_resume_and_gift_preserve_remaining(self):
        self.timer.control({"action": "reset", "minutes": 2})
        self.timer.control({"action": "start"})
        self.now += 17
        self.assertEqual(self.timer.snapshot()["remaining_seconds"], 103)
        self.timer.control({"action": "pause"})
        self.now += 50
        self.timer.gift("小心心", 3)
        self.assertEqual(self.timer.snapshot()["remaining_seconds"], 283)
        self.timer.control({"action": "start"})
        self.now += 30
        self.assertEqual(self.timer.snapshot()["remaining_seconds"], 253)
        self.assertEqual(self.timer.snapshot()["elapsed_seconds"], 47)

    def test_expiry_does_not_reintroduce_elapsed_time_and_gift_can_extend(self):
        self.timer.control({"action": "reset", "minutes": 1})
        self.timer.control({"action": "start"})
        self.now += 100
        self.assertEqual(self.timer.snapshot()["remaining_seconds"], 0)
        self.assertFalse(self.timer.running)
        self.timer.gift("人气票", 1)
        self.assertEqual(self.timer.snapshot()["remaining_seconds"], 30)
        self.assertFalse(self.timer.running)

    def test_rules_validate_atomically_and_unknown_gifts_do_not_invent_time(self):
        with self.assertRaises(ValueError):
            self.timer.configure_rules({"小心心": {"seconds": 10}, "不存在": {"seconds": 20}})
        self.assertEqual(self.timer.rules["小心心"]["seconds"], 60)
        self.assertEqual(self.timer.gift("未知", 3)[1], 0)
        self.timer.configure_rules({"小心心": {"seconds": 7, "motion": "roam"}})
        rule, bonus = self.timer.gift("小心心", 3)
        self.assertEqual((rule["motion"], bonus), ("roam", 21))

    def test_timer_caps_at_24_hours_and_invalid_minutes_do_not_mutate(self):
        with self.assertRaises(ValueError):
            self.timer.control({"action": "reset", "minutes": "1.5"})
        _, bonus = self.timer.gift("加油鸭", 10000)
        self.assertEqual(bonus, 86400-3600)
        self.assertEqual(self.timer.snapshot()["remaining_seconds"], 86400)
        self.assertEqual(self.timer.gift("加油鸭", 1)[1], 0)


class GiftIntegrationTests(unittest.TestCase):
    setUp = test_studio.StudioTests.setUp
    tearDown = test_studio.StudioTests.tearDown

    def test_multigift_duplicate_and_stop_keep_time_credit(self):
        data = {"gift_name": "小心心", "gift_num": 3, "event_id": "same-gift"}
        self.app.enqueue("gift", data)
        self.app.enqueue("gift", data)
        self.app.jobs.join()
        result = self.app.snapshot()
        self.assertEqual(result["gifts"], 3)
        self.assertEqual(result["timer"]["added_seconds"], 180)
        self.assertEqual(result["motion"], "dance")
        self.app.stop()
        self.assertEqual(self.app.snapshot()["motion"], "none")
        self.assertEqual(self.app.snapshot()["timer"]["added_seconds"], 180)

    def test_motion_can_be_resumed_by_new_view_and_expires(self):
        self.app.choreography("roam")
        with patch("mac_studio.time.monotonic", return_value=self.app.state["motion_started"] + 4):
            state = self.app.snapshot()
            self.assertEqual(state["motion"], "roam")
            self.assertAlmostEqual(state["motion_elapsed_ms"], 4000)
        self.app.state["motion_started"] -= 20
        self.assertEqual(self.app.snapshot()["motion"], "none")

    def test_voice_settings_preserve_key_and_reject_nonfinite_speed(self):
        self.app.configure({"api_key": "test-only-not-a-real-key-1234567890"})
        self.app.configure({"voice_engine": "openai", "voice_name": "coral", "voice_style": "bright", "voice_speed": 1.05})
        self.assertTrue(self.app.snapshot()["key_ready"])
        self.assertEqual(self.app.snapshot()["voice_effective"], "openai")
        with self.assertRaises(Exception):
            self.app.configure({"voice_speed": float("nan")})
        self.assertEqual(self.app.snapshot()["voice_speed"], 1.05)
        self.app.configure({"clear_key": True})
        self.assertEqual(self.app.snapshot()["voice_effective"], "needs_key")

    def test_invalid_gift_count_has_no_side_effects(self):
        for value in (True, -1, 0, "1.5", 10001):
            with self.assertRaises(ValueError):
                self.app.enqueue("gift", {"count": value})
        self.assertEqual(self.app.snapshot()["gifts"], 0)
        self.assertEqual(self.app.snapshot()["timer"]["added_seconds"], 0)


class VoiceTests(unittest.TestCase):
    def test_request_uses_current_voice_model_with_no_microphone_and_exact_text(self):
        payload = voice_request("fake", "你好呀。", "marin", "gentle", .95)
        self.assertEqual(payload["session"]["model"], "gpt-realtime-2.1-mini")
        self.assertIsNone(payload["session"]["audio"]["input"]["turn_detection"])
        self.assertEqual(payload["response"]["input"][0]["content"][0]["text"], "你好呀。")
        self.assertEqual(payload["response"]["conversation"], "none")

    def test_audio_must_match_transcript_before_saving(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "voice.wav"
            data = {"transcript": "你好呀！", "pcm": base64.b64encode(b"\0\0" * 2400).decode(), "usage": {"total_tokens": 5}}
            self.assertEqual(save_result(json.dumps(data), "你好呀。", target)["total_tokens"], 5)
            with wave.open(str(target)) as audio:
                self.assertEqual((audio.getnchannels(), audio.getsampwidth(), audio.getframerate()), (1, 2, 24000))
            for bad in ("我不想说这个。", "你好"):
                data["transcript"] = bad
                with self.assertRaises(ValueError):
                    save_result(json.dumps(data), "你好呀。", Path(tmp)/"bad.wav")
                self.assertFalse((Path(tmp)/"bad.wav").exists())


if __name__ == "__main__":
    unittest.main()
