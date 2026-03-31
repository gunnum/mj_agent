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
USER_ID="$(id -u)"
LABEL="local.midjourney-agent"
RUNTIME_DIR="$SCRIPT_DIR/runtime"
PLIST_FILE="$RUNTIME_DIR/$LABEL.plist"
PID_FILE="$RUNTIME_DIR/midjourney-agent.pid"
SERVICE_LOG="$RUNTIME_DIR/service.log"
START_CMD="cd \"$SCRIPT_DIR\" && if [[ -f \".env\" ]]; then set -a; source \".env\"; set +a; fi; exec node --import tsx src/server.ts"

mkdir -p "$RUNTIME_DIR"

EXISTING_PIDS="$(lsof -ti tcp:"$PORT" || true)"
if [[ -n "$EXISTING_PIDS" ]]; then
  for pid in ${(f)EXISTING_PIDS}; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  sleep 1
fi

cat >"$PLIST_FILE" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>WorkingDirectory</key>
  <string>$SCRIPT_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd "$SCRIPT_DIR" &amp;&amp; if [[ -f ".env" ]]; then set -a; source ".env"; set +a; fi; exec node --import tsx src/server.ts</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$SERVICE_LOG</string>
  <key>StandardErrorPath</key>
  <string>$SERVICE_LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$USER_ID/$LABEL" >/dev/null 2>&1 || true

if launchctl bootstrap "gui/$USER_ID" "$PLIST_FILE" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$USER_ID/$LABEL" >/dev/null 2>&1 || true
else
  echo "launchctl bootstrap failed, falling back to nohup mode"
  nohup /bin/zsh -lc "$START_CMD" >>"$SERVICE_LOG" 2>&1 </dev/null &!
fi

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
