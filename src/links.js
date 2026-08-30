'use strict';
/**
 * Every address Sealbox can hand to the operating system.
 *
 * These are not requests the app makes: `shell.openExternal` passes the address
 * to the browser, or to Ledger Live, and that program does the fetching. The
 * app itself never opens a socket — see SECURITY.md §2.
 *
 * They live in this one file so the promise can be checked mechanically: a URL
 * anywhere else in the codebase fails the test suite and the build.
 *
 * The interface asks for these by NAME. It cannot pass a URL of its own, so
 * nothing a renderer could be tricked into saying becomes a link.
 */

const LINKS = {
  // How to install a package manager, when the Mac has none
  homebrew: 'https://brew.sh',
  gnupg: 'https://gnupg.org/download/',

  // Ledger Live's own URL scheme. These open one of its screens; they cannot
  // change a setting or install anything, so those decisions stay the user's,
  // made inside Ledger Live.
  'ledger-experimental': 'ledgerlive://settings/experimental',
  'ledger-openpgp': 'ledgerlive://myledger?installApp=OpenPGP',
  'ledger-live': 'https://www.ledger.com/ledger-live',
};

module.exports = { LINKS };
