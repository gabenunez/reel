#!/usr/bin/env bash
# Shared terminal UI helpers for Reel scripts

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

reel_step=0
reel_step() {
  reel_step=$((reel_step + 1))
  echo ""
  echo -e "${REEL_BOLD}${REEL_CYAN}[$reel_step]${REEL_RESET} ${REEL_BOLD}$1${REEL_RESET}"
  echo -e "${REEL_DIM}$(printf '%.0s─' {1..60})${REEL_RESET}"
}

reel_ok()   { echo -e "  ${REEL_GREEN}✓${REEL_RESET} $1"; }
reel_warn() { echo -e "  ${REEL_YELLOW}!${REEL_RESET} $1"; }
reel_fail() { echo -e "  ${REEL_RED}✗${REEL_RESET} $1"; exit 1; }

reel_confirm() {
  local __question="$1"
  if [[ "${REEL_NONINTERACTIVE:-}" == "1" ]]; then
    return 0
  fi
  local __answer
  read -rp "$(echo -e "  ${REEL_BOLD}?${REEL_RESET} $__question [Y/n]: ")" __answer
  [[ "${__answer:-Y}" =~ ^[Yy]?$ ]]
}

reel_need_sudo() {
  if [[ "$EUID" -eq 0 ]]; then
    REEL_SUDO=""
  elif command -v sudo >/dev/null 2>&1; then
    REEL_SUDO="sudo"
  else
    reel_fail "Root or sudo access is required."
  fi
}

reel_version_label() {
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

reel_progress() {
  local phase="$1"
  local message="$2"
  local progress_dir="${HOME}/.config/reel"
  local tag="${REEL_RELEASE_TAG:-}"
  mkdir -p "$progress_dir"
  node -e "
    const fs = require('fs');
    const payload = {
      phase: process.argv[1],
      message: process.argv[2],
      releaseTag: process.argv[3] || null,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(process.argv[4], JSON.stringify(payload));
  " "$phase" "$message" "$tag" "$progress_dir/update-progress.json" 2>/dev/null \
    || printf '{"phase":"%s","message":"%s","releaseTag":"%s","updatedAt":"%s"}\n' \
      "$phase" "$message" "$tag" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$progress_dir/update-progress.json"
  echo "REEL_UPDATE_PROGRESS phase=$phase"
}
