#!/usr/bin/env python3
"""Locate existing runtime; never install packages or touch the keyed studio process."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
URL = "http://127.0.0.1:18768/"
try:
    response = json.load(urllib.request.urlopen(URL + "health", timeout=1))
    if response.get("service") == "bailong-danmaku":
        if "--open" in sys.argv:
            subprocess.run(["/usr/bin/open", URL], check=False)
        print("弹幕接入服务已经运行。")
        sys.exit(0)
except (OSError, ValueError):
    pass
bundled = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
node = str(bundled) if bundled.is_file() else shutil.which("node")
if not node:
    sys.exit("没有找到已有的 Node.js；请先配置运行环境。未安装任何软件。")
if "--open" in sys.argv:
    # The browser may load before the server; its UI can be refreshed in that case.
    subprocess.Popen(["/bin/sh", "-c", "sleep 1; /usr/bin/open http://127.0.0.1:18768/"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
args = [arg for arg in sys.argv[1:] if arg != "--open"]
os.execv(node, [node, str(ROOT / "tools/mac_danmaku.cjs")] + args)
