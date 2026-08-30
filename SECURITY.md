# Security

This document is for people who want to know what the program actually does before trusting a
file to it: reviewers, security engineers, and anyone whose files matter.

**Status: v1.2.2. No independent review.** One important path — key generation on the device —
has never been run against real hardware by the authors. See [§9](#9-known-gaps).

---

## 1. In short

Sealbox encrypts a file to an OpenPGP key whose private half lives in the secure element of a
Ledger hardware wallet. That key cannot be exported: not by Sealbox, not by the operating
system, not by someone holding the disk. Decrypting needs the physical device and its PIN.

Sealbox implements no cryptography. GnuPG does all of it, and delegates card operations to
`scdaemon`.

## 2. What Sealbox guarantees

| Claim | Why it holds |
|---|---|
| The private key never touches disk or RAM on the host | It is generated on the device and marked non-exportable by the OpenPGP applet. Sealbox answers `n` to GnuPG's "make off-card backup?" prompt, so no copy is written. |
| Sealbox never sees your PIN | The PIN is collected by `pinentry`, a separate process started by `gpg-agent`. Sealbox has no channel to it. Where GnuPG could ask us for hidden input we answer with an empty line and let pinentry take over (`src/crypto/cardkey.js`, `GET_HIDDEN` branch). |
| No plaintext copies are written | Output paths are computed in `src/paths.js`. The only files written are the ciphertext, the decrypted output you asked for, and the recovery card. Nothing goes to a temp directory. |
| The format is not proprietary | Output is standard OpenPGP (RFC 9580). Check with `gpg --list-packets file.gpg`. If this project disappears, `gpg --decrypt` still opens your files. |
| No network traffic | The app opens no sockets: `test/guarantees.test.js` fails the build if `fetch`, `XMLHttpRequest`, or the `net`/`dns`/`http`/`https`/`tls` modules appear anywhere in first-party code. The renderer's CSP is `default-src 'none'`. Two things are not the app making a request: `shell.openExternal` hands an address to the browser or to Ledger Live, and the optional GnuPG install step runs Homebrew — see [§5](#5-privileged-operations). |
| Addresses live in one file | Every address Sealbox can hand to the system is in `src/links.js`, and a test fails if a URL appears in code anywhere else. The interface asks for one by name and cannot supply its own. |
| No telemetry | No analytics, no crash reporter, no update check. Grep for `http` in `src/` and `main.js`. |
| A public key is never imported behind your back | A dropped key file is read with `--show-keys`, which parses and imports nothing. The name and fingerprint are shown, and `--import` runs only after you press the button (`src/crypto/keys.js`). A file containing a *private* key is refused. |

## 3. What it does not protect against

- **A compromised computer.** Malware running as you can read the file before you encrypt it,
  read it after you decrypt it, or ask the device to decrypt files while it is plugged in. The
  device protects the key, not the session. Turning on UIF makes every decryption require a
  physical button press, which limits this.
- **Coercion.** Anyone who can make you plug in the device and type the PIN gets the data.
- **A malicious or backdoored device.** Sealbox trusts the secure element and Ledger's OpenPGP
  applet, and cannot verify either.
- **Metadata.** File size, timestamps and the recipient key ID are visible in the ciphertext.
  The original filename is stored inside the container, so it leaks only through the default
  `report.docx.gpg` naming.
- **Losing the recovery data.** If the device state and the recovery card are both gone, the
  files cannot be opened. See [§7](#7-the-recovery-card).
- **Traffic analysis, side channels and fault injection** on the device.

## 4. Dependencies

Our own code is about 1 100 lines across nine files (`main.js`, `preload.js`, `src/**`).

### GnuPG — all cryptography, all device communication

- **Why:** talking to an OpenPGP smartcard needs `scdaemon`, which is part of GnuPG.
  Reimplementing the card protocol would mean new, unreviewed cryptographic code. Delegating
  means the cryptography here is the same code that has been in public use since 1997.
- **How it is called:** as a separate process through `child_process.execFile` with an argument
  array, never a shell string, so a filename cannot be read as shell syntax
  (`src/crypto/gpg.js`).
- **What we pass:** file paths, a recipient key ID, and answers to interactive prompts. Never a
  passphrase or PIN.
- **Licence:** GPLv3. If the binary is bundled (`npm run vendor`), the obligations in
  `LICENSES-THIRD-PARTY.md` apply.

### openpgp.js — file type detection only

- **Why:** to answer one question without decrypting anything — is this file encrypted to a key,
  encrypted to a password, or not an OpenPGP file at all? That decides which screen you see.
- **Scope:** `src/crypto/inspect.js` is 49 lines. It calls `readMessage()` and reads packet tags.
  It never receives a key, a passphrase or plaintext, and never writes files.
- **Known cost:** it reads the whole file into memory to parse the header. Wasteful on very
  large files; on the fix list.
- **Licence:** LGPL v3, unmodified npm dependency.

### Electron — the window

- **Renderer isolation:** `contextIsolation: true`, `nodeIntegration: false`. The interface has
  no access to Node, the filesystem or the network, only to the functions listed in
  `preload.js`.
- **Content Security Policy:** `default-src 'none'; style-src 'self'; script-src 'self'`. No
  remote scripts, no inline scripts, no remote content.
- **No `remote` module, no `webview`, no `nodeIntegrationInSubFrames`.**
- **Known cost:** Electron is a whole Chromium, which is a large attack surface. A native app
  would be smaller. This is a trade for cross-platform reach and readable UI code.

### Inter — the interface typeface

Two `.woff2` files under `renderer/fonts/`, loaded by the stylesheet. A font is data, not code:
it is parsed by the same font engine that handles every other font on the system. It ships with
the app because the renderer is not allowed to fetch anything from the network (`font-src 'self'`),
and because a downloaded font would be a network call the app promises not to make. Licence: SIL
Open Font License 1.1.

### Nothing else at runtime

`package.json` has exactly one production dependency (`openpgp`). Everything else is a build
tool. No analytics SDK, no logging service, no auto-updater.

## 5. Privileged operations

Two places where Sealbox does something worth looking at closely. Both are in
`src/setup/bootstrap.js`, and both start with a button press in the setup screen.

A third thing worth knowing about, though it is not privileged: to explain *why* a device is
unavailable, `src/device/state.js` runs two read-only commands, `ioreg -p IOUSB` (is a Ledger on
the USB bus?) and `pgrep -x "Ledger Live"` (is Ledger Live holding it?). Both are observations,
neither changes anything, and if either is unavailable the state simply degrades to
"disconnected" instead of guessing.

### Installing GnuPG

If GnuPG is missing and Homebrew is present, Sealbox runs:

```
<brew> install gnupg pinentry-mac
```

with `HOMEBREW_NO_AUTO_UPDATE=1`. This runs third-party code with your privileges. The output is
streamed into the interface. If Homebrew is missing, Sealbox does nothing and says so; it never
downloads and runs a binary on its own.

### Opening a link or Terminal

The setup screens can open a page in the browser, a screen inside Ledger Live, or Terminal. The
interface passes a *name*, not a URL: `main.js` maps five names to hard-coded addresses and
refuses anything else, so no string the renderer could be fed turns into an arbitrary link. Two
of them are Ledger Live's own `ledgerlive://` deep links, which open a screen in that app —
they cannot change a setting or install anything, so enabling Developer mode and installing the
OpenPGP app stay decisions the user makes inside Ledger Live. Terminal is opened with
`open -a Terminal` and nothing is typed into it.

### Enabling the macOS smartcard driver

If the device cannot be reached by either communication method, you can press a button that runs,
through `osascript`:

```
do shell script "defaults write /Library/Preferences/com.apple.security.smartcard useIFDCCID -bool yes"
  with administrator privileges
```

This shows the standard macOS password dialog. It writes one boolean to one system preference:
the flag that enables Apple's bundled CCID driver. It is only offered after the method that
needs no privileges has failed, and you can decline.

The order is enforced by a test: the method that needs no elevated privileges is always tried
first (`test/setup.test.js`).

## 6. Files written outside the working folder

| Path | Contents | When |
|---|---|---|
| `~/.gnupg/scdaemon.conf` | reader configuration | setup; any previous file copied to `*.sealbox-backup` first |
| `~/.gnupg/gpg-agent.conf` | path to pinentry | setup; same backup rule |
| `<file>.gpg` next to the source file | ciphertext | on encrypt |
| recovery card, path you choose | key regeneration values | when you save it |

No file is ever overwritten. `uniquePath()` in `src/paths.js` appends ` (1)`, ` (2)` and so on.

## 7. The recovery card

Ledger erases OpenPGP keys on every firmware or app update. With Seed mode on, the same key can
be recreated from the device's 24-word seed plus three exact values: the fixed generation
timestamp, the name, and the email. Sealbox shows them and offers to save them.

The card is not secret on its own — it is useless without the 24-word seed. But storing it next
to the seed phrase means whoever finds both can rebuild the key. The file says this in its own
text.

## 8. Input handling

- **Filenames inside encrypted files are untrusted.** OpenPGP stores the original filename in
  the container. Sealbox reduces it to `path.basename()` before writing, so a container claiming
  to be `../../../etc/passwd` writes `passwd` into the current folder and nothing else. There is
  a test for this.
- **IPC arguments** are paths or short strings, passed to `execFile` argument arrays. No string
  is ever interpolated into a shell command anywhere in the code.
- **The interface never builds a path.** It receives paths from the main process and passes them
  back unchanged.
- **Key files are parsed before they are trusted.** `--show-keys` reads a dropped `.asc` without
  importing it, so a malformed or hostile file cannot silently end up in your keyring. A file
  that turns out to contain a private key is refused outright: Sealbox has no reason to hold
  anybody's secret key.
- **Recipients are passed to gpg as `--recipient <fingerprint>` arguments**, from the list the
  keyring itself produced — the interface never supplies a free-text recipient.

## 9. Known gaps

Ordered by how much they should worry you.

1. **Key generation has never run against real hardware.** The `--command-fd`/`--status-fd`
   dialogue in `src/crypto/cardkey.js` was written from the GnuPG protocol specification and
   tested only for parse correctness. On a prompt it does not recognise it stops instead of
   guessing, and logs the keyword.
2. **No reproducible builds.** You cannot yet verify that a released `.dmg` was built from this
   source.
3. **Releases are unsigned and not notarised.** macOS warns on first launch and you have to
   approve the app in System Settings → Privacy & Security. Signing needs a paid Apple Developer
   ID. Until then, check the published SHA-256 instead of relying on Gatekeeper — steps in
   [INSTALL.md](INSTALL.md).
4. **Files are read fully into memory** for type detection and encryption. Not suitable for very
   large files yet.
5. **No independent review.** Nobody outside this repository has read the code.
6. **The bundled GnuPG is one architecture.** Releases carry the build the CI runner produced
   (Apple Silicon). On an Intel Mac the copy fails its version probe and Sealbox falls back to a
   system GnuPG or to the manual-install screen; it never runs a binary it could not execute.
7. **The `ioreg` / `pgrep` device heuristics are best-effort.** They make the error messages
   specific, but a state of "disconnected" can also mean "we could not tell". Nothing
   cryptographic depends on them.
8. **Bundled GnuPG has not been exercised against a real Ledger.** The binaries are copied,
   relinked, signed ad-hoc and checked to run in CI, and `gpg-agent.conf` is pointed at the
   bundled `scdaemon`, but nobody has yet decrypted a file with a device using the bundled copy.

## 10. Checking the claims yourself

```bash
# 1. The output is standard OpenPGP, encrypted to a key, and signed
gpg --list-packets report.docx.gpg

# 2. The private key is on the card, not in the keyring
#    (a card serial in field 15, secret key shown as a stub)
gpg --list-secret-keys --with-colons

# 3. No network code — and every address in one file
grep -rn "fetch(\|XMLHttpRequest\|require('net'\|require('dns'\|require('https\?')" src/ main.js preload.js
grep -rn "https\?://" src/ main.js preload.js | grep -v src/links.js

# 4. No shell strings
grep -rn "exec(\|execSync\|shell: true" src/ main.js

# 5. Everything the interface can reach
cat preload.js

# 6. Tests
npm test
```

## 11. Reporting a problem

Anything non-sensitive: a GitHub issue. Anything exploitable: GitHub's private security advisory
feature on this repository, not a public issue.

There is no bug bounty, and no legal threat either. Security research on this code is welcome,
including publishing what you find.
