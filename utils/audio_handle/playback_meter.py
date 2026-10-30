"""Portable envelope published by the native Mac playback path (no mic capture)."""
import json
import time
from pathlib import Path


class PlaybackFileMeter:
    def __init__(self, path):
        self.path = Path(path)

    def read(self):
        now = time.time()
        silent = {"source_pid": 0, "session_count": 0, "peak": 0.0,
                  "updated_at": now, "source": "macos-playback"}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if not 0 <= now - float(data["updated_at"]) < 2:
                return silent
            return dict(silent, source_pid=int(data.get("source_pid", 0)),
                        session_count=int(data.get("session_count", 0)),
                        peak=max(0.0, min(1.0, float(data.get("peak", 0)))))
        except (OSError, ValueError, TypeError, KeyError):
            return silent
