#!/bin/bash
# Pushes this repository to GitHub and tags a release, which makes GitHub build
# Sealbox.dmg on a Mac runner and attach it to the Releases page.
# Double-click this file in Finder.
#
# Git will ask for a username and a personal access token. They are typed
# straight into Terminal and are not stored by this script.

set -e
cd "$(dirname "$0")"

REPO="https://github.com/iterator-one/sealbox.git"
TAG="v1.1.0"

echo "Sealbox — publishing to GitHub"
echo "Repository: $REPO"
echo "Tag:        $TAG"
echo

if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "$REPO"
fi

echo "Pushing the code (this replaces what is currently on GitHub)…"
git push -u --force origin main

echo
echo "Pushing the tag — this starts the build…"
git tag -f "$TAG"
git push -f origin "$TAG"

echo
echo "Done. The build takes about five minutes."
open "https://github.com/iterator-one/sealbox/actions"

echo
echo "When it finishes, the image is here:"
echo "  https://github.com/iterator-one/sealbox/releases/latest/download/Sealbox.dmg"
echo
read -r -p "Press Enter to close."
