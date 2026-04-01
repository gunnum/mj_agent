#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -f ".env" ]]; then
  set -a
  source ".env"
  set +a
fi

PORT="${MJ_AGENT_PORT:-${PORT:-18123}}"
RUNTIME_DIR="$SCRIPT_DIR/runtime"
PID_FILE="$RUNTIME_DIR/midjourney-agent.pid"
SERVICE_LOG="$RUNTIME_DIR/service.log"

mkdir -p "$RUNTIME_DIR"

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$EXISTING_PID" ]]; then
    kill "$EXISTING_PID" >/dev/null 2>&1 || true
  fi
fi

EXISTING_PIDS="$(lsof -ti tcp:"$PORT" || true)"
if [[ -n "$EXISTING_PIDS" ]]; then
  for pid in ${(f)EXISTING_PIDS}; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  sleep 1
fi

EXISTING_PIDS="$(lsof -ti tcp:"$PORT" || true)"
if [[ -n "$EXISTING_PIDS" ]]; then
  for pid in ${(f)EXISTING_PIDS}; do
    kill -9 "$pid" >/dev/null 2>&1 || true
  done
  sleep 1
fi

rm -f "$PID_FILE"

(
  cd "$SCRIPT_DIR"
  nohup node --import tsx src/server.ts >>"$SERVICE_LOG" 2>&1 </dev/null &!
)

for _ in {1..15}; do
  LISTEN_PID="$(lsof -ti tcp:"$PORT" || true)"
  if [[ -n "$LISTEN_PID" ]]; then
    echo "$LISTEN_PID" >"$PID_FILE"
    echo "midjourney-agent started"
    echo "PID: $LISTEN_PID"
    echo "Service log: $SERVICE_LOG"
    echo "Request logs: $RUNTIME_DIR/request-logs"
    exit 0
  fi
  sleep 1
done

echo "midjourney-agent failed to start"
exit 1
