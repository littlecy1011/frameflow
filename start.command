#!/bin/zsh

set -u

APP_DIR="${0:A:h}"
APP_URL="http://127.0.0.1:8094/"

cd "$APP_DIR" || exit 1

python3 app.py --host 127.0.0.1 --port 8094 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

for _ in {1..30}; do
  if curl -fsS "$APP_URL/api/health" >/dev/null 2>&1; then
    open "$APP_URL"
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 0.2
done

echo "工作台启动失败，请检查上方错误信息。"
wait "$SERVER_PID"
