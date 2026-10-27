#!/usr/bin/env bash
# 启动课程视频工作台（只监听本机）
set -euo pipefail
cd "$(dirname "$0")"

# 可选：项目根目录的 .env 会被自动读取（参考 .env.example）
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

# 让 Node 的 fetch 走系统代理（访问 AIHubMix 等接口时常用）
if [ -n "${HTTPS_PROXY:-}" ]; then
  export NODE_USE_ENV_PROXY="${NODE_USE_ENV_PROXY:-1}"
fi

export WB_PORT="${WB_PORT:-4321}"
export WB_HOST="${WB_HOST:-127.0.0.1}"

if [ ! -d node_modules ]; then
  echo "首次运行，安装依赖…"
  npm install --no-audit --no-fund --cache ./.npm-cache
fi

echo "打开 http://${WB_HOST}:${WB_PORT}"
exec node server/index.mjs
