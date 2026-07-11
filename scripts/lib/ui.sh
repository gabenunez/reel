#!/usr/bin/env bash
# Shared terminal UI helpers for MEDIA! scripts

if [[ -t 1 ]]; then
  REEL_BOLD='\033[1m'
  REEL_DIM='\033[2m'
  REEL_GREEN='\033[0;32m'
  REEL_CYAN='\033[0;36m'
  REEL_YELLOW='\033[1;33m'
  REEL_RED='\033[0;31m'
  REEL_RESET='\033[0m'
else
  REEL_BOLD='' REEL_DIM='' REEL_GREEN='' REEL_CYAN=''
  REEL_YELLOW='' REEL_RED='' REEL_RESET=''
fi

media_step=0
media_step() {
  media_step=$((media_step + 1))
  echo ""
  echo -e "${REEL_BOLD}${REEL_CYAN}[$media_step]${REEL_RESET} ${REEL_BOLD}$1${REEL_RESET}"
  echo -e "${REEL_DIM}$(printf '%.0s─' {1..60})${REEL_RESET}"
}

media_ok()   { echo -e "  ${REEL_GREEN}✓${REEL_RESET} $1"; }
media_warn() { echo -e "  ${REEL_YELLOW}!${REEL_RESET} $1"; }
media_fail() { echo -e "  ${REEL_RED}✗${REEL_RESET} $1"; exit 1; }

media_confirm() {
  local __question="$1"
  if [[ "${MEDIA_NONINTERACTIVE:-}" == "1" ]]; then
    return 0
  fi
  local __answer
  read -rp "$(echo -e "  ${REEL_BOLD}?${REEL_RESET} $__question [Y/n]: ")" __answer
  [[ "${__answer:-Y}" =~ ^[Yy]?$ ]]
}

reel_need_sudo() {
  if [[ "$EUID" -eq 0 ]]; then
    MEDIA_SUDO=""
  elif command -v sudo >/dev/null 2>&1; then
    MEDIA_SUDO="sudo"
  else
    media_fail "Root or sudo access is required."
  fi
}

media_version_label() {
  local dir="$1"
  if [[ -f "$dir/package.json" ]]; then
    local version
    version="$(node -e "const p=require(process.argv[1]); if(p.version) process.stdout.write('v'+p.version)" "$dir/package.json" 2>/dev/null || true)"
    if [[ -n "$version" ]]; then
      printf '%s' "$version"
      return 0
    fi
  fi
  if [[ -d "$dir/.git" ]]; then
    git -C "$dir" describe --tags --always 2>/dev/null || git -C "$dir" log -1 --format='%h %s (%cr)' 2>/dev/null || echo "unknown"
  else
    echo "legacy install (no git)"
  fi
}

media_config_dir() {
  if [[ -d "${HOME}/.config/media-app" ]]; then
    printf '%s' "${HOME}/.config/media-app"
  elif [[ -d "${HOME}/.config/reel" ]]; then
    printf '%s' "${HOME}/.config/reel"
  else
    printf '%s' "${HOME}/.config/media-app"
  fi
}

# Read a value from config.yaml's `server:` block. Usage:
#   media_read_config_field <config-path> <field>
media_read_config_field() {
  local config="$1" field="$2"
  [[ -f "$config" ]] || return 0
  awk -v field="  $field:" '
    /^server:/ { found = 1 }
    found && index($0, field) == 1 { sub(/"/, "", $2); gsub(/"/, "", $2); print $2; exit }
  ' "$config"
}

media_read_config_port() {
  media_read_config_field "$1" "port"
}

media_read_config_public_prefix() {
  media_read_config_field "$1" "public_prefix"
}

media_progress() {
  local phase="$1"
  local message="$2"
  local progress_dir
  progress_dir="$(media_config_dir)"
  local tag="${MEDIA_RELEASE_TAG:-}"
  local lock_file="$progress_dir/updating.lock"
  local started_ms=""
  mkdir -p "$progress_dir"
  if [[ -f "$lock_file" ]]; then
    started_ms="$(head -1 "$lock_file" | tr -d '[:space:]')"
  fi
  node -e "
    const fs = require('fs');
    const startedMs = process.argv[5];
    const payload = {
      phase: process.argv[1],
      message: process.argv[2],
      releaseTag: process.argv[3] || null,
      startedAt:
        startedMs && /^\\d+$/.test(startedMs)
          ? new Date(Number(startedMs)).toISOString()
          : null,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(process.argv[4], JSON.stringify(payload));
  " "$phase" "$message" "$tag" "$progress_dir/update-progress.json" "$started_ms" 2>/dev/null \
    || printf '{"phase":"%s","message":"%s","releaseTag":"%s","updatedAt":"%s"}\n' \
      "$phase" "$message" "$tag" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$progress_dir/update-progress.json"
  echo "REEL_UPDATE_PROGRESS phase=$phase"
}
