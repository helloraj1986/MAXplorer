#!/usr/bin/env bash
#
# Build the real macOS .app and .dmg. This script must run on macOS.
# It intentionally does not fake a DMG on Windows/Linux: macOS app compilation,
# codesigning, and hdiutil disk-image creation require Apple toolchains.
#
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: a real macOS .app/.dmg must be built on macOS." >&2
  echo "Use a Mac, a macOS CI runner, or the included GitHub Actions workflow." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! xcode-select -p >/dev/null 2>&1; then
  echo "ERROR: Xcode Command Line Tools are required." >&2
  echo "Run: xcode-select --install" >&2
  exit 1
fi

for tool in node npm rustc cargo; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: '$tool' was not found on PATH." >&2
    exit 1
  fi
done

echo "== Versions =="
node --version
npm --version
rustc --version
cargo --version
xcodebuild -version | head -2

echo "== Installing JavaScript dependencies =="
npm ci

echo "== Typecheck and tests =="
npm run typecheck
npm test
npm run test:cargo

echo "== Building universal macOS app and DMG =="
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin

BUNDLE_DIR="$ROOT/src-tauri/target/universal-apple-darwin/release/bundle"
if [[ ! -d "$BUNDLE_DIR" ]]; then
  echo "ERROR: expected bundle directory not found: $BUNDLE_DIR" >&2
  exit 1
fi

echo "== Artifacts =="
find "$BUNDLE_DIR" -maxdepth 3 -type f -name '*.dmg' -print
find "$BUNDLE_DIR" -maxdepth 3 -type d -name '*.app' -print

DMG="$(find "$BUNDLE_DIR/dmg" -maxdepth 1 -type f -name '*.dmg' | head -n 1 || true)"
if [[ -n "$DMG" ]]; then
  echo "== Verifying DMG =="
  hdiutil verify "$DMG"
  echo "== SHA-256 =="
  shasum -a 256 "$DMG" | tee "$DMG.sha256"
  echo
  echo "DMG: $DMG"
  echo "SHA-256: $DMG.sha256"
else
  echo "WARNING: no DMG was produced. Check the Tauri bundle output above." >&2
fi

if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  cat <<'EOF'

NOTE: This build is unsigned. macOS Gatekeeper will warn when it is downloaded.
For distribution, sign with a Developer ID Application certificate and notarize:

  export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
  export APPLE_ID="you@example.com"
  export APPLE_PASSWORD="app-specific-password"
  export APPLE_TEAM_ID="TEAMID"
  npm run tauri build -- --target universal-apple-darwin --bundles dmg

Or configure the corresponding GitHub Actions secrets. See docs/MACOS_DMG.md.
EOF
fi
