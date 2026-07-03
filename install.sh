#!/usr/bin/env bash
# Reel one-line VPS installer
#
#   curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/reel/main/install.sh | bash
#
# Options (env vars):
#   REEL_REPO=https://github.com/YOUR_ORG/reel.git
#   REEL_BRANCH=main
#   REEL_INSTALL_DIR=/opt/reel
#   REEL_PORT=8096
#   REEL_USER=reel
#   REEL_NONINTERACTIVE=1

set -euo pipefail

REEL_REPO="${REEL_REPO:-https://github.com/gabenunez/reel.git}"
REEL_BRANCH="${REEL_BRANCH:-main}"
REEL_INSTALL_DIR="${REEL_INSTALL_DIR:-/opt/reel}"

resolve_source_dir() {
  if [[ -n "${REEL_SOURCE_DIR:-}" ]] && [[ -f "${REEL_SOURCE_DIR}/scripts/install-vps.sh" ]]; then
    printf '%s' "$REEL_SOURCE_DIR"
    return 0
  fi

  if [[ "${BASH_SOURCE[0]:-}" != "${0:-}" ]] && [[ -f "${BASH_SOURCE[0]:-}" ]]; then
    local candidate
    candidate="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -f "$candidate/scripts/install-vps.sh" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  fi

  if [[ -f "./scripts/install-vps.sh" ]]; then
    printf '%s' "$(pwd)"
    return 0
  fi

  return 1
}

SOURCE_DIR=""
if SOURCE_DIR="$(resolve_source_dir)"; then
  export REEL_SOURCE_DIR="$SOURCE_DIR"
  exec bash "$SOURCE_DIR/scripts/install-vps.sh" "$@"
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required. On Ubuntu/Debian: sudo apt update && sudo apt install -y git"
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "Downloading Reel..."
git clone --depth 1 --branch "$REEL_BRANCH" "$REEL_REPO" "$TMP_DIR/reel"

export REEL_SOURCE_DIR="$TMP_DIR/reel"
export REEL_INSTALL_DIR
exec bash "$TMP_DIR/reel/scripts/install-vps.sh" "$@"
