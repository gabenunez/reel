#!/usr/bin/env bash
# Stop MEDIA!, optionally rebuild for a new public URL prefix, then start again.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib/ui.sh
source "$ROOT/scripts/lib/ui.sh"

REBUILD=false
if [[ "${1:-}" == "--rebuild" ]]; then
  REBUILD=true
fi

LOCK_FILE="$(media_config_dir)/restarting.lock"
if [[ -f "$LOCK_FILE" ]]; then
  lock_pid="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "Restart already in progress (pid $lock_pid)" >&2
    exit 0
  fi
fi
echo $$ >"$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

read_config_public_prefix() {
  media_read_config_public_prefix "$ROOT/config.yaml"
}

read_config_port() {
  media_read_config_port "$ROOT/config.yaml"
}

uses_systemd() {
  [[ -f /etc/systemd/system/reel.service ]] && systemctl list-unit-files reel.service &>/dev/null
}

listener_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$port" 2>/dev/null |
      awk '{for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/) print $i}' || true
  fi
}

cleanup_pid_files() {
  local config_dir
  config_dir="$(media_config_dir)"
  rm -f "$config_dir/reel.pid" "${HOME}/.config/media-app/reel.pid" "${HOME}/.config/reel/reel.pid"
}

stop_running_reel() {
  local pid_file pid config_dir supervisor_pid public_port api_port
  config_dir="$(media_config_dir)"
  pid_file="$config_dir/reel.pid"
  pid=""
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
  elif [[ -f "${HOME}/.config/media-app/reel.pid" ]]; then
    pid="$(cat "${HOME}/.config/media-app/reel.pid" 2>/dev/null || true)"
  elif [[ -f "${HOME}/.config/reel/reel.pid" ]]; then
    pid="$(cat "${HOME}/.config/reel/reel.pid" 2>/dev/null || true)"
  fi

  if uses_systemd; then
    if [[ -n "${MEDIA_SUDO:-}" ]]; then
      $MEDIA_SUDO systemctl stop reel.service 2>/dev/null || true
    else
      systemctl stop reel.service 2>/dev/null || true
    fi
  fi

  supervisor_pid="$(cat "$ROOT/data/.start-prod.lock/pid" 2>/dev/null || true)"
  for candidate in "$pid" "$supervisor_pid"; do
    if [[ -n "$candidate" ]] && kill -0 "$candidate" 2>/dev/null; then
      kill "$candidate" 2>/dev/null || true
    fi
  done

  pkill -f "packages/server/dist/index.js" 2>/dev/null || true
  pkill -f "packages/web/.next/standalone/packages/web/server.js" 2>/dev/null || true
  pkill -f "scripts/start-prod.sh" 2>/dev/null || true

  # Use actual listening sockets as the source of truth. pgrep can match its
  # own search command and must not prevent a replacement from starting.
  public_port="$(read_config_port)"
  public_port="${public_port:-8096}"
  api_port=$((public_port + 1))
  for port in "$public_port" "$api_port"; do
    for listener in $(listener_pids "$port"); do
      [[ "$listener" == "$$" ]] || kill "$listener" 2>/dev/null || true
    done
  done

  for _ in $(seq 1 40); do
    if [[ -z "$(listener_pids "$public_port")" ]] &&
      [[ -z "$(listener_pids "$api_port")" ]]; then
      break
    fi
    sleep 0.25
  done

  # Force-release stubborn listeners; never leave the app offline because an
  # old process ignored graceful termination.
  for port in "$public_port" "$api_port"; do
    for listener in $(listener_pids "$port"); do
      [[ "$listener" == "$$" ]] || kill -9 "$listener" 2>/dev/null || true
    done
  done
  rm -rf "$ROOT/data/.start-prod.lock"
  cleanup_pid_files
}

start_running_reel() {
  if uses_systemd; then
    if [[ -n "${MEDIA_SUDO:-}" ]]; then
      $MEDIA_SUDO systemctl start reel.service
    else
      systemctl start reel.service
    fi
    return 0
  fi

  local config_dir pid_file
  config_dir="$(media_config_dir)"
  mkdir -p "$config_dir"
  pid_file="$config_dir/reel.pid"
  export PATH="${HOME}/node/bin:${PATH:-}"
  rm -rf "$ROOT/data/.start-prod.lock"
  nohup bash scripts/start-prod.sh >>"$config_dir/reel.log" 2>&1 &
  echo $! >"$pid_file"
}

# Let the settings API response flush before we stop the server.
sleep 2

PUBLIC_PREFIX="$(read_config_public_prefix || true)"
if [[ -n "${PUBLIC_PREFIX}" ]]; then
  export MEDIA_PUBLIC_PREFIX="${PUBLIC_PREFIX}"
else
  unset MEDIA_PUBLIC_PREFIX
fi

stop_running_reel

if [[ "$REBUILD" == "true" ]]; then
  export PATH="${HOME}/node/bin:${PATH:-}"
  rm -rf packages/web/.next packages/web/.turbo packages/web/out
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  export TURBO_FORCE=1
  pnpm --filter @media-app/shared build
  pnpm --filter @media-app/server build
  (cd packages/web && node scripts/with-api-for-build.mjs)
fi

start_running_reel
