#!/usr/bin/env bash
# Create a GitHub release from CHANGELOG.md without GitHub Actions.
#
# Usage:
#   ./scripts/release.sh           # release package.json version (v0.1.45)
#   ./scripts/release.sh v0.1.45   # release an explicit tag
#
# Requires: git, node, pnpm, gh (https://cli.github.com/) authenticated for the repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib/ui.sh
source "$ROOT/scripts/lib/ui.sh"

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  VERSION="$(node -e "console.log(require('./package.json').version)")"
  TAG="v${VERSION}"
fi

if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  media_fail "Tag must look like v0.1.45 (got: $TAG)"
fi

if ! command -v gh >/dev/null 2>&1; then
  media_fail "GitHub CLI (gh) is required. Install: https://cli.github.com/"
fi

if ! gh auth status >/dev/null 2>&1; then
  media_fail "gh is not authenticated. Run: gh auth login"
fi

media_step "Validating CHANGELOG for $TAG"
NOTES_FILE="$(mktemp)"
trap 'rm -f "$NOTES_FILE"' EXIT
node scripts/extract-changelog.mjs "$TAG" > "$NOTES_FILE"

media_step "Running test suite"
pnpm test
media_ok "Tests passed"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  media_ok "Tag $TAG already exists locally"
else
  media_step "Creating annotated tag $TAG"
  git tag -a "$TAG" -m "Release $TAG"
  media_ok "Created tag $TAG"
fi

media_step "Pushing main and $TAG to origin"
git push origin main
git push origin "$TAG"
media_ok "Pushed to GitHub"

media_step "Publishing GitHub release for $TAG"
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release edit "$TAG" --title "MEDIA! $TAG" --notes-file "$NOTES_FILE"
  media_ok "Updated existing release $TAG"
else
  gh release create "$TAG" --title "MEDIA! $TAG" --notes-file "$NOTES_FILE" --verify-tag
  media_ok "Created release $TAG"
fi

media_ok "Done. Installs can update with: MEDIA_RELEASE_TAG=$TAG bash scripts/update.sh"
