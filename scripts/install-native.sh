#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Installing dependencies..."
pnpm install

echo "==> Building Reel..."
pnpm build

if [ ! -f "$ROOT/config.yaml" ]; then
  echo "==> Creating config.yaml from example..."
  cp config.example.yaml config.yaml
  echo "    Edit config.yaml with your library paths and TMDB API key."
fi

echo ""
echo "✓ Reel installed successfully!"
echo ""
echo "  Start:  pnpm start"
echo "  Open:   http://localhost:8096"
echo ""
