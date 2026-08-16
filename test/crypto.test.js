'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { inspect } = require('../src/crypto/inspect');
const { listKeys } = require('../src/crypto/gpg');
const { uniquePath, decryptedPath } = require('../src/paths');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sealbox-'));
const sample = path.join(tmp, 'classified document.txt');
fs.writeFileSync(sample, 'Top secret \u{1F510}\n');

/** A throwaway keyring, so the real one is never touched. */
const home = path.join(tmp, 'gnupg');
const env = { ...process.env, GNUPGHOME: home };
let gpgReady = false;

try {
  execFileSync('gpg', ['--version'], { stdio: 'ignore' });
  fs.mkdirSync(home, { mode: 0o700, recursive: true });
  execFileSync('gpg', ['--batch', '--quiet', '--passphrase', '', '--quick-generate-key',
    'Test User <test@example.com>', 'ed25519', 'cert,sign', 'never'], { env });
  const out = execFileSync('gpg', ['--list-keys', '--with-colons', 'test@example.com'], { env }).toString();
  const fpr = out.split('\n').find((l) => l.startsWith('fpr:')).split(':')[9];
  execFileSync('gpg', ['--batch', '--quiet', '--passphrase', '', '--quick-add-key',
    fpr, 'cv25519', 'encr', 'never'], { env });
  gpgReady = true;
} catch { /* tests that need gpg will be skipped */ }

const skipIfNoGpg = (t) => (gpgReady ? false : (t.skip('gpg unavailable'), true));

test('recognises a file encrypted to a key', async (t) => {
  if (skipIfNoGpg(t)) return;

  const enc = path.join(tmp, 'by-key.gpg');
  execFileSync('gpg', ['--batch', '--yes', '--trust-model', 'always',
    '--recipient', 'test@example.com', '--output', enc, '--encrypt', sample], { env });

  const info = await inspect(enc);
  assert.strictEqual(info.kind, 'publicKey');
  assert.ok(info.keyIds.length > 0, 'the recipient key id is visible');
});

test('recognises a password-encrypted file and does not mistake it for ours', async (t) => {
  if (skipIfNoGpg(t)) return;

  const enc = path.join(tmp, 'by-password.gpg');
  execFileSync('gpg', ['--batch', '--yes', '--quiet',
    '--pinentry-mode', 'loopback', '--passphrase', 'secret-pass',
    '--output', enc, '--symmetric', sample], { env });

  const info = await inspect(enc);
  assert.strictEqual(info.kind, 'password', 'Sealbox cannot open such a file and must say so');
  assert.strictEqual(info.keyIds.length, 0);
});

test('recognises an armored .asc container as well as a binary one', async (t) => {
  if (skipIfNoGpg(t)) return;

  const enc = path.join(tmp, 'armored.asc');
  execFileSync('gpg', ['--batch', '--yes', '--armor', '--trust-model', 'always',
    '--recipient', 'test@example.com', '--output', enc, '--encrypt', sample], { env });

  assert.strictEqual((await inspect(enc)).kind, 'publicKey');
});

test('does not crash on a file that is not a container at all', async () => {
  const junk = path.join(tmp, 'junk.gpg');
  fs.writeFileSync(junk, Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]));
  assert.strictEqual((await inspect(junk)).kind, 'unknown');
});

test('an ordinary keyring key is not reported as living on the card', async (t) => {
  if (skipIfNoGpg(t)) return;

  // regression: field 15 of a sec line holds '+' for an ordinary key and a
  // serial number for a card-backed one; '+' used to be mistaken for a serial
  const prev = process.env.GNUPGHOME;
  process.env.GNUPGHOME = home;
  try {
    const keys = await listKeys();
    const mine = keys.find((k) => k.uids.some((u) => u.includes('test@example.com')));
    assert.ok(mine, 'key found');
    assert.strictEqual(mine.onCard, false);
  } finally {
    if (prev === undefined) delete process.env.GNUPGHOME;
    else process.env.GNUPGHOME = prev;
  }
});

test('an existing file is never overwritten', () => {
  const target = path.join(tmp, 'clash.gpg');
  fs.writeFileSync(target, 'taken');
  assert.strictEqual(path.basename(uniquePath(target)), 'clash (1).gpg');
});

test('a filename from a container cannot escape the directory', () => {
  const result = decryptedPath(path.join(tmp, 'x.gpg'), '../../../etc/passwd');
  assert.strictEqual(path.dirname(result), tmp);
  assert.strictEqual(path.basename(result), 'passwd');
});
