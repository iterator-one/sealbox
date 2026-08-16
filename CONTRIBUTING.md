# Contributing

The project is small on purpose. Our own code is about 1 100 lines and should stay small enough
to read in one sitting.

## Rules

1. **No new cryptography.** Every cryptographic operation goes to GnuPG. A patch that implements
   a cipher, a KDF or a protocol will be declined regardless of quality.
2. **No new runtime dependencies** without an argument for it in the pull request. There is
   currently one (`openpgp`, used only to read packet headers).
3. **No network calls.** The app makes none, and that is a documented guarantee.
4. **No telemetry**, no crash reporting, no update pings.
5. **Comments say why, not what.** The code already says what it does.

## Before opening a pull request

```bash
npm install
npm test
npm run smoke     # boots the app under Electron
npm run preview   # if you touched the UI — check every screen
```

If your change touches `preload.js`, the IPC handlers in `main.js`, or anything in
`src/setup/bootstrap.js`, say so in the description and update [SECURITY.md](SECURITY.md) in the
same pull request.

## Useful things to work on

- Streaming encryption instead of reading files fully into memory.
- Reproducible builds.
- Running key generation against real hardware and reporting the GnuPG prompt sequence
  (see [SECURITY.md §9](SECURITY.md#9-known-gaps)).

## Reporting problems

Bugs and questions: GitHub issues. Security findings: GitHub private security advisories on this
repository. Security research is welcome, including publishing what you find.
