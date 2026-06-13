#!/usr/bin/env bash
# Stop the dev tunnel started by cloudflare-up.sh (PID file next to this script).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${SCRIPT_DIR}/cloudflared-tunnel.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No PID file at $PID_FILE — tunnel not running (or started outside npm run cloudflare:up)." >&2
  exit 1
fi

pid="$(tr -d ' \n' <"$PID_FILE" || true)"
if [[ -z "${pid:-}" ]]; then
  rm -f "$PID_FILE"
  echo "Empty PID file removed." >&2
  exit 1
fi

if ! kill -0 "$pid" 2>/dev/null; then
  echo "Process $pid not running; removing stale PID file." >&2
  rm -f "$PID_FILE"
  exit 0
fi

echo "Stopping cloudflared (PID $pid)..."
kill "$pid" 2>/dev/null || true
for _ in $(seq 1 30); do
  if ! kill -0 "$pid" 2>/dev/null; then
    break
  fi
  sleep 0.2
done
if kill -0 "$pid" 2>/dev/null; then
  echo "Sending SIGKILL to $pid" >&2
  kill -9 "$pid" 2>/dev/null || true
fi
rm -f "$PID_FILE"
echo "Tunnel stopped."
