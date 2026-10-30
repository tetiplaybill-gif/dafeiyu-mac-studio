#!/bin/zsh
set -eu
cd "$(dirname "$0")"
exec /usr/bin/python3 tools/mac_studio.py --open
