#!/usr/bin/env bash
# Start the dev Cloudflare tunnel in the background (nohup).
# Uses ~/.cloudflared/config-panono-webapp.yaml by default.
# Override: CLOUDFLARED_CONFIG=/path CLOUDFLARED_TUNNEL_NAME=name npm run cloudflare:up
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${SCRIPT_DIR}/cloudflared-tunnel.pid"
LOG_FILE="${SCRIPT_DIR}/tunnel.log"
TUNNEL_NAME="${CLOUDFLARED_TUNNEL_NAME:-panono-webapp-dev-tunnel}"
CONFIG="${CLOUDFLARED_CONFIG:-${HOME}/.cloudflared/config-panono-webapp.yaml}"

TUNNEL_CMD=(tunnel --config "${CONFIG}" run "${TUNNEL_NAME}")

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found. Install it and run: cloudflared tunnel login" >&2
  exit 1
fi

if [[ ! -f "$CONFIG" ]]; then
  echo "Config not found: $CONFIG" >&2
  echo "Copy cloudflare/config.yaml.example to your ~/.cloudflared/ and set credentials-file." >&2
  echo "See docs/CLOUDFLARED.md" >&2
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(tr -d ' \n' <"$PID_FILE" || true)"
  if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "Tunnel already running (PID $old_pid, name $TUNNEL_NAME). Stop with: npm run cloudflare:down" >&2
    exit 1
  fi
  rm -f "$PID_FILE"
fi

echo "Starting cloudflared tunnel '$TUNNEL_NAME' with config: $CONFIG"
echo "Local origin: http://127.0.0.1:3000 (hostname is in your config ingress)"
echo "Log: $LOG_FILE"
nohup cloudflared "${TUNNEL_CMD[@]}" >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
echo "PID $(cat "$PID_FILE")"
