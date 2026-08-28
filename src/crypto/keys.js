'use strict';
/**
 * Public keys — the people you can encrypt for.
 *
 * Encrypting to somebody needs only their public half, so this module never
 * touches a secret. It reads a `.asc` file with `--show-keys` (which parses but
 * imports nothing), and imports only after the user has seen who the key
 * belongs to and pressed the button.
 *
 * Like the rest of the code it shells out to gpg with an argument array, so a
 * filename can never be read as shell syntax.
 */

const { execFile } = require('child_process');

function run(bin, args, { timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/** GnuPG escapes colons and non-ASCII in uid fields as \x3a etc. */
function decodeUid(raw) {
  if (!raw) return '';
  return raw.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** "Alex Morgan (comment) <alex@example.com>" → { name, email } */
function splitUid(uid) {
  // String.match rather than RegExp exec, so the CI guard that forbids shell
  // execution has nothing ambiguous to trip over.
  const match = uid.match(/^(.*?)\s*(?:\(([^)]*)\))?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim(), email: match[3].trim() };
  return { name: uid.trim(), email: '' };
}

/** E4C302BC8672419D → "E4C3 02BC 8672 419D" — the design shows it in fours. */
function prettyFingerprint(fpr) {
  if (!fpr) return '';
  const tail = fpr.length > 16 ? fpr.slice(-16) : fpr;
  return tail.replace(/(.{4})(?=.)/g, '$1 ');
}

/**
 * Parse the colon listing shared by `--list-keys` and `--show-keys`.
 * Returns one entry per primary key, with its first usable uid.
 */
function parseKeyListing(text) {
  const keys = [];
  let current = null;
  for (const line of String(text).split('\n')) {
    const f = line.split(':');
    if (f[0] === 'pub') {
      current = { keyId: f[4], algo: f[16] || '', created: f[5], fingerprint: null, uids: [] };
      keys.push(current);
    } else if (f[0] === 'fpr' && current && !current.fingerprint) {
      current.fingerprint = f[9];
    } else if (f[0] === 'uid' && current) {
      const uid = decodeUid(f[9]);
      if (uid) current.uids.push(uid);
    }
  }
  return keys
    .filter((k) => k.uids.length > 0)
    .map((k) => {
      const { name, email } = splitUid(k.uids[0]);
      return {
        id: k.keyId,
        fingerprint: k.fingerprint || k.keyId,
        fingerprintPretty: prettyFingerprint(k.fingerprint || k.keyId),
        name,
        email,
        algo: k.algo,
      };
    });
}

/** Read a key file without importing it. */
async function inspectKeyFile(gpgPath, filePath) {
  const res = await run(gpgPath, ['--show-keys', '--with-colons', filePath]);
  if (!res.ok && !res.stdout) {
    // gpg failed outright: either the file is unreadable or it is not a key at all.
    const notAKey = /no valid OpenPGP data|invalid packet|no such file/i.test(res.stderr);
    return { error: notAKey ? 'not-a-key' : 'unreadable', detail: res.stderr.trim() };
  }
  const keys = parseKeyListing(res.stdout);
  if (!keys.length) return { error: 'not-a-key', detail: res.stderr.trim() };
  // A secret key exported by mistake still lists as `sec`, which we refuse:
  // Sealbox has no reason to hold anybody's private key.
  if (/^sec:/m.test(res.stdout)) return { error: 'not-a-key', detail: 'this file contains a private key' };
  return { key: keys[0] };
}

async function importKeyFile(gpgPath, filePath) {
  const res = await run(gpgPath, ['--import', filePath]);
  if (!res.ok) return { error: res.stderr.trim() || 'import failed' };
  return { ok: true };
}

module.exports = { parseKeyListing, inspectKeyFile, importKeyFile, prettyFingerprint, splitUid, decodeUid };
