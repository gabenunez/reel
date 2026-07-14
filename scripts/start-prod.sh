#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Only one production supervisor may own the API/Web pair.
SUPERVISOR_LOCK_DIR="$ROOT/data/.start-prod.lock"
mkdir -p "$ROOT/data"
if ! mkdir "$SUPERVISOR_LOCK_DIR" 2>/dev/null; then
  existing_pid="$(cat "$SUPERVISOR_LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "MEDIA! supervisor already running (pid $existing_pid)" >&2
    exit 0
  fi
  rm -rf "$SUPERVISOR_LOCK_DIR"
  mkdir "$SUPERVISOR_LOCK_DIR"
fi
echo "$$" >"$SUPERVISOR_LOCK_DIR/pid"

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
GATEWAY_PID=""

cleanup_children() {
  if [[ -n "$GATEWAY_PID" ]] && kill -0 "$GATEWAY_PID" 2>/dev/null; then
    kill "$GATEWAY_PID" 2>/dev/null || true
    wait "$GATEWAY_PID" 2>/dev/null || true
  fi
  if [[ -n "$WEB_PID" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
  fi
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  GATEWAY_PID=""
  WEB_PID=""
  API_PID=""
}

shutdown() {
  trap - EXIT INT TERM
  cleanup_children
  rm -rf "$SUPERVISOR_LOCK_DIR"
  exit 0
}

trap 'cleanup_children; rm -rf "$SUPERVISOR_LOCK_DIR"' EXIT
trap shutdown INT TERM

start_api() {
  MEDIA_API_ONLY=1 MEDIA_INTERNAL_API_PORT="$API_PORT" MEDIA_WEB_INTERNAL_URL="http://127.0.0.1:${PUBLIC_PORT}" \
    node packages/server/dist/index.js &
  API_PID=$!
}

start_web() {
  # When a public prefix is set, Next binds loopback-only and a tiny gateway
  # owns PUBLIC_PORT so "/" can 302 to "{prefix}/" (Next alone 404s outside basePath).
  local web_host="$HOST"
  local web_port="$PUBLIC_PORT"
  if [[ -n "$PUBLIC_PREFIX" ]]; then
    web_host="127.0.0.1"
    web_port="$((PUBLIC_PORT + 2))"
  fi

  HOSTNAME="$web_host" PORT="$web_port" \
    MEDIA_INTERNAL_API_URL="http://127.0.0.1:${API_PORT}" \
    MEDIA_INTERNAL_API_PORT="$API_PORT" \
    MEDIA_RUNTIME_API_PORT="$API_PORT" \
    MEDIA_PUBLIC_PREFIX="$PUBLIC_PREFIX" \
    NEXT_PUBLIC_BASE_PATH="$PUBLIC_PREFIX" \
    node packages/web/.next/standalone/packages/web/server.js &
  WEB_PID=$!

  if [[ -n "$PUBLIC_PREFIX" ]]; then
    if ! wait_for_web "$web_port"; then
      echo "MEDIA! web failed to become ready on :${web_port}" >&2
      return 1
    fi
    MEDIA_HOST="$HOST" \
      MEDIA_GATEWAY_PORT="$PUBLIC_PORT" \
      MEDIA_WEB_UPSTREAM_PORT="$web_port" \
      MEDIA_PUBLIC_PREFIX="$PUBLIC_PREFIX" \
      node "$ROOT/scripts/public-gateway.mjs" &
    GATEWAY_PID=$!
  fi
}

wait_for_web() {
  local port="$1"
  local probe_path="${PUBLIC_PREFIX:-}/"
  for _ in $(seq 1 120); do
    # Any HTTP response means Next is accepting connections (including 404/307).
    if curl -sS -m 1 -o /dev/null "http://127.0.0.1:${port}${probe_path}" 2>/dev/null ||
      curl -sS -m 1 -o /dev/null "http://127.0.0.1:${port}/" 2>/dev/null; then
      return 0
    fi
    if ! kill -0 "$WEB_PID" 2>/dev/null; then
      wait "$WEB_PID" 2>/dev/null || true
      return 1
    fi
    sleep 0.25
  done
  return 1
}

wait_for_api() {
  for _ in $(seq 1 120); do
    if curl -sf "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1; then
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
    if [[ -n "$GATEWAY_PID" ]] && ! kill -0 "$GATEWAY_PID" 2>/dev/null; then
      echo "MEDIA! gateway exited — restarting stack" >&2
      return 1
    fi

    sleep 10

    if curl -sf "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1; then
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

  if ! start_web; then
    echo "MEDIA! web/gateway failed to start — retrying in 5s" >&2
    cleanup_children
    sleep 5
    continue
  fi

  echo ""
  echo "MEDIA! running:"
  echo "  Web: http://localhost:${PUBLIC_PORT}${PUBLIC_PREFIX:+$PUBLIC_PREFIX/}"
  echo "  API: http://127.0.0.1:${API_PORT}"
  if [[ -n "$PUBLIC_PREFIX" ]]; then
    echo "  Root / redirects to ${PUBLIC_PREFIX}/"
  fi
  echo ""

  monitor_stack || true
  echo "MEDIA! restarting stack in 2s..." >&2
  cleanup_children
  sleep 2
done
