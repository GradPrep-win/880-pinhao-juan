#!/bin/bash
cd "$(dirname "$0")"
# 杀掉遗留
pkill -f "vite" 2>/dev/null; pkill -f "electron" 2>/dev/null
sleep 1

# vite 后台启动,等端口 ready
npx vite --port 5173 --host 127.0.0.1 > /tmp/vite.log 2>&1 &
echo $! > /tmp/vite.pid

# 等 vite 就绪
for i in $(seq 1 20); do
  if curl -s -o /dev/null http://127.0.0.1:5173/ 2>/dev/null; then
    break
  fi
  sleep 0.5
done

ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ./node_modules/.bin/electron .
