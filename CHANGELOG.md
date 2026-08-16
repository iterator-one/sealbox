# Changelog

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
