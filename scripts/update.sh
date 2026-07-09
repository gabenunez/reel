#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/ui.sh
source "$ROOT/scripts/lib/ui.sh"

MEDIA_REPO="${MEDIA_REPO:-https://github.com/gabenunez/media-app.git}"
MEDIA_BRANCH="${MEDIA_BRANCH:-main}"

detect_install_dir() {
  if [[ -n "${MEDIA_INSTALL_DIR:-}" ]]; then
    printf '%s' "$MEDIA_INSTALL_DIR"
    return 0
  fi

  if [[ -f /etc/systemd/system/reel.service ]]; then
    awk -F= '/^WorkingDirectory=/{print $2; exit}' /etc/systemd/system/reel.service
    return 0
  fi

  if [[ -f "$ROOT/package.json" ]] && grep -q '"name": "media-app"' "$ROOT/package.json" 2>/dev/null; then
    printf '%s' "$ROOT"
    return 0
  fi

  if [[ -f /opt/media-app/package.json ]]; then
    printf '/opt/media-app'
    return 0
  fi

  return 1
}

detect_service_user() {
  if [[ -n "${MEDIA_USER:-}" ]]; then
    printf '%s' "$MEDIA_USER"
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
  elif [[ -n "${MEDIA_SUDO:-}" ]]; then
    $MEDIA_SUDO -u "$user" bash -c "$*"
  else
    media_fail "Need sudo to run commands as $user"
  fi
}

normalize_git_origin() {
  local dir="$1"
  [[ -d "$dir/.git" ]] || return 0
  git -C "$dir" remote set-url origin "$MEDIA_REPO"
}

sync_release_from_github() {
  local dir="$1"
  local ref="${MEDIA_RELEASE_TAG:-$MEDIA_BRANCH}"

  media_warn "Git fetch failed — syncing from GitHub over HTTPS"
  local tmp=""
  tmp="$(mktemp -d)"
  trap '[[ -n "${tmp:-}" ]] && rm -rf "$tmp"' RETURN

  GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch "$ref" "$MEDIA_REPO" "$tmp/reel"

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

  media_ok "Synced release $ref"
}

pull_latest() {
  local dir="$1"
  local user="$2"

  if [[ -d "$dir/.git" ]]; then
    normalize_git_origin "$dir"

    if [[ -n "${MEDIA_RELEASE_TAG:-}" ]]; then
      media_ok "Fetching ${MEDIA_RELEASE_TAG} from GitHub..."
      if ! run_as_install_user "$user" "
        set -euo pipefail
        export GIT_TERMINAL_PROMPT=0
        cd '$dir'
        git fetch origin 'refs/tags/${MEDIA_RELEASE_TAG}:refs/tags/${MEDIA_RELEASE_TAG}' --depth=1 2>/dev/null \
          || git fetch origin tag '${MEDIA_RELEASE_TAG}' --depth=1 2>/dev/null \
          || git fetch origin tag '${MEDIA_RELEASE_TAG}'
        git reset --hard
        git clean -fd --exclude=config.yaml --exclude=data --exclude=node_modules
        git checkout '${MEDIA_RELEASE_TAG}'
      "; then
        sync_release_from_github "$dir"
      fi
      return 0
    fi

    media_ok "Pulling latest from $MEDIA_BRANCH..."
    if ! run_as_install_user "$user" "
      set -euo pipefail
      export GIT_TERMINAL_PROMPT=0
      cd '$dir'
      git fetch origin '$MEDIA_BRANCH' --depth=1 2>/dev/null || git fetch origin '$MEDIA_BRANCH'
      git checkout '$MEDIA_BRANCH' 2>/dev/null || true
      git reset --hard 'origin/$MEDIA_BRANCH' 2>/dev/null || git pull origin '$MEDIA_BRANCH'
    "; then
      sync_release_from_github "$dir"
    fi
    return 0
  fi

  media_warn "No git history found — syncing from GitHub (config and data are preserved)"
  local tmp=""
  tmp="$(mktemp -d)"
  trap '[[ -n "${tmp:-}" ]] && rm -rf "$tmp"' RETURN

  git clone --depth 1 --branch "${MEDIA_RELEASE_TAG:-$MEDIA_BRANCH}" "$MEDIA_REPO" "$tmp/reel"

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

  media_ok "Synced latest source"
}

build_app() {
  local dir="$1"
  local user="$2"

  media_ok "Installing dependencies and building..."
  local prefix_export=""
  local prefix
  prefix="$(read_config_public_prefix "$dir/config.yaml")"
  if [[ -n "$prefix" ]]; then
    prefix_export="export MEDIA_PUBLIC_PREFIX='${prefix}';"
  fi
  run_as_install_user "$user" "
    set -euo pipefail
    cd '$dir'
    export CI=1
    export PATH=\"\${HOME}/node/bin:\${PATH:-}\"
    ${prefix_export}
    rm -rf packages/web/.next packages/web/.turbo packages/web/out
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    export TURBO_FORCE=1
    if [[ -z \"\${MEDIA_PUBLIC_PREFIX:-}\" ]]; then
      unset MEDIA_PUBLIC_PREFIX
    fi
    pnpm --filter @media-app/shared build
    pnpm --filter @media-app/server build
    (cd packages/web && node scripts/with-api-for-build.mjs)
  "
}

ensure_startup_script() {
  local install_dir="$1"
  local startup="${HOME}/.startup/reel"

  mkdir -p "${HOME}/.startup"
  if [[ -x "$startup" ]] && grep -q "start-prod.sh" "$startup" 2>/dev/null; then
    return 0
  fi

  if [[ -f "$startup" ]]; then
    cp "$startup" "${startup}.legacy.$(date +%s)" 2>/dev/null || true
    media_warn "Replacing legacy ~/.startup/reel (backup saved with .legacy suffix)"
  fi

  cat >"$startup" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$install_dir"
export PATH="\${HOME}/node/bin:\${PATH:-}"
exec bash scripts/start-prod.sh
EOF
  chmod +x "$startup"
  media_ok "Configured ~/.startup/reel to run scripts/start-prod.sh"
}

read_config_port() {
  local config="$1"
  if [[ -f "$config" ]]; then
    awk '/^server:/{found=1} found && /^  port:/{print $2; exit}' "$config"
  fi
}

read_config_public_prefix() {
  local config="$1"
  if [[ -f "$config" ]]; then
    awk '/^server:/{found=1} found && /^  public_prefix:/{gsub(/"/, "", $2); print $2; exit}' "$config"
  fi
}

verify_web_runtime() {
  local install_dir="$1"
  local port api_port
  port="$(read_config_port "$install_dir/config.yaml")"
  port="${port:-8096}"
  api_port=$((port + 1))

  sleep 3
  if curl -sf -m 15 "http://127.0.0.1:${api_port}/api/status" >/dev/null 2>&1; then
    media_ok "API is responding on port ${api_port}"
  else
    media_warn "API is not responding on http://127.0.0.1:${api_port}/api/status"
    media_warn "The web UI will load but library data will be empty until the API is fixed"
    return 1
  fi

  local headers
  headers="$(curl -sI -m 15 "http://127.0.0.1:${port}/media/1/" 2>/dev/null || true)"

  if echo "$headers" | grep -qi "x-nextjs-prerender"; then
    media_ok "Next.js standalone is serving pages (ISR runtime active)"
    return 0
  fi

  media_warn "Web is still on the legacy static-export runtime (no x-nextjs-prerender header)"
  media_warn "Media pages will show client loaders until start-prod.sh is running"
  if [[ -f "${HOME}/.config/media-app/update.log" ]]; then
    media_warn "See tail of ~/.config/media-app/update.log for the last deploy"
  fi
  return 1
}

stop_running_reel() {
  local config_dir pid_file pid
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
    media_ok "Stopping MEDIA! (pid $pid)..."
    kill "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
    sleep 2
  fi
  pkill -f "node packages/server/dist/index.js" 2>/dev/null || true
  pkill -f "packages/web/.next/standalone/packages/web/server.js" 2>/dev/null || true
  pkill -f "scripts/start-prod.sh" 2>/dev/null || true
  sleep 1
  rm -f "$config_dir/reel.pid" "${HOME}/.config/media-app/reel.pid" "${HOME}/.config/reel/reel.pid"
}

restart_service() {
  if uses_systemd; then
    media_ok "Restarting reel service..."
    if [[ -n "${MEDIA_SUDO:-}" ]]; then
      $MEDIA_SUDO systemctl restart reel.service
      sleep 2
      if $MEDIA_SUDO systemctl is-active --quiet reel.service; then
        media_ok "Service running"
      else
        media_warn "Service may have failed — run: sudo journalctl -u reel -n 30"
      fi
    else
      systemctl restart reel.service
    fi
  elif [[ -x "${HOME}/.startup/reel" ]] || [[ -d "${HOME}/.startup" ]]; then
    ensure_startup_script "$(detect_install_dir)"
    media_ok "Restarting via ~/.startup/reel..."
    stop_running_reel
    "${HOME}/.startup/reel"
  else
    local config_dir pid_file install_dir
    config_dir="$(media_config_dir)"
    mkdir -p "$config_dir"
    pid_file="$config_dir/reel.pid"
    if [[ -f "$pid_file" ]] || [[ -f "${HOME}/.config/media-app/reel.pid" ]] || [[ -f "${HOME}/.config/reel/reel.pid" ]]; then
      media_ok "Restarting MEDIA! process..."
      stop_running_reel
      install_dir="$(detect_install_dir)"
      export PATH="${HOME}/node/bin:${PATH:-}"
      cd "$install_dir"
      nohup bash scripts/start-prod.sh >> "$config_dir/reel.log" 2>&1 &
      echo $! > "$pid_file"
      media_ok "MEDIA! restarted (pid $(cat "$pid_file"))"
    else
      media_warn "No systemd service found — restart manually with: pnpm start"
    fi
  fi
}

cleanup_update_lock() {
  local config_dir
  config_dir="$(media_config_dir)"
  rm -f "$config_dir/updating.lock" 2>/dev/null || true
  rm -f "${HOME}/.config/media-app/updating.lock" 2>/dev/null || true
  rm -f "${HOME}/.config/reel/updating.lock" 2>/dev/null || true
}

on_update_error() {
  media_progress "failed" "Update failed — see $(media_config_dir)/update.log for details"
  cleanup_update_lock
  exit 1
}

main() {
  trap on_update_error ERR
  trap cleanup_update_lock EXIT

  media_progress "preparing" "Preparing update..."
  echo -e "${REEL_BOLD}  MEDIA! — Update${REEL_RESET}"
  echo -e "${REEL_DIM}  Pull latest, rebuild, and restart${REEL_RESET}"
  echo ""

  local install_dir service_user
  install_dir="$(detect_install_dir)" || media_fail "Could not find MEDIA!. Set MEDIA_INSTALL_DIR=/path/to/reel"
  service_user="$(detect_service_user)"

  [[ -f "$install_dir/package.json" ]] || media_fail "Invalid install directory: $install_dir"

  if uses_systemd; then
    reel_need_sudo
  elif [[ "$(whoami)" != "$service_user" ]] && [[ ! -w "$install_dir" ]]; then
    reel_need_sudo
  fi

  local before after
  before="$(media_version_label "$install_dir")"

  media_step "Checking install"
  media_ok "Directory: $install_dir"
  media_ok "Current version: $before"

  if ! media_confirm "Update MEDIA! to the latest version?"; then
    echo "Cancelled."
    exit 0
  fi

  media_progress "downloading" "Downloading ${MEDIA_RELEASE_TAG:-latest release}..."
  media_step "Downloading updates"
  pull_latest "$install_dir" "$service_user"

  media_progress "building" "Installing dependencies and building — this may take a few minutes..."
  media_step "Building"
  if ! command -v pnpm >/dev/null 2>&1; then
    if command -v corepack >/dev/null 2>&1; then
      corepack enable 2>/dev/null || true
      corepack prepare pnpm@10.26.1 --activate 2>/dev/null || true
    fi
  fi
  command -v pnpm >/dev/null 2>&1 || media_fail "pnpm not found. Install Node 20+ and enable corepack."
  build_app "$install_dir" "$service_user"

  media_progress "restarting" "Restarting MEDIA! — this page will reconnect when the server is back..."
  media_step "Restarting"
  restart_service
  verify_web_runtime "$install_dir" || true

  after="$(media_version_label "$install_dir")"

  media_progress "complete" "Update complete — upgraded to ${after}"

  echo ""
  echo -e "${REEL_GREEN}${REEL_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${REEL_RESET}"
  echo -e "${REEL_GREEN}${REEL_BOLD}  Update complete${REEL_RESET}"
  echo -e "${REEL_GREEN}${REEL_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${REEL_RESET}"
  echo ""
  echo -e "  ${REEL_BOLD}Before:${REEL_RESET} ${REEL_DIM}$before${REEL_RESET}"
  echo -e "  ${REEL_BOLD}After:${REEL_RESET}  $after"
  echo ""

  trap - EXIT ERR
  cleanup_update_lock
}

main "$@"
