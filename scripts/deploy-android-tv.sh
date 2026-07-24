#!/usr/bin/env bash
#
# Deploy the Android TV app directly to a TV on the local network.
#
# Usage:
#   ./scripts/deploy-android-tv.sh
#   ./scripts/deploy-android-tv.sh --release
#   ./scripts/deploy-android-tv.sh 192.168.1.42
#
# The script will:
#   1. Find a connected Android TV via adb (mdns, existing connections, or the IP you pass).
#   2. Build the APK with Gradle.
#   3. Install the APK over adb.
#
# Requires `adb` (Android SDK platform-tools) on your PATH and a TV with
# network debugging enabled (usually Settings > Device Preferences > About >
# Build, click 7 times, then Developer options > Network debugging).
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_TV_DIR="$ROOT/packages/android-tv"
ADB_PORT=5555

find_adb() {
  if [ -n "${ADB:-}" ]; then
    if command -v "$ADB" >/dev/null 2>&1; then
      echo "$ADB"
      return
    fi
  fi
  if command -v adb >/dev/null 2>&1; then
    echo adb
    return
  fi
  echo "Error: adb not found. Install Android SDK platform-tools or set ADB=/path/to/adb" >&2
  exit 1
}

ADB="$(find_adb)"

normalize_target() {
  local target="$1"
  if [[ "$target" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "${target}:${ADB_PORT}"
  else
    echo "$target"
  fi
}

is_ip() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(:[0-9]+)?$ ]]
}

# Serials currently in the "device" (authorized) state.
connected_devices() {
  "$ADB" devices -l 2>/dev/null | awk 'NR>1 && NF>=2 && $2=="device" {print $1}'
}

device_state() {
  local serial="$1"
  "$ADB" devices 2>/dev/null | awk -v s="$serial" 'NR>1 && $1==s {print $2; exit}'
}

# Drop stale/offline entries that confuse wireless adb ("No route to host").
prune_stale_adb() {
  local line serial state
  while IFS= read -r line; do
    serial="$(awk '{print $1}' <<<"$line")"
    state="$(awk '{print $2}' <<<"$line")"
    [ -n "$serial" ] || continue
    case "$state" in
      offline|unauthorized)
        "$ADB" disconnect "$serial" >/dev/null 2>&1 || true
        ;;
    esac
  done < <("$ADB" devices 2>/dev/null | awk 'NR>1 && NF>=2 {print $1" "$2}')
}

mdns_discover() {
  "$ADB" mdns services 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+' | head -1
}

local_ip_and_prefix() {
  # Best-effort: return a /24 based on the machine's local IP.
  # macOS
  if command -v ifconfig >/dev/null 2>&1; then
    local iface ip
    iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
    if [ -n "$iface" ]; then
      ip="$(ifconfig "$iface" 2>/dev/null | awk '/inet /{print $2; exit}')"
      if [ -n "$ip" ]; then
        echo "${ip%.*}.0/24"
        return
      fi
    fi
  fi
  # Linux
  if command -v ip >/dev/null 2>&1; then
    local line src
    line="$(ip -o -4 route get 1.1.1.1 2>/dev/null | head -1)"
    if [ -n "$line" ]; then
      src="$(echo "$line" | grep -oE 'src [0-9.]+' | awk '{print $2}')"
      if [ -n "$src" ]; then
        echo "${src%.*}.0/24"
        return
      fi
    fi
  fi
  return 1
}

scan_port() {
  local host="$1" port="$2"
  # Prefer python — works on macOS without bash /dev/tcp quirks.
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$host" "$port" <<'PY' 2>/dev/null
import socket, sys
host, port = sys.argv[1], int(sys.argv[2])
s = socket.socket()
s.settimeout(0.35)
try:
    s.connect((host, port))
except Exception:
    sys.exit(1)
finally:
    s.close()
PY
    return $?
  fi
  if command -v timeout >/dev/null 2>&1; then
    timeout 0.5 bash -c "exec 3<>/dev/tcp/$host/$port" 2>/dev/null
    return $?
  fi
  bash -c "exec 3<>/dev/tcp/$host/$port" 2>/dev/null
}

# Wait until the serial is authorized ("device"), or give up.
wait_for_device() {
  local serial="$1"
  local attempts="${2:-20}"
  local i state
  for ((i = 1; i <= attempts; i++)); do
    state="$(device_state "$serial")"
    case "$state" in
      device)
        return 0
        ;;
      unauthorized)
        if [ "$i" -eq 1 ] || [ $((i % 5)) -eq 0 ]; then
          echo "  Waiting for USB debugging authorization on the TV..." >&2
        fi
        ;;
      offline)
        # Stale wireless session — reconnect on next attempt.
        "$ADB" disconnect "$serial" >/dev/null 2>&1 || true
        "$ADB" connect "$serial" >/dev/null 2>&1 || true
        ;;
    esac
    sleep 0.5
  done
  return 1
}

# Connect to host[:port], recovering from a stuck adb daemon when needed.
connect_target() {
  local raw="$1"
  local target
  target="$(normalize_target "$raw")"
  local out=""
  local attempt

  prune_stale_adb

  for attempt in 1 2 3; do
    out="$("$ADB" connect "$target" 2>&1)" || true
    echo "  $out" >&2

    if wait_for_device "$target" 8; then
      return 0
    fi

    # adb sometimes reports "No route to host" even when TCP to :5555 works
    # (stuck daemon / offline emulator). Restart once and retry.
    if [ "$attempt" -eq 1 ]; then
      echo "  Restarting adb server and retrying $target..." >&2
      "$ADB" kill-server >/dev/null 2>&1 || true
      sleep 1
      "$ADB" start-server >/dev/null 2>&1 || true
      sleep 0.5
      continue
    fi

    if [[ "$out" == *"unauthorized"* ]] || [ "$(device_state "$target")" = "unauthorized" ]; then
      echo "  Confirm the 'Allow USB debugging?' prompt on the TV, then retrying..." >&2
      sleep 2
      continue
    fi
  done

  return 1
}

scan_for_tv() {
  local network
  if ! network="$(local_ip_and_prefix)"; then
    echo "Could not auto-detect local network." >&2
    return 1
  fi

  local base="${network%/*}"
  local prefix="${network#*/}"
  if [ "$prefix" != "24" ]; then
    echo "Auto-scan only supports /24 networks; got $network" >&2
    return 1
  fi

  local base3="${base%.*}"
  echo "Scanning $network for adb port $ADB_PORT (this takes ~25 seconds)..." >&2

  local candidates=()
  local i ip found=""
  for i in $(seq 1 254); do
    ip="$base3.$i"
    if scan_port "$ip" "$ADB_PORT"; then
      echo "  adb port open at $ip" >&2
      candidates+=("$ip")
      if connect_target "$ip"; then
        found="$(normalize_target "$ip")"
        echo "  Connected and authorized: $found" >&2
        break
      fi
      echo "  Port open on $ip but adb connect failed; continuing scan..." >&2
    fi
    if [ $((i % 50)) -eq 0 ]; then
      echo "  scanned $i/254..." >&2
    fi
  done

  if [ -n "$found" ]; then
    echo "$found"
    return 0
  fi

  # Retry candidates after a full scan — first attempt may have hit a stuck adb.
  if [ "${#candidates[@]}" -gt 0 ]; then
    echo "Retrying ${#candidates[@]} candidate(s) with open adb ports..." >&2
    for ip in "${candidates[@]}"; do
      if connect_target "$ip"; then
        found="$(normalize_target "$ip")"
        echo "  Connected and authorized: $found" >&2
        echo "$found"
        return 0
      fi
    done
    # Remember the first candidate for the interactive prompt.
    echo "${candidates[0]}"
    return 2
  fi

  return 1
}

ensure_device() {
  local preferred="${1:-}"

  # 1. Already connected?
  local devices
  devices="$(connected_devices)"
  if [ -n "$devices" ]; then
    if [ -n "$preferred" ]; then
      local d preferred_norm
      preferred_norm="$(normalize_target "$preferred")"
      for d in $devices; do
        if [[ "$d" == *"$preferred"* ]] || [[ "$d" == "$preferred_norm" ]]; then
          echo "$d"
          return
        fi
      done
    fi
    echo "$devices" | head -1
    return
  fi

  # 2. Explicit IP provided?
  if [ -n "$preferred" ] && is_ip "$preferred"; then
    echo "Connecting to $(normalize_target "$preferred")..." >&2
    if connect_target "$preferred"; then
      echo "$(normalize_target "$preferred")"
      return
    fi
    echo "Error: could not connect to $preferred. Make sure network debugging is enabled." >&2
    exit 1
  fi

  # 3. mDNS discovery
  local discovered
  discovered="$(mdns_discover)"
  if [ -n "$discovered" ]; then
    echo "Found Android TV via mDNS: $discovered" >&2
    if connect_target "$discovered"; then
      echo "$(normalize_target "$discovered")"
      return
    fi
  fi

  # 4. Network scan
  local scanned
  local scan_status=0
  scanned="$(scan_for_tv)" || scan_status=$?
  if [ "$scan_status" -eq 0 ] && [ -n "$scanned" ]; then
    # Already connected during scan.
    if [ "$(device_state "$scanned")" = "device" ] || connected_devices | grep -qx "$scanned"; then
      echo "$scanned"
      return
    fi
    if connect_target "$scanned"; then
      echo "$(normalize_target "$scanned")"
      return
    fi
  fi

  local hint=""
  if [ "$scan_status" -eq 2 ] && [ -n "$scanned" ]; then
    hint="$scanned"
  fi

  echo
  echo "No Android TV found automatically." >&2
  echo "Enable network debugging on the TV (Developer options > Network debugging)" >&2
  echo "and make sure your computer is on the same network." >&2
  echo
  if [ -n "$hint" ]; then
    read -rp "Enter your TV's IP address [$hint]: " ip
    ip="${ip:-$hint}"
  else
    read -rp "Enter your TV's IP address (or press Ctrl-C to cancel): " ip
  fi
  if is_ip "$ip"; then
    echo "Connecting to $(normalize_target "$ip")..." >&2
    if connect_target "$ip"; then
      echo "$(normalize_target "$ip")"
      return
    fi
  fi
  echo "Error: still could not connect." >&2
  exit 1
}

build_apk() {
  local variant=debug
  local task=assembleDebug
  # Accept "release", "yes", or "--release" from callers.
  case "${1:-}" in
    release|yes|--release)
      variant=release
      task=assembleRelease
      ;;
  esac
  # Progress/gradle go to stderr so command substitution only captures the path.
  echo "Building $task..." >&2
  (cd "$ANDROID_TV_DIR" && ./gradlew "$task") >&2

  local apk
  apk="$(find "$ANDROID_TV_DIR/app/build/outputs/apk/$variant" -maxdepth 1 -name '*.apk' -print -quit 2>/dev/null)"
  if [ -z "$apk" ] || [ ! -f "$apk" ]; then
    echo "Error: APK not found in $ANDROID_TV_DIR/app/build/outputs/apk/$variant" >&2
    exit 1
  fi
  echo "Built: $apk" >&2
  echo "$apk"
}

install_apk() {
  local device="$1"
  local apk="$2"
  echo "Installing $(basename "$apk") on $device..."

  if ! "$ADB" -s "$device" install -r -d "$apk"; then
    echo
    echo "Install failed. Check the TV screen for an 'allow USB debugging?' prompt and confirm it." >&2
    exit 1
  fi
  echo "Installed successfully."
}

main() {
  local release="no"
  local build_only="no"
  local device_arg=""

  for arg in "$@"; do
    case "$arg" in
      --release) release="yes" ;;
      --build-only) build_only="yes" ;;
      -h|--help)
        sed -n '2,15p' "$0"
        exit 0
        ;;
      *) device_arg="$arg" ;;
    esac
  done

  local apk
  apk="$(build_apk "$release")"

  if [ "$build_only" = "yes" ]; then
    echo "APK ready: $apk"
    exit 0
  fi

  local device
  device="$(ensure_device "$device_arg")"
  install_apk "$device" "$apk"
}

main "$@"
