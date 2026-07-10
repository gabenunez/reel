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
  local config="$ROOT/config.yaml"
  if [[ -f "$config" ]]; then
    awk '/^server:/{found=1} found && /^  public_prefix:/{gsub(/"/, "", $2); print $2; exit}' "$config"
  fi
}

uses_systemd() {
  [[ -f /etc/systemd/system/reel.service ]] && systemctl list-unit-files reel.service &>/dev/null
}

cleanup_pid_files() {
  local config_dir
  config_dir="$(media_config_dir)"
  rm -f "$config_dir/reel.pid" "${HOME}/.config/media-app/reel.pid" "${HOME}/.config/reel/reel.pid"
}

stop_running_reel() {
  if uses_systemd; then
    if [[ -n "${MEDIA_SUDO:-}" ]]; then
      $MEDIA_SUDO systemctl stop reel.service 2>/dev/null || true
    else
      systemctl stop reel.service 2>/dev/null || true
    fi
    # systemd may be stopped while an older non-systemd owner is still alive.
    sleep 1
    pkill -f "packages/server/dist/index.js" 2>/dev/null || true
    pkill -f "packages/web/.next/standalone/packages/web/server.js" 2>/dev/null || true
    pkill -f "scripts/start-prod.sh" 2>/dev/null || true
    for _ in $(seq 1 40); do
      if ! pgrep -f "packages/server/dist/index.js" >/dev/null 2>&1 &&
        ! pgrep -f "packages/web/.next/standalone/packages/web/server.js" >/dev/null 2>&1 &&
        ! pgrep -f "scripts/start-prod.sh" >/dev/null 2>&1; then
        break
      fi
      sleep 0.25
    done
    if pgrep -f "packages/server/dist/index.js" >/dev/null 2>&1 ||
      pgrep -f "packages/web/.next/standalone/packages/web/server.js" >/dev/null 2>&1 ||
      pgrep -f "scripts/start-prod.sh" >/dev/null 2>&1; then
      echo "Could not stop all MEDIA! processes cleanly; refusing to start a duplicate." >&2
      exit 1
    fi
    cleanup_pid_files
    return 0
  fi

  local pid_file pid config_dir
  config_dir="$(media_config_dir)"
  pid_file="$config_dir/reel.pid"
  pid=""
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
  elif [[ -f "${HOME}/.config/media-app/reel.pid" ]]; then
    pid_file="${HOME}/.config/media-app/reel.pid"
    pid="$(cat "$pid_file" 2>/dev/null || true)"
  elif [[ -f "${HOME}/.config/reel/reel.pid" ]]; then
    pid_file="${HOME}/.config/reel/reel.pid"
    pid="$(cat "$pid_file" 2>/dev/null || true)"
  fi
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
    sleep 2
  fi
  pkill -f "packages/server/dist/index.js" 2>/dev/null || true
  pkill -f "packages/web/.next/standalone/packages/web/server.js" 2>/dev/null || true
  pkill -f "scripts/start-prod.sh" 2>/dev/null || true

  # Do not start a replacement until every old process has actually exited.
  # A short fixed sleep allowed orphaned API processes to retain port 8097.
  for _ in $(seq 1 40); do
    if ! pgrep -f "packages/server/dist/index.js" >/dev/null 2>&1 &&
      ! pgrep -f "packages/web/.next/standalone/packages/web/server.js" >/dev/null 2>&1 &&
      ! pgrep -f "scripts/start-prod.sh" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done

  if pgrep -f "packages/server/dist/index.js" >/dev/null 2>&1 ||
    pgrep -f "packages/web/.next/standalone/packages/web/server.js" >/dev/null 2>&1 ||
    pgrep -f "scripts/start-prod.sh" >/dev/null 2>&1; then
    echo "Could not stop all MEDIA! processes cleanly; refusing to start a duplicate." >&2
    exit 1
  fi
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
