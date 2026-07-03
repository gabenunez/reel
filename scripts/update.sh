#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/ui.sh
source "$ROOT/scripts/lib/ui.sh"

REEL_REPO="${REEL_REPO:-https://github.com/gabenunez/reel.git}"
REEL_BRANCH="${REEL_BRANCH:-main}"

detect_install_dir() {
  if [[ -n "${REEL_INSTALL_DIR:-}" ]]; then
    printf '%s' "$REEL_INSTALL_DIR"
    return 0
  fi

  if [[ -f /etc/systemd/system/reel.service ]]; then
    awk -F= '/^WorkingDirectory=/{print $2; exit}' /etc/systemd/system/reel.service
    return 0
  fi

  if [[ -f "$ROOT/package.json" ]] && grep -q '"name": "reel"' "$ROOT/package.json" 2>/dev/null; then
    printf '%s' "$ROOT"
    return 0
  fi

  if [[ -f /opt/reel/package.json ]]; then
    printf '/opt/reel'
    return 0
  fi

  return 1
}

detect_service_user() {
  if [[ -n "${REEL_USER:-}" ]]; then
    printf '%s' "$REEL_USER"
    return 0
  fi

  if [[ -f /etc/systemd/system/reel.service ]]; then
    awk -F= '/^User=/{print $2; exit}' /etc/systemd/system/reel.service
    return 0
  fi

  printf '%s' "$(whoami)"
}

uses_systemd() {
  [[ -f /etc/systemd/system/reel.service ]] && systemctl list-unit-files reel.service &>/dev/null
}

run_as_install_user() {
  local user="$1"
  shift
  if [[ "$(whoami)" == "$user" ]]; then
    bash -c "$*"
  elif [[ -n "${REEL_SUDO:-}" ]]; then
    $REEL_SUDO -u "$user" bash -c "$*"
  else
    reel_fail "Need sudo to run commands as $user"
  fi
}

normalize_git_origin() {
  local dir="$1"
  [[ -d "$dir/.git" ]] || return 0
  git -C "$dir" remote set-url origin "$REEL_REPO"
}

sync_release_from_github() {
  local dir="$1"
  local ref="${REEL_RELEASE_TAG:-$REEL_BRANCH}"

  reel_warn "Git fetch failed — syncing from GitHub over HTTPS"
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch "$ref" "$REEL_REPO" "$tmp/reel"

  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude config.yaml \
      --exclude data \
      --exclude node_modules \
      --exclude .next \
      --exclude out \
      --exclude .turbo \
      "$tmp/reel/" "$dir/"
  else
    find "$dir" -mindepth 1 -maxdepth 1 \
      ! -name config.yaml ! -name data ! -name node_modules \
      -exec rm -rf {} +
    cp -a "$tmp/reel/." "$dir/"
    rm -f "$dir/config.yaml"
  fi

  reel_ok "Synced release $ref"
}

pull_latest() {
  local dir="$1"
  local user="$2"

  if [[ -d "$dir/.git" ]]; then
    normalize_git_origin "$dir"

    if [[ -n "${REEL_RELEASE_TAG:-}" ]]; then
      reel_ok "Checking out release ${REEL_RELEASE_TAG}..."
      if ! run_as_install_user "$user" "
        set -euo pipefail
        export GIT_TERMINAL_PROMPT=0
        cd '$dir'
        git fetch origin 'refs/tags/${REEL_RELEASE_TAG}:refs/tags/${REEL_RELEASE_TAG}' --depth=1 2>/dev/null \
          || git fetch origin tag '${REEL_RELEASE_TAG}' --depth=1 2>/dev/null \
          || git fetch origin tag '${REEL_RELEASE_TAG}'
        git checkout '${REEL_RELEASE_TAG}'
      "; then
        sync_release_from_github "$dir"
      fi
      return 0
    fi

    reel_ok "Pulling latest from $REEL_BRANCH..."
    if ! run_as_install_user "$user" "
      set -euo pipefail
      export GIT_TERMINAL_PROMPT=0
      cd '$dir'
      git fetch origin '$REEL_BRANCH' --depth=1 2>/dev/null || git fetch origin '$REEL_BRANCH'
      git checkout '$REEL_BRANCH' 2>/dev/null || true
      git reset --hard 'origin/$REEL_BRANCH' 2>/dev/null || git pull origin '$REEL_BRANCH'
    "; then
      sync_release_from_github "$dir"
    fi
    return 0
  fi

  reel_warn "No git history found — syncing from GitHub (config and data are preserved)"
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  git clone --depth 1 --branch "${REEL_RELEASE_TAG:-$REEL_BRANCH}" "$REEL_REPO" "$tmp/reel"

  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude config.yaml \
      --exclude data \
      --exclude node_modules \
      --exclude .next \
      --exclude out \
      --exclude .turbo \
      "$tmp/reel/" "$dir/"
  else
    find "$dir" -mindepth 1 -maxdepth 1 \
      ! -name config.yaml ! -name data ! -name node_modules \
      -exec rm -rf {} +
    cp -a "$tmp/reel/." "$dir/"
    rm -f "$dir/config.yaml"
  fi

  reel_ok "Synced latest source"
}

build_app() {
  local dir="$1"
  local user="$2"

  reel_ok "Installing dependencies and building..."
  run_as_install_user "$user" "
    set -euo pipefail
    cd '$dir'
    export CI=1
    export PATH=\"\${HOME}/node/bin:\${PATH:-}\"
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    pnpm build
  "
}

stop_running_reel() {
  local pid=""
  if [[ -f "${HOME}/.config/reel/reel.pid" ]]; then
    pid="$(cat "${HOME}/.config/reel/reel.pid" 2>/dev/null || true)"
  fi
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    reel_ok "Stopping Reel (pid $pid)..."
    kill "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
    sleep 2
  fi
  pkill -f "node packages/server/dist/index.js" 2>/dev/null || true
  sleep 1
  rm -f "${HOME}/.config/reel/reel.pid"
}

restart_service() {
  if uses_systemd; then
    reel_ok "Restarting reel service..."
    if [[ -n "${REEL_SUDO:-}" ]]; then
      $REEL_SUDO systemctl restart reel.service
      sleep 2
      if $REEL_SUDO systemctl is-active --quiet reel.service; then
        reel_ok "Service running"
      else
        reel_warn "Service may have failed — run: sudo journalctl -u reel -n 30"
      fi
    else
      systemctl restart reel.service
    fi
  elif [[ -x "${HOME}/.startup/reel" ]]; then
    reel_ok "Restarting via ~/.startup/reel..."
    stop_running_reel
    "${HOME}/.startup/reel"
  elif [[ -f "${HOME}/.config/reel/reel.pid" ]]; then
    reel_ok "Restarting Reel process..."
    local pid
    pid="$(cat "${HOME}/.config/reel/reel.pid" 2>/dev/null || true)"
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
    fi
    sleep 2
    rm -f "${HOME}/.config/reel/reel.pid"
    local install_dir
    install_dir="$(detect_install_dir)"
    export PATH="${HOME}/node/bin:${PATH:-}"
    cd "$install_dir"
    nohup node packages/server/dist/index.js >> "${HOME}/.config/reel/reel.log" 2>&1 &
    echo $! > "${HOME}/.config/reel/reel.pid"
    reel_ok "Reel restarted (pid $(cat "${HOME}/.config/reel/reel.pid"))"
  else
    reel_warn "No systemd service found — restart manually with: pnpm start"
  fi
}

main() {
  cleanup_update_lock() {
    rm -f "${HOME}/.config/reel/updating.lock" 2>/dev/null || true
  }

  on_update_error() {
    reel_progress "failed" "Update failed — see ~/.config/reel/update.log for details"
    cleanup_update_lock
    exit 1
  }

  trap on_update_error ERR
  trap cleanup_update_lock EXIT

  reel_progress "preparing" "Preparing update..."
  echo -e "${REEL_BOLD}  Reel — Update${REEL_RESET}"
  echo -e "${REEL_DIM}  Pull latest, rebuild, and restart${REEL_RESET}"
  echo ""

  local install_dir service_user
  install_dir="$(detect_install_dir)" || reel_fail "Could not find Reel. Set REEL_INSTALL_DIR=/path/to/reel"
  service_user="$(detect_service_user)"

  [[ -f "$install_dir/package.json" ]] || reel_fail "Invalid install directory: $install_dir"

  if uses_systemd; then
    reel_need_sudo
  elif [[ "$(whoami)" != "$service_user" ]] && [[ ! -w "$install_dir" ]]; then
    reel_need_sudo
  fi

  local before after
  before="$(reel_version_label "$install_dir")"

  reel_step "Checking install"
  reel_ok "Directory: $install_dir"
  reel_ok "Current version: $before"

  if ! reel_confirm "Update Reel to the latest version?"; then
    echo "Cancelled."
    exit 0
  fi

  reel_progress "downloading" "Downloading ${REEL_RELEASE_TAG:-latest release}..."
  reel_step "Downloading updates"
  pull_latest "$install_dir" "$service_user"

  reel_progress "building" "Installing dependencies and building — this may take a few minutes..."
  reel_step "Building"
  if ! command -v pnpm >/dev/null 2>&1; then
    if command -v corepack >/dev/null 2>&1; then
      corepack enable 2>/dev/null || true
      corepack prepare pnpm@10.26.1 --activate 2>/dev/null || true
    fi
  fi
  command -v pnpm >/dev/null 2>&1 || reel_fail "pnpm not found. Install Node 20+ and enable corepack."
  build_app "$install_dir" "$service_user"

  reel_progress "restarting" "Restarting Reel — this page will reconnect when the server is back..."
  reel_step "Restarting"
  restart_service

  after="$(reel_version_label "$install_dir")"

  reel_progress "complete" "Update complete — upgraded to ${after}"

  echo ""
  echo -e "${REEL_GREEN}${REEL_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${REEL_RESET}"
  echo -e "${REEL_GREEN}${REEL_BOLD}  Update complete${REEL_RESET}"
  echo -e "${REEL_GREEN}${REEL_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${REEL_RESET}"
  echo ""
  echo -e "  ${REEL_BOLD}Before:${REEL_RESET} ${REEL_DIM}$before${REEL_RESET}"
  echo -e "  ${REEL_BOLD}After:${REEL_RESET}  $after"
  echo ""
}

main "$@"
