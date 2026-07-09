#!/usr/bin/env bash
set -uo pipefail

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

API_PID=""
WEB_PID=""

cleanup_children() {
  if [[ -n "$WEB_PID" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
  fi
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  WEB_PID=""
  API_PID=""
}

trap cleanup_children EXIT INT TERM

start_api() {
  MEDIA_API_ONLY=1 MEDIA_INTERNAL_API_PORT="$API_PORT" MEDIA_WEB_INTERNAL_URL="http://127.0.0.1:${PUBLIC_PORT}" \
    node packages/server/dist/index.js &
  API_PID=$!
}

start_web() {
  HOSTNAME="$HOST" PORT="$PUBLIC_PORT" \
    MEDIA_INTERNAL_API_URL="http://127.0.0.1:${API_PORT}" \
    MEDIA_INTERNAL_API_PORT="$API_PORT" \
    MEDIA_RUNTIME_API_PORT="$API_PORT" \
    MEDIA_PUBLIC_PREFIX="$PUBLIC_PREFIX" \
    NEXT_PUBLIC_BASE_PATH="$PUBLIC_PREFIX" \
    node packages/web/.next/standalone/packages/web/server.js &
  WEB_PID=$!
}

wait_for_api() {
  for _ in $(seq 1 120); do
    if curl -sf "http://127.0.0.1:${API_PORT}/api/status" >/dev/null 2>&1; then
      return 0
    fi
    if ! kill -0 "$API_PID" 2>/dev/null; then
      wait "$API_PID" 2>/dev/null || true
      return 1
    fi
    sleep 0.25
  done
  return 1
}

monitor_stack() {
  local api_failures=0

  while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
    sleep 10

    if curl -sf "http://127.0.0.1:${API_PORT}/api/status" >/dev/null 2>&1; then
      api_failures=0
      continue
    fi

    api_failures=$((api_failures + 1))
    if [[ "$api_failures" -ge 3 ]]; then
      echo "MEDIA! API stopped responding — restarting stack" >&2
      return 1
    fi
  done

  return 1
}

while true; do
  cleanup_children
  start_api

  if ! wait_for_api; then
    echo "MEDIA! API failed to start — retrying in 5s" >&2
    cleanup_children
    sleep 5
    continue
  fi

  start_web

  echo ""
  echo "MEDIA! running:"
  echo "  Web: http://localhost:${PUBLIC_PORT}"
  echo "  API: http://127.0.0.1:${API_PORT}"
  echo ""

  monitor_stack || true
  echo "MEDIA! restarting stack in 2s..." >&2
  cleanup_children
  sleep 2
done
