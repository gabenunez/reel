#!/usr/bin/env bash
set -euo pipefail

# ── styling ────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  BOLD='\033[1m'
  DIM='\033[2m'
  GREEN='\033[0;32m'
  CYAN='\033[0;36m'
  YELLOW='\033[1;33m'
  RED='\033[0;31m'
  RESET='\033[0m'
else
  BOLD='' DIM='' GREEN='' CYAN='' YELLOW='' RED='' RESET=''
fi

step=0
step() {
  step=$((step + 1))
  echo ""
  echo -e "${BOLD}${CYAN}[$step]${RESET} ${BOLD}$1${RESET}"
  echo -e "${DIM}$(printf '%.0s─' {1..60})${RESET}"
}

ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
warn() { echo -e "  ${YELLOW}!${RESET} $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; exit 1; }

prompt() {
  local __var="$1" __question="$2" __default="$3"
  if [[ "${MEDIA_NONINTERACTIVE:-}" == "1" ]]; then
    printf -v "$__var" '%s' "$__default"
    echo -e "  ${DIM}$__question${RESET} ${BOLD}$__default${RESET} ${DIM}(auto)${RESET}"
    return 0
  fi
  local __input
  read -rp "$(echo -e "  ${BOLD}?${RESET} $__question [$__default]: ")" __input
  printf -v "$__var" '%s' "${__input:-$__default}"
}

confirm() {
  local __question="$1"
  if [[ "${MEDIA_NONINTERACTIVE:-}" == "1" ]]; then
    return 0
  fi
  local __answer
  read -rp "$(echo -e "  ${BOLD}?${RESET} $__question [Y/n]: ")" __answer
  [[ "${__answer:-Y}" =~ ^[Yy]?$ ]]
}

need_sudo() {
  if [[ "$EUID" -eq 0 ]]; then
    SUDO=""
  elif command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    fail "Root or sudo access is required for system packages and the systemd service."
  fi
}

detect_public_ip() {
  curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null \
    || curl -fsS --max-time 3 https://ifconfig.me 2>/dev/null \
    || hostname -I 2>/dev/null | awk '{print $1}' \
    || echo "YOUR_SERVER_IP"
}

detect_lan_ip() {
  hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost"
}

install_system_packages() {
  step "Installing system dependencies"

  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if command -v apt-get >/dev/null 2>&1; then
      ok "Detected Debian/Ubuntu"
      $SUDO apt-get update -qq
      $SUDO apt-get install -y \
        ca-certificates curl git rsync build-essential python3 \
        ffmpeg
      if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 20 ]]; then
        ok "Installing Node.js 20..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
        $SUDO apt-get install -y nodejs
      fi
    elif command -v dnf >/dev/null 2>&1; then
      ok "Detected Fedora/RHEL"
      $SUDO dnf install -y curl git gcc-c++ make python3 ffmpeg nodejs npm
    elif command -v yum >/dev/null 2>&1; then
      ok "Detected CentOS/RHEL"
      $SUDO yum install -y curl git gcc-c++ make python3 ffmpeg
      if ! command -v node >/dev/null 2>&1; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO bash -
        $SUDO yum install -y nodejs
      fi
    else
      fail "Unsupported Linux distro. Install Node 20+, pnpm, git, ffmpeg, and build tools manually."
    fi
  else
    fail "This installer targets Linux VPS servers. On macOS, run: ./scripts/install-native.sh"
  fi

  command -v node >/dev/null 2>&1 || fail "Node.js not found after install"
  command -v ffmpeg >/dev/null 2>&1 || fail "FFmpeg not found after install"
  ok "Node $(node -v)"
  ok "FFmpeg $(ffmpeg -version 2>&1 | head -1 | cut -d' ' -f3)"
}

enable_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    ok "pnpm $(pnpm -v)"
    return 0
  fi
  ok "Enabling pnpm via corepack..."
  if command -v corepack >/dev/null 2>&1; then
    $SUDO corepack enable
    corepack prepare pnpm@10.26.1 --activate
  else
    npm install -g pnpm@10.26.1
  fi
  ok "pnpm $(pnpm -v)"
}

prepare_install_dir() {
  step "Preparing install directory"

  prompt MEDIA_INSTALL_DIR "Install directory" "${MEDIA_INSTALL_DIR:-/opt/media-app}"
  prompt MEDIA_USER "Linux user to run MEDIA!" "${MEDIA_USER:-reel}"
  prompt REEL_PORT "Port" "${REEL_PORT:-8096}"

  if [[ ! -d "$MEDIA_INSTALL_DIR" ]]; then
    $SUDO mkdir -p "$MEDIA_INSTALL_DIR"
    ok "Created $MEDIA_INSTALL_DIR"
  fi

  if ! id "$MEDIA_USER" &>/dev/null; then
    $SUDO useradd --system --home-dir "$MEDIA_INSTALL_DIR" --shell /usr/sbin/nologin "$MEDIA_USER" 2>/dev/null \
      || $SUDO useradd --system --home-dir "$MEDIA_INSTALL_DIR" --shell /bin/false "$MEDIA_USER"
    ok "Created system user '$MEDIA_USER'"
  else
    ok "Using existing user '$MEDIA_USER'"
  fi
}

sync_source() {
  step "Installing MEDIA!"

  MEDIA_REPO="${MEDIA_REPO:-https://github.com/gabenunez/media-app.git}"
  MEDIA_BRANCH="${MEDIA_BRANCH:-main}"
  local source_dir="${REEL_SOURCE_DIR:-}"

  if [[ -n "$source_dir" ]] && [[ "$(cd "$source_dir" && pwd)" == "$(cd "$MEDIA_INSTALL_DIR" && pwd)" ]]; then
    ok "Using existing source at $MEDIA_INSTALL_DIR"
  elif [[ -d "$MEDIA_INSTALL_DIR/.git" ]]; then
    ok "Using existing git clone at $MEDIA_INSTALL_DIR"
  else
    ok "Cloning MEDIA! to $MEDIA_INSTALL_DIR"
    $SUDO rm -rf "$MEDIA_INSTALL_DIR"
    $SUDO git clone --depth 1 --branch "$MEDIA_BRANCH" "$MEDIA_REPO" "$MEDIA_INSTALL_DIR"
  fi

  $SUDO chown -R "$MEDIA_USER:$MEDIA_USER" "$MEDIA_INSTALL_DIR"
}

write_config() {
  step "Creating config"

  if [[ -f "$MEDIA_INSTALL_DIR/config.yaml" ]]; then
    ok "Keeping existing config.yaml"
    return 0
  fi

  local movies_path tv_path
  prompt movies_path "Movies folder (type 'skip' to configure later)" "${REEL_MOVIES_PATH:-/srv/reel/movies}"
  prompt tv_path "TV folder (type 'skip' to configure later)" "${REEL_TV_PATH:-/srv/reel/tv}"
  [[ "$movies_path" == "skip" ]] && movies_path=""
  [[ "$tv_path" == "skip" ]] && tv_path=""

  $SUDO -u "$MEDIA_USER" bash -c "cat > '$MEDIA_INSTALL_DIR/config.yaml'" <<EOF
server:
  port: ${REEL_PORT}
  host: 0.0.0.0

libraries:
EOF

  if [[ -n "$movies_path" ]]; then
    $SUDO mkdir -p "$movies_path"
    $SUDO chown -R "$MEDIA_USER:$MEDIA_USER" "$movies_path"
    $SUDO -u "$MEDIA_USER" bash -c "cat >> '$MEDIA_INSTALL_DIR/config.yaml'" <<EOF
  - name: Movies
    type: movies
    path: ${movies_path}
EOF
    ok "Movies library → $movies_path"
  fi

  if [[ -n "$tv_path" ]]; then
    $SUDO mkdir -p "$tv_path"
    $SUDO chown -R "$MEDIA_USER:$MEDIA_USER" "$tv_path"
    $SUDO -u "$MEDIA_USER" bash -c "cat >> '$MEDIA_INSTALL_DIR/config.yaml'" <<EOF
  - name: TV Shows
    type: tv
    path: ${tv_path}
EOF
    ok "TV library → $tv_path"
  fi

  $SUDO -u "$MEDIA_USER" bash -c "cat >> '$MEDIA_INSTALL_DIR/config.yaml'" <<EOF

metadata:
  tmdb_api_key: ""
  language: en-US

transcoding:
  enabled: true
  hls_segment_duration: 6
  cache_dir: ./data/transcode-cache

data_dir: ./data
EOF

  ok "Config written to $MEDIA_INSTALL_DIR/config.yaml"
}

build_app() {
  step "Building MEDIA! (this may take a few minutes)"

  $SUDO -u "$MEDIA_USER" bash <<EOF
set -euo pipefail
cd "$MEDIA_INSTALL_DIR"
export CI=1
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
pnpm build
EOF

  ok "Build complete"
}

install_systemd_service() {
  step "Setting up systemd service"

  local node_bin
  node_bin="$(command -v node)"

  $SUDO tee /etc/systemd/system/reel.service >/dev/null <<EOF
[Unit]
Description=MEDIA! Media Server
After=network.target

[Service]
Type=simple
User=${MEDIA_USER}
Group=${MEDIA_USER}
WorkingDirectory=${MEDIA_INSTALL_DIR}
ExecStart=${node_bin} packages/server/dist/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF

  $SUDO systemctl daemon-reload
  $SUDO systemctl enable reel.service
  $SUDO systemctl restart reel.service

  sleep 2
  if $SUDO systemctl is-active --quiet reel.service; then
    ok "Service running"
  else
    warn "Service failed to start. Check logs:"
    echo -e "    ${DIM}sudo journalctl -u reel -n 50 --no-pager${RESET}"
    exit 1
  fi
}

maybe_open_firewall() {
  if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
    step "Firewall"
    if confirm "Allow port ${REEL_PORT} through ufw?"; then
      $SUDO ufw allow "${REEL_PORT}/tcp"
      ok "Port ${REEL_PORT} opened"
    fi
  fi
}

print_success() {
  local lan_ip public_ip
  lan_ip="$(detect_lan_ip)"
  public_ip="$(detect_public_ip)"

  echo ""
  echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${GREEN}${BOLD}  MEDIA! is live!${RESET}"
  echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  echo -e "  ${BOLD}Open in your browser:${RESET}"
  echo -e "    ${CYAN}http://${lan_ip}:${REEL_PORT}${RESET}"
  if [[ "$public_ip" != "$lan_ip" ]] && [[ "$public_ip" != "YOUR_SERVER_IP" ]]; then
    echo -e "    ${CYAN}http://${public_ip}:${REEL_PORT}${RESET}  ${DIM}(public IP)${RESET}"
  fi
  echo ""
  echo -e "  ${BOLD}Next steps:${RESET}"
  echo -e "    1. Go to ${CYAN}/settings${RESET} and add your TMDB API key"
  echo -e "    2. Add media folders (if you skipped them above)"
  echo -e "    3. Upload movies/TV and trigger a library scan"
  echo ""
  echo -e "  ${BOLD}Useful commands:${RESET}"
  echo -e "    ${DIM}curl -fsSL https://raw.githubusercontent.com/gabenunez/media-app/main/update.sh | bash${RESET}  — update MEDIA!"
  echo -e "    ${DIM}sudo systemctl status reel${RESET}   — check status"
  echo -e "    ${DIM}sudo systemctl restart reel${RESET}  — restart after config changes"
  echo -e "    ${DIM}sudo journalctl -u reel -f${RESET}  — live logs"
  echo ""
}

main() {
  echo ""
  echo -e "${BOLD}  MEDIA! — VPS Setup${RESET}"
  echo -e "${DIM}  Self-hosted media server in one guided install${RESET}"
  echo ""

  need_sudo
  install_system_packages
  enable_pnpm
  prepare_install_dir
  sync_source
  write_config
  build_app
  install_systemd_service
  maybe_open_firewall
  print_success
}

main "$@"
