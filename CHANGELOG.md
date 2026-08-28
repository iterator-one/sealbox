# Changelog

## 1.1.0 — the interface from the design file, and keys for other people

### Encrypting for someone else

Until now a file was always encrypted to your own key, which meant nobody else could open it —
the app was a personal safe, not a way to send anything. It now keeps a list of public keys:

- drop a `.asc` file a correspondent sent you; Sealbox reads it with `--show-keys` (which imports
  nothing), shows the name and fingerprint, and imports it only after you agree;
- when you encrypt, you tick who may open the file — yourself, them, or several people at once;
- the file is still signed on the device, so the recipient can also see who it came from.

A file that turns out to hold a private key is refused. `src/crypto/keys.js`, `test/keys.test.js`.

### The Ledger says what is actually wrong

The status row used to know two things: a device is there, or it is not. It now distinguishes
eight states, and each one names the fix — nothing plugged in, the OpenPGP app not open, Ledger
Live holding the device, a device with no key on it, GnuPG missing. Two read-only observations
make that possible (`ioreg`, `pgrep`); when they are unavailable the state degrades to
"disconnected" rather than guessing. `src/device/state.js`, `test/device.test.js`.

### The interface is now built from the design

Every screen was rebuilt from the Figma file: a 520x640 window with its own title bar and
32px corners, the 494px content column, the colour set, the type scale, the eighteen screens and
their exact wording. The setup guide grew from four screens to the full nine-step flow with a
progress bar, an acknowledgement for Seed mode, and a recovery card you can copy or save.

Two things are deliberately not pixel-identical to the design file, and both are noted in the
README: Neue Montreal is a commercial font and cannot ship with an open source app, so titles
fall back to Inter; and the design's step 3 numbers its progress bar out of six while every other
screen uses seven, so the app uses seven throughout.

Inline `style` attributes are gone, because the renderer's Content-Security-Policy forbids them —
the app would have rendered unstyled fragments in Electron while looking correct in a browser.

### Build

GitHub Actions dropped the node20 runtime, so every action pinned to a major
built for it ran with a deprecation warning. All four are now on majors that run on node24:
`actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7` and
`softprops/action-gh-release@v3`. Their inputs are unchanged, so the workflows are otherwise
the same.

### Two dead ends closed

- **Details** on the status row used to open an empty recovery card, because the values only
  existed in memory right after a key was created. It now fills them from the key that is on the
  device, using the fixed generation timestamp the app always regenerates with.
- Starting an operation with **GnuPG missing** left a spinner running forever, waiting for
  something no amount of waiting could fix. That state now offers the setup guide instead.

### The wording is now testable

Every device state and every setup step lives in `renderer/copy.js`, which loads both in the
window and in a test. `test/copy.test.js` checks that all eight device states have a title, that
each one that needs a fix says what the fix is, that the nine setup steps each point at a screen
that exists, and that the progress bar advances one segment per step. The smoke test walks all
eighteen screens in the real window and fails if any renders empty or spills outside 520x640.

## 1.0.2 — first public release

Everything below was fixed before publication. The repository's history starts here. These items
are written down because they say something about how the project is tested.

### The renderer never ran

`preload.js` exposes a global `window.api`. `renderer.js` declared a top-level `const api` for
the same thing. A lexical declaration that collides with a non-configurable global property is a
`SyntaxError`, so Electron refused to parse the whole renderer script. No handler was registered,
no screen was ever shown, and the window displayed its static header over an empty body.

The browser preview could not catch it: there is no `window.api` there, so there is no collision
and every screen worked. That is why the bug survived code review, an audit of ids and IPC
channels, and a headless walkthrough of all ten screens.

Three changes came out of it:

- the binding was renamed to `bridge`;
- `main.js` now forwards renderer console errors to stderr, so a failure like this prints in the
  terminal instead of leaving a blank window;
- `test/smoke-electron.js` boots the real application under Electron and checks that exactly one
  screen is active, that it is the drop screen, that it has visible text, and that the version
  badge matches `package.json`. It runs in CI under `xvfb` on every push and before every release
  build.

### Also fixed

- The first screen waited for the environment probe. On a machine without GnuPG the probe walked
  five candidate paths at a five-second timeout each, so the window stayed empty for up to half a
  minute — on exactly the machines that needed the setup guide. The drop screen is now shown
  first, and candidates are probed in parallel with a 2.5 s timeout.
- The version badge read `app.getVersion()`, which returns Electron's own version under
  `electron .`. It now reads `package.json`.
- Field 15 of a `sec` record holds `+` for an ordinary key and a serial number for a card-backed
  one. `+` was being read as a serial, so every ordinary key in the keyring was reported as
  living on the device. There is a regression test.
- A dashed border pseudo-element covered the drop zone and swallowed clicks on the button inside
  it.

### Not in this release

- Key generation on the device has never been run against real hardware by the authors. It is
  written against the GnuPG machine protocol and stops instead of guessing on an unknown prompt.
- No independent review.
- No reproducible builds, and releases are unsigned.

The same list is in [SECURITY.md](SECURITY.md#9-known-gaps).
