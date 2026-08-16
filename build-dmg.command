#!/bin/bash
# Builds Sealbox.dmg on this Mac. Double-click this file in Finder.
#
# A .dmg can only be produced on macOS: it is made by `hdiutil`, and the app
# inside it has to be code-signed by macOS tools, otherwise Apple Silicon
# refuses to run it. That is why this script exists instead of a prebuilt
# image being handed over from somewhere else.

set -e
cd "$(dirname "$0")"

echo "Sealbox — building the disk image"
echo "Folder: $(pwd)"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "Install it from https://nodejs.org (the LTS button), then run this file again."
  echo
  read -r -p "Press Enter to close."
  exit 1
fi

echo "Node.js $(node -v)"
echo
echo "Step 1/3 — downloading dependencies (a few minutes the first time)"
npm install --no-audit --no-fund

echo
echo "Step 2/3 — running the tests"
npm test

echo
echo "Step 3/3 — building the image"
npm run dist

echo
echo "Done. The image is here:"
ls -lh dist/Sealbox.dmg
shasum -a 256 dist/Sealbox.dmg
open dist

echo
read -r -p "Press Enter to close."
