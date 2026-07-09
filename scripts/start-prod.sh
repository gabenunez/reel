#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

read_config_port() {
  local config="$ROOT/config.yaml"
  if [[ -f "$config" ]]; then
    awk '/^server:/{found=1} found && /^  port:/{print $2; exit}' "$config"
  fi
}

read_config_public_prefix() {
  local config="$ROOT/config.yaml"
  if [[ -f "$config" ]]; then
    awk '/^server:/{found=1} found && /^  public_prefix:/{gsub(/"/, "", $2); print $2; exit}' "$config"
  fi
}

CONFIG_PORT="$(read_config_port || true)"
PUBLIC_PORT="${MEDIA_PORT:-${CONFIG_PORT:-8096}}"
# Drop build-only env so a prior `pnpm build` cannot point runtime at the prerender API.
unset MEDIA_PRERENDER_BUILD MEDIA_PRERENDER_API_PORT MEDIA_INTERNAL_API_URL
API_PORT="${MEDIA_INTERNAL_API_PORT:-$((PUBLIC_PORT + 1))}"
HOST="${MEDIA_HOST:-0.0.0.0}"
PUBLIC_PREFIX="${MEDIA_PUBLIC_PREFIX:-$(read_config_public_prefix || true)}"
PUBLIC_PREFIX="${PUBLIC_PREFIX%/}"
if [[ -n "$PUBLIC_PREFIX" && "$PUBLIC_PREFIX" != /* ]]; then
  PUBLIC_PREFIX="/$PUBLIC_PREFIX"
fi
export MEDIA_PUBLIC_PREFIX="${PUBLIC_PREFIX}"

if [[ ! -f "$ROOT/packages/web/.next/standalone/packages/web/server.js" ]]; then
  echo "Missing Next standalone build. Run: pnpm build" >&2
  exit 1
fi

MEDIA_API_ONLY=1 MEDIA_INTERNAL_API_PORT="$API_PORT" MEDIA_WEB_INTERNAL_URL="http://127.0.0.1:${PUBLIC_PORT}" node packages/server/dist/index.js &
API_PID=$!

api_ready=false
for _ in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:${API_PORT}/api/status" >/dev/null 2>&1; then
    api_ready=true
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "MEDIA! API process exited before becoming ready (pid $API_PID)" >&2
    wait "$API_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 0.25
done

if [[ "$api_ready" != "true" ]]; then
  echo "MEDIA! API did not respond on http://127.0.0.1:${API_PORT}/api/status within 30s" >&2
  kill "$API_PID" 2>/dev/null || true
  exit 1
fi

HOSTNAME="$HOST" PORT="$PUBLIC_PORT" \
  MEDIA_INTERNAL_API_URL="http://127.0.0.1:${API_PORT}" \
  MEDIA_INTERNAL_API_PORT="$API_PORT" \
  MEDIA_RUNTIME_API_PORT="$API_PORT" \
  MEDIA_PUBLIC_PREFIX="$PUBLIC_PREFIX" \
  NEXT_PUBLIC_BASE_PATH="$PUBLIC_PREFIX" \
  node packages/web/.next/standalone/packages/web/server.js &
WEB_PID=$!

cleanup() {
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo ""
echo "MEDIA! running:"
echo "  Web: http://localhost:${PUBLIC_PORT}"
echo "  API: http://127.0.0.1:${API_PORT}"
echo ""

wait "$API_PID" "$WEB_PID"
