# Installing Sealbox

Sealbox is a free app for Mac that lets you encrypt any file before sending it.

The build is not signed, so macOS calls it "an app from an unidentified developer" and refuses
to open it the first time. That is expected. Getting past it takes about twenty seconds, once.

## 1. Download

[**Download Sealbox.dmg**](https://github.com/iterator-one/sealbox/releases/latest/download/Sealbox.dmg)
— that link always gives the newest release. One build works on both Intel and Apple Silicon.

## 2. Install

1. Double-click the `.dmg`. A window opens with the Sealbox icon and a shortcut to Applications.
2. Drag **Sealbox** onto **Applications**.
3. Eject the disk image (the ⏏ next to it in the Finder sidebar). The `.dmg` can be deleted.

## 3. Open it the first time

Double-click Sealbox in Applications. macOS shows a warning and refuses. What to do next depends
on your macOS version.

### macOS 15 (Sequoia) and newer

Right-click → Open no longer works. Apple moved the confirmation into Settings.

1. Try to open Sealbox once and dismiss the warning. This is required: the button in step 3
   appears only after a blocked launch, and stays for about an hour.
2. Open **Apple menu → System Settings → Privacy & Security**.
3. Scroll to **Security**. There is a line saying Sealbox was blocked. Click **Open Anyway**.
4. Enter your Mac login password.

Sealbox opens normally from then on.

### macOS 14 (Sonoma) and older

1. Find Sealbox in Applications.
2. Right-click it (or Control-click) and choose **Open**.
3. Click **Open** in the dialog.

### If neither works

Open Terminal (⌘ Space, type "Terminal", Enter), paste this, press Enter:

```bash
xattr -dr com.apple.quarantine /Applications/Sealbox.app
```

That removes the quarantine flag macOS puts on downloaded files. Then open the app normally.

---

## Why it is not signed

Signing requires an Apple Developer ID, which costs 99 USD a year. This project does not have
one. A signature says who published a build, not whether the build is safe, so the code is the
same either way.

Since there is no signature to check, check the file itself. Every release publishes
`SHA256SUMS.txt` next to the `.dmg`:

```bash
cd ~/Downloads
shasum -a 256 Sealbox.dmg
```

If the line matches the one in `SHA256SUMS.txt`, your copy is byte-for-byte what the build
produced.

Before trusting anything irreplaceable to it, read [SECURITY.md](SECURITY.md), in particular
[§9 Known gaps](SECURITY.md#9-known-gaps).

## Running from source instead

If you would rather not install a binary. Needs [Node.js](https://nodejs.org) 18 or newer:

```bash
git clone https://github.com/iterator-one/sealbox.git
cd sealbox
npm install
npm start
```

The first `npm install` downloads Electron and takes a couple of minutes.

## Building your own .dmg

Only possible on macOS: the image is made by `hdiutil`, and the app inside it has to be signed
by Apple's tools or Apple Silicon will refuse to run it.

Easiest way: double-click **`build-dmg.command`** in the project folder. It checks for Node.js,
installs the dependencies, runs the tests and builds the image, then opens the folder it lands
in. Same thing by hand:

```bash
npm install
npm run vendor    # optional: bundles GnuPG into the app, see LICENSES-THIRD-PARTY.md
npm run dist
```

The image lands in `dist/Sealbox.dmg`.

Or let GitHub build it. Double-click **`publish.command`**, or do it by hand:

```bash
git push origin main
git tag v1.0.2
git push origin v1.0.2
```

`.github/workflows/release.yml` then runs the tests on a macOS runner, builds the universal
image and attaches it to the Releases page with checksums. Takes about five minutes.

## Uninstalling

Drag `/Applications/Sealbox.app` to the Trash. Two things stay behind on purpose, because
deleting them can cost you access to your files:

- `~/.gnupg/` — your GnuPG configuration and public keyring. Sealbox wrote `scdaemon.conf` and
  `gpg-agent.conf` there and kept a copy of whatever it replaced as `*.sealbox-backup`.
- Your `.gpg` files, wherever you put them. They open with plain `gpg` and your device; Sealbox
  is not needed for that.

Nothing else is stored anywhere.
