# Sealbox

Sealbox is a free app for Mac that lets you encrypt any file before sending it. Protect
sensitive information and secure your files.

The key that opens the file lives on a Ledger hardware wallet and cannot be copied off it, so
the file can only be opened with that device plugged in and its PIN entered.

Open source. No account, no network, no telemetry.

### [⬇︎ Download Sealbox for Mac](https://github.com/iterator-one/sealbox/releases/latest/download/Sealbox.dmg)

Works on Intel and Apple Silicon. macOS blocks it on the first launch because the build is not
signed — [how to open it](INSTALL.md#3-open-it-the-first-time) takes twenty seconds.

[Install](INSTALL.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

> **v1.0.2.** Nobody outside this repository has reviewed the code, and key generation on the
> device has not been tested on real hardware. Keep a second copy of anything you cannot afford
> to lose. Full list: [Known gaps](SECURITY.md#9-known-gaps).

---

## What it does

Drag a file onto the window. Sealbox writes an encrypted copy, `report.docx.gpg`, next to the
original. To read it, drag the `.gpg` file back in with the device connected.

The format is standard OpenPGP, not a format of our own. `gpg --decrypt report.docx.gpg` opens
it on any machine. If this project is abandoned tomorrow, your files still open.

## Why a hardware wallet instead of a password

A password can be guessed, reused, forgotten, phished, or demanded from you. A key inside the
wallet's secure element cannot be read out — not by Sealbox, not by macOS, not by someone who
takes the laptop.

There is no password mode, so there is nothing to choose and nothing to remember. If you drop a
password-encrypted file on Sealbox it says it cannot open it and shows the `gpg` command that
can.

## How it works

1. You drag a file in.
2. If the device has no key yet, Sealbox has the device generate one. The private half is
   created inside the secure element and never leaves it.
3. Sealbox shows a recovery card — three values needed to recreate the same key after a Ledger
   update erases it. Save it.
4. The file is encrypted to your key and signed by the device. The device asks for the PIN, and
   for a button press if UIF is on.
5. You get `report.docx.gpg`.

Sealbox contains no cryptographic code. GnuPG does the cryptography, and `scdaemon` (part of
GnuPG) talks to the device. Reasoning: [SECURITY.md §4](SECURITY.md#4-dependencies).

### Why the file is signed as well as encrypted

Encrypting needs only your public key, so the device is not required for it. A "confirm on your
device" prompt at that point would be theatre.

Signing does require the device. The signature is computed inside the secure element, so the PIN
prompt and the button press are real. It also tells whoever opens the file who encrypted it:

```bash
gpg --decrypt report.docx.gpg     # Good signature from ...
```

## Setup

The app opens on the drop screen. The setup guide appears only when something is missing —
after a drop that cannot proceed, or when you click the status line or the "?" button. Four
steps, no terminal:

1. **GnuPG.** One button. Sealbox installs it through Homebrew or uses the copy bundled in the
   app, then writes the reader configuration.
2. **The OpenPGP app on the Ledger.** Ledger Live → Developer mode → My Ledger → OpenPGP.
   Devices: Nano X, Nano S Plus, Stax, Flex, Apex P.
3. **Seed mode on.** Without it the key cannot be recreated after an update.
4. **Connection check.** The indicator turns green by itself.

The device is visible to macOS as a smartcard only while the OpenPGP app is open on its screen,
and only while Ledger Live is closed. Ledger Live keeps the device to itself.

## Install

[Download `Sealbox.dmg`](https://github.com/iterator-one/sealbox/releases/latest/download/Sealbox.dmg),
open it, drag Sealbox into Applications. One build covers Intel and Apple Silicon.

macOS will refuse to open it the first time, because the build is not signed with an Apple
Developer ID. This is a one-time step:

- **macOS 15 (Sequoia) and newer** — try to open the app, dismiss the warning, then go to
  System Settings → Privacy & Security → Security and click **Open Anyway**. The button only
  appears after a blocked launch.
- **macOS 14 and older** — right-click the app in Applications, choose **Open**, then **Open**
  again.

There is no Apple signature to rely on, so check the download instead. Every release publishes
checksums:

```bash
shasum -a 256 Sealbox.dmg   # compare with SHA256SUMS.txt on the release page
```

Details, troubleshooting and uninstall: **[INSTALL.md](INSTALL.md)**.

## Running from source

Needs [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start          # run the app
npm test           # tests
npm run preview    # rebuild preview.html — the real UI in a browser, with mock data
npm run vendor     # bundle GnuPG into the app (macOS only, see LICENSES-THIRD-PARTY.md)
npm run dist       # build a universal .dmg (macOS only)
```

`preview.html` is the real interface with `window.api` missing, so `renderer.js` falls back to a
demo implementation. It lets you walk every screen without a Mac or a device.

## Code map

About 1 100 lines of our own code.

```
main.js                     Electron main process: window and IPC handlers
preload.js                  the privilege boundary — everything the UI can reach is listed here
src/crypto/gpg.js           GnuPG wrapper: card status, key list, encrypt+sign, decrypt
src/crypto/cardkey.js       key generation on the device, via GnuPG's machine protocol
src/crypto/inspect.js       what kind of file is this, without decrypting it
src/paths.js                output filenames; never overwrites, never escapes the directory
src/setup/bootstrap.js      installing and configuring GnuPG without a terminal
renderer/index.html         markup for all ten screens
renderer/styles.css         the whole visual layer, no framework
renderer/renderer.js        UI logic; falls back to a demo bridge when window.api is missing
build-dmg.command           double-click on a Mac: builds dist/Sealbox.dmg
publish.command             double-click on a Mac: pushes and tags, GitHub builds the .dmg
tools/build-preview.js      builds preview.html from the three renderer files
tools/vendor-gpg.sh         bundles GnuPG into the .app (optional, macOS only)
test/crypto.test.js         container detection, path safety, card-key parsing
test/setup.test.js          connection-method order and gpg discovery
test/smoke-electron.js      boots the real app and checks that a screen renders
preview.html                generated by `npm run preview`, committed so the UI can be reviewed
                            without a Mac or a device
```

### Key generation on the device

GnuPG has no non-interactive command for generating a key on a card; `--card-edit` is a
dialogue. It does have a machine protocol. With `--command-fd 0 --status-fd 2` it prints what it
is waiting for:

```
[GNUPG:] GET_LINE keygen.email
```

and the app writes the answer to stdin. So the dialogue is walked by keyword, not by matching
human-readable text. The PIN does not go through this channel — `pinentry` asks for it directly
and the app never sees it.

On a prompt it does not recognise the code stops instead of guessing, and logs the keyword so
the missing answer can be added as one line.

### The recovery card

Ledger erases OpenPGP keys on every firmware or app update. That is normal device behaviour. If
Seed mode is on, the same key can be recreated from the device's 24-word seed plus three exact
values: a fixed generation timestamp, the name, and the email. Sealbox shows them and offers to
save them to a file. What that file is worth to an attacker:
[SECURITY.md §7](SECURITY.md#7-the-recovery-card).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security findings:
[SECURITY.md §11](SECURITY.md#11-reporting-a-problem).

## Licence

MIT for our own code — see [LICENSE](LICENSE). Third-party components and their obligations:
[LICENSES-THIRD-PARTY.md](LICENSES-THIRD-PARTY.md).
