'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const boot = require('../src/setup/bootstrap');

test('the method needing no administrator password is tried first', () => {
  assert.strictEqual(boot.LINK_ORDER[0], 'internal');
  assert.ok(!boot.LINKS.internal.includes('disable-ccid'),
    "gnupg's internal driver must not be disabled, or the system one becomes necessary");
  assert.ok(boot.LINKS.pcsc.includes('disable-ccid') && boot.LINKS.pcsc.includes('pcsc-shared'),
    'the second method switches scdaemon to the system smartcard service');
});

test('both methods set the Ledger reader and allow admin commands', () => {
  for (const [name, text] of Object.entries(boot.LINKS)) {
    assert.ok(text.includes('reader-port "Ledger Token"'), `${name}: reader is specified`);
    assert.ok(text.includes('allow-admin'), `${name}: admin commands allowed, without them no key can be created`);
  }
});

test('a gpg bundled with the app takes precedence over the system one', async () => {
  // fake a bundle: an executable that answers --version
  const bundle = fs.mkdtempSync(path.join(os.tmpdir(), 'sealbox-bundle-'));
  const bin = path.join(bundle, 'gnupg', 'bin');
  fs.mkdirSync(bin, { recursive: true });

  const fake = path.join(bin, 'gpg');
  fs.writeFileSync(fake, '#!/bin/sh\necho "gpg (GnuPG) 9.9.9 (bundled)"\n');
  fs.chmodSync(fake, 0o755);

  const found = await boot.findGpg(bundle);
  assert.ok(found, 'gpg found');
  assert.strictEqual(found.path, fake, 'the bundled one was chosen, not the system one');
  assert.strictEqual(found.bundled, true);
});

test('without a bundle the system gpg is used, when present', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sealbox-empty-'));
  const found = await boot.findGpg(empty);
  if (!found) return; // nothing to check on a machine without gpg
  assert.strictEqual(found.bundled, false);
  assert.ok(found.path.endsWith('gpg'));
});

test('configuration is written into the gnupg home, not somewhere arbitrary', () => {
  assert.strictEqual(boot.GNUPGHOME, path.join(os.homedir(), '.gnupg'));
});
