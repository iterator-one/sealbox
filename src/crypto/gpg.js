'use strict';
/**
 * Hardware-key mode.
 *
 * The private key lives inside the Ledger's secure element and physically
 * cannot be extracted, so nothing — not this program, not anyone else — can
 * decrypt without the device present.
 *
 * Only gpg knows how to talk to a smartcard (through scdaemon / PC-SC), so we
 * call the system gpg instead of implementing any cryptography here. No secret
 * ever passes through this module: the PIN is asked for by pinentry directly,
 * and with UIF enabled the operation is confirmed by a button on the device.
 *
 * Every invocation uses execFile with an argument array — never a shell string,
 * so a filename can never be interpreted as shell syntax.
 */

const { execFile } = require('child_process');
const path = require('path');

/** Places gpg usually lives on macOS (a bundled .app has a minimal PATH). */
const GPG_CANDIDATES = [
  // gpg bundled into the app at build time (tools/vendor-gpg.sh)
  process.resourcesPath ? require('path').join(process.resourcesPath, 'gnupg', 'bin', 'gpg') : null,
  'gpg',
  '/opt/homebrew/bin/gpg',
  '/usr/local/bin/gpg',
  '/usr/local/MacGPG2/bin/gpg',
  '/opt/local/bin/gpg',
].filter(Boolean);

let cachedGpgPath = null;

function run(bin, args, { timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/**
 * Locate a working gpg. Returns its path, or null.
 *
 * All candidates are probed in parallel: probing them one by one meant that on
 * a machine without gpg the caller waited for every timeout in turn, and the
 * window stayed empty for the whole of it. The list order still decides the
 * winner, so a gpg bundled with the app keeps its priority.
 */
async function findGpg() {
  if (cachedGpgPath) return cachedGpgPath;

  const results = await Promise.all(
    GPG_CANDIDATES.map((candidate) => run(candidate, ['--version'], { timeout: 2500 }))
  );
  const index = results.findIndex((res) => res.ok);
  if (index === -1) return null;

  cachedGpgPath = GPG_CANDIDATES[index];
  return cachedGpgPath;
}

/**
 * Environment snapshot for the UI.
 * @returns {Promise<{gpg: string|null, version: string|null, card: object|null, keys: Array}>}
 */
async function status() {
  const gpg = await findGpg();
  if (!gpg) return { gpg: null, version: null, card: null, keys: [] };

  const ver = await run(gpg, ['--version'], { timeout: 5000 });
  const version = (ver.stdout.split('\n')[0] || '').trim();

  return { gpg, version, card: await cardStatus(gpg), keys: await listKeys(gpg) };
}

/**
 * Is a card present? A Ledger is only visible as a smartcard while the OpenPGP
 * app is open on its screen; otherwise it is just an ordinary USB device.
 */
async function cardStatus(gpg) {
  const bin = gpg || (await findGpg());
  if (!bin) return null;

  const res = await run(bin, ['--card-status', '--with-colons'], { timeout: 15000 });
  if (!res.ok) return null;

  const card = { reader: null, serial: null, holder: null, keyFingerprints: [] };
  for (const line of res.stdout.split('\n')) {
    const f = line.split(':');
    if (f[0] === 'Reader') card.reader = f[1] || null;
    if (f[0] === 'serial') card.serial = f[1] || null;
    if (f[0] === 'name') card.holder = [f[2], f[1]].filter(Boolean).join(' ') || null;
    if (f[0] === 'fpr') card.keyFingerprints = f.slice(1).filter(Boolean);
  }
  return card;
}

/**
 * Public keys in the keyring. onCard=true means the private half lives on the
 * smartcard, i.e. this key can only decrypt while the device is connected.
 */
async function listKeys(gpg) {
  const bin = gpg || (await findGpg());
  if (!bin) return [];

  const pub = await run(bin, ['--list-keys', '--with-colons'], { timeout: 15000 });
  if (!pub.ok) return [];

  const cardFingerprints = new Set(await fingerprintsOnCard(bin));
  const keys = [];
  let current = null;

  for (const line of pub.stdout.split('\n')) {
    const f = line.split(':');
    if (f[0] === 'pub') {
      current = { keyId: f[4], algo: f[16] || '', created: f[5], uids: [], fingerprint: null, onCard: false };
      keys.push(current);
    } else if (f[0] === 'fpr' && current && !current.fingerprint) {
      current.fingerprint = f[9];
      if (cardFingerprints.has(f[9])) current.onCard = true;
    } else if (f[0] === 'uid' && current) {
      const uid = decodeUid(f[9]);
      if (uid) current.uids.push(uid);
    } else if (f[0] === 'sub' && current) {
      // the encryption subkey may live on the card as well
    } else if (f[0] === 'fpr' && current && current.fingerprint) {
      if (cardFingerprints.has(f[9])) current.onCard = true;
    }
  }
  return keys.filter((k) => k.uids.length > 0);
}

/** Fingerprints of keys whose private half is held on the smartcard. */
async function fingerprintsOnCard(bin) {
  const sec = await run(bin, ['--list-secret-keys', '--with-colons'], { timeout: 15000 });
  if (!sec.ok) return [];

  const result = [];
  let stubbed = false;
  for (const line of sec.stdout.split('\n')) {
    const f = line.split(':');
    if (f[0] === 'sec' || f[0] === 'ssb') {
      // Field 15: '+' means an ordinary key in the keyring, '#' means the
      // secret key is absent, and a serial number means the secret key is a
      // stub — the real one is on the card.
      const token = (f[14] || '').trim();
      stubbed = Boolean(token) && token !== '+' && token !== '#';
    } else if (f[0] === 'fpr' && stubbed) {
      result.push(f[9]);
      stubbed = false;
    }
  }
  return result;
}

/** GnuPG percent-escapes uid strings. */
function decodeUid(raw) {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw.replace(/\\x/g, '%'));
  } catch {
    return raw;
  }
}

/** Encrypt to a public key. The device is not needed for this. */
async function encryptToKey(inputPath, outputPath, keyId) {
  const bin = await findGpg();
  if (!bin) throw new Error('GnuPG not found');

  const res = await run(bin, [
    '--batch', '--yes',
    '--trust-model', 'always',
    '--recipient', keyId,
    '--output', outputPath,
    '--encrypt', inputPath,
  ]);

  if (!res.ok) throw new Error(cleanError(res.stderr) || 'Encryption failed');
  return outputPath;
}

/**
 * Encrypt and sign with the on-device key.
 *
 * The signature is the one step where the Ledger genuinely participates: it is
 * computed inside the secure element, the PIN is requested, and with UIF
 * enabled the physical button must be pressed. Useful side effect: the
 * recipient can verify who the file came from.
 *
 * Deliberately no --batch: otherwise pinentry cannot show the PIN dialog.
 */
async function signEncryptToKey(inputPath, outputPath, recipientId, signerId) {
  const bin = await findGpg();
  if (!bin) throw new Error('GnuPG not found');

  const args = [
    '--yes',
    '--trust-model', 'always',
    '--recipient', recipientId,
    '--output', outputPath,
  ];
  if (signerId) args.push('--local-user', signerId);
  args.push('--sign', '--encrypt', inputPath);

  const res = await run(bin, args, { timeout: 300000 });
  if (!res.ok) {
    const stderr = res.stderr || '';
    if (/No secret key|secret key not available|card.*not available/i.test(stderr)) {
      throw new Error('Device unavailable. Connect the Ledger and open the OpenPGP app');
    }
    if (/cancell?ed/i.test(stderr)) throw new Error('Cancelled on the device');
    if (/Bad PIN|bad passphrase/i.test(stderr)) throw new Error('Wrong PIN');
    throw new Error(cleanError(stderr) || 'Encryption failed');
  }
  return outputPath;
}

/**
 * Decrypt with the on-device key.
 * No --batch: the PIN is asked for by pinentry, and with UIF enabled the
 * Ledger's button must be pressed as well.
 */
async function decryptWithCard(inputPath, outputPath) {
  const bin = await findGpg();
  if (!bin) throw new Error('GnuPG not found');

  const res = await run(bin, ['--yes', '--output', outputPath, '--decrypt', inputPath], {
    timeout: 300000, // 5 minutes: a human needs time to type a PIN and press a button
  });

  if (!res.ok) {
    const stderr = res.stderr || '';
    if (/No secret key|secret key not available/i.test(stderr)) {
      throw new Error('Key unavailable. Connect the Ledger and open the OpenPGP app on it');
    }
    if (/Operation cancelled|cancell?ed/i.test(stderr)) {
      throw new Error('Cancelled');
    }
    if (/Bad PIN|bad passphrase/i.test(stderr)) {
      throw new Error('Wrong PIN');
    }
    throw new Error(cleanError(stderr) || 'Decryption failed');
  }
  return outputPath;
}

function cleanError(stderr) {
  return (stderr || '')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('gpg: WARNING'))
    .slice(-2)
    .join('; ')
    .replace(/^gpg: /, '');
}

module.exports = {
  findGpg, status, cardStatus, listKeys, encryptToKey, signEncryptToKey, decryptWithCard,
};

/** Forget the cached gpg path — it may have appeared after installation. */
module.exports.reset = () => { cachedGpgPath = null; };
