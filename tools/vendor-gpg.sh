#!/bin/bash
#
# Vendors GnuPG into the application so the user has nothing to install.
# Run on macOS before `npm run dist`.
#
#   ./tools/vendor-gpg.sh
#
# What it does: copies gpg, scdaemon, gpg-agent and pinentry-mac together with
# their libraries into vendor/gnupg, then rewrites the load paths inside the
# binaries so they look for libraries next to themselves instead of in
# /opt/homebrew.
#
# WARNING: GnuPG is distributed under GPLv3. Bundling it obliges you to ship
#          the licence text and an offer of source code with your build.
#          See LICENSES-THIRD-PARTY.md.
#
# Skipping this script is fine: the app then installs GnuPG itself through
# Homebrew on the first setup screen.

set -euo pipefail

DEST="$(cd "$(dirname "$0")/.." && pwd)/vendor/gnupg"
BREW_PREFIX="$(brew --prefix 2>/dev/null || echo /opt/homebrew)"

echo "-> Checking that GnuPG is installed"
brew list gnupg  >/dev/null 2>&1 || brew install gnupg
brew list pinentry-mac >/dev/null 2>&1 || brew install pinentry-mac

echo "-> Preparing $DEST"
rm -rf "$DEST"
mkdir -p "$DEST/bin" "$DEST/lib" "$DEST/libexec"

# gpg-agent and scdaemon live in libexec; without them the smartcard will not work
for tool in gpg gpgconf gpg-connect-agent pinentry-mac; do
  cp "$BREW_PREFIX/bin/$tool" "$DEST/bin/" 2>/dev/null || echo "  skipped $tool"
done
for tool in gpg-agent scdaemon; do
  src="$(find "$BREW_PREFIX" -name "$tool" -type f -perm +111 2>/dev/null | head -1)"
  [ -n "$src" ] && cp "$src" "$DEST/bin/" || echo "  not found: $tool"
done

echo "-> Collecting dependencies"
collect_libs() {
  otool -L "$1" 2>/dev/null | tail -n +2 | awk '{print $1}' | grep -E "^$BREW_PREFIX" || true
}

changed=1
while [ "$changed" -eq 1 ]; do
  changed=0
  for binary in "$DEST"/bin/* "$DEST"/lib/*; do
    [ -f "$binary" ] || continue
    while read -r lib; do
      [ -z "$lib" ] && continue
      name="$(basename "$lib")"
      if [ ! -f "$DEST/lib/$name" ]; then
        cp "$lib" "$DEST/lib/$name"
        chmod u+w "$DEST/lib/$name"
        changed=1
      fi
    done < <(collect_libs "$binary")
  done
done

echo "-> Rewriting load paths to be relative"
for binary in "$DEST"/bin/*; do
  [ -f "$binary" ] || continue
  chmod u+w "$binary"
  install_name_tool -add_rpath "@executable_path/../lib" "$binary" 2>/dev/null || true
  while read -r lib; do
    [ -z "$lib" ] && continue
    install_name_tool -change "$lib" "@rpath/$(basename "$lib")" "$binary" 2>/dev/null || true
  done < <(collect_libs "$binary")
done

for lib in "$DEST"/lib/*; do
  [ -f "$lib" ] || continue
  install_name_tool -id "@rpath/$(basename "$lib")" "$lib" 2>/dev/null || true
  install_name_tool -add_rpath "@loader_path" "$lib" 2>/dev/null || true
  while read -r dep; do
    [ -z "$dep" ] && continue
    install_name_tool -change "$dep" "@rpath/$(basename "$dep")" "$lib" 2>/dev/null || true
  done < <(collect_libs "$lib")
done

echo "-> Checking that the vendored gpg runs"
"$DEST/bin/gpg" --version | head -2

echo
echo "Done. Add to package.json -> build:"
echo '  "extraResources": [{ "from": "vendor/gnupg", "to": "gnupg" }]'
echo
echo "And do not forget GPLv3: ship the licence text and a source offer."
