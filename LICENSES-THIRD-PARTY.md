# Third-party components

## GnuPG

If the build was made with `npm run vendor`, a copy of **GnuPG** lives inside the application
(`Sealbox.app/Contents/Resources/gnupg/`) together with its dependent libraries: libgcrypt,
libgpg-error, libassuan, libksba, npth and others.

GnuPG is distributed under the **GNU General Public License v3 or later**; the libraries under
the **LGPL v2.1 or later**.

Distributing such a build therefore obliges you to:

1. include the full text of the GPLv3 and the LGPL with the distribution;
2. accompany it with a written offer of GnuPG's source code — either ship the source itself or
   point at https://gnupg.org/download/;
3. preserve all copyright notices;
4. not restrict any right the GPL grants to the recipient.

Sealbox's own code is MIT-licensed. Combining the two is permitted: GnuPG is invoked as a
separate process, not linked into the application, so this is aggregation of two programs on
one medium. Each part keeps its own licence.

**Releases published from this repository do run `npm run vendor`,** so the obligations above
apply to them. A build made without it uses a system-installed GnuPG and ships no GnuPG code.

## openpgp.js

LGPL v3. Used as an unmodified npm dependency, only to read OpenPGP packet headers
(see `src/crypto/inspect.js`).
Source: https://github.com/openpgpjs/openpgpjs

## Inter (typeface)

`renderer/fonts/inter-400.woff2` and `inter-500.woff2`, from the Inter project by Rasmus
Andersson. Licensed under the **SIL Open Font License 1.1**, which permits bundling and
redistribution inside an application. Unmodified.
Source: https://github.com/rsms/inter

Neue Montreal, the display face used in the design file, is a commercial font and is **not**
included. Titles fall back to Inter unless the font is installed on the machine.

## Electron

MIT, with its own bundled third-party components (Chromium — BSD-style, Node.js — MIT).
Used unmodified from npm.
