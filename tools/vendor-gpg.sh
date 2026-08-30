#!/bin/bash
#
# Vendors GnuPG into the application, so the user never installs anything.
# Run on macOS before `npm run dist`:
#
#   ./tools/vendor-gpg.sh
#
# What it does: copies gpg, scdaemon, gpg-agent and pinentry-mac together with
# the libraries they need into vendor/gnupg, rewrites the load paths inside the
# binaries so they look next to themselves instead of in /opt/homebrew, and then
# signs every one of them ad-hoc.
#
# That last step is not optional. Rewriting a Mach-O invalidates its signature,
# and Apple Silicon refuses to execute an arm64 binary with a broken one — the
# app would ship with a GnuPG that cannot start. `codesign --sign -` needs no
# certificate and no Apple account.
#
# ARCHITECTURE: the binaries are whatever Homebrew installed on this machine,
# i.e. one architecture. The app itself is universal, so on a Mac of the other
# architecture the bundled copy simply fails its version probe and Sealbox falls
# back to a system GnuPG, or to the manual-install screen. That is checked at
# runtime, not assumed — see findGpg() in src/crypto/gpg.js.
#
# LICENCE: GnuPG is GPLv3. Bundling it obliges you to ship the licence text and
# an offer of source. See LICENSES-THIRD-PARTY.md.

set -euo pipefail

DEST="$(cd "$(dirname "$0")/.." && pwd)/vendor/gnupg"
BREW_PREFIX="$(brew --prefix 2>/dev/null || echo /opt/homebrew)"

echo "-> Checking that GnuPG is installed"
brew list gnupg  >/dev/null 2>&1 || brew install gnupg
brew list pinentry-mac >/dev/null 2>&1 || brew install pinentry-mac

echo "-> Preparing $DEST"
rm -rf "$DEST"
mkdir -p "$DEST/bin" "$DEST/lib"
printf 'Filled by tools/vendor-gpg.sh on macOS.\n' > "$DEST/.keep"

# gpg-agent and scdaemon live in libexec; without them the smartcard is invisible
for tool in gpg gpgconf gpg-connect-agent pinentry-mac; do
  cp "$BREW_PREFIX/bin/$tool" "$DEST/bin/" 2>/dev/null || echo "  skipped $tool"
done
for tool in gpg-agent scdaemon; do
  src="$(find "$BREW_PREFIX" -name "$tool" -type f -perm +111 2>/dev/null | head -1)"
  if [ -n "$src" ]; then cp "$src" "$DEST/bin/"; else echo "  not found: $tool"; fi
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

# Libraries first: a binary's signature covers the libraries it links, so signing
# it before they are final would invalidate it again.
echo "-> Signing (ad-hoc — no certificate needed)"
for file in "$DEST"/lib/* "$DEST"/bin/*; do
  [ -f "$file" ] || continue
  codesign --force --sign - --timestamp=none "$file" >/dev/null 2>&1 \
    || echo "  could not sign $(basename "$file")"
done

echo "-> Checking the result"
"$DEST/bin/gpg" --version | head -2
codesign --verify --verbose=1 "$DEST/bin/gpg" 2>&1 | head -2 || true
echo "   architecture: $(lipo -archs "$DEST/bin/gpg" 2>/dev/null || file -b "$DEST/bin/gpg")"

echo
echo "Done. vendor/gnupg is ready; `npm run dist` will place it inside the app."
echo "Remember GPLv3: ship the licence text and an offer of source."
