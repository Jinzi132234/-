#!/usr/bin/env bash
# macOS：在背景啟動（不佔用 Terminal），啟動後自動打開瀏覽器
set -euo pipefail
cd "$(dirname "$0")"
python3 daemonize.py
sleep 2
open "http://127.0.0.1:${WB_PORT:-4321}"
