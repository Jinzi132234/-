#!/usr/bin/env bash
# macOS：双击启动，自动打开浏览器
cd "$(dirname "$0")"
( sleep 2; open "http://127.0.0.1:${WB_PORT:-4321}" ) &
exec ./start.sh
