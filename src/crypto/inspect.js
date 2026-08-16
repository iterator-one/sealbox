'use strict';
/**
 * Determine what kind of file this is, without decrypting anything.
 *
 * The UI needs to know immediately whether it is looking at a plain file, a
 * file encrypted to a key (our case), or a file encrypted with a password
 * (encrypted by something else — Sealbox only works with the device).
 *
 * We parse the OpenPGP header with openpgp.js: the packet type tells us how
 * the session key is protected. No password and no device are needed for this.
 */

const fs = require('fs/promises');
const openpgp = require('openpgp');

/** Reads the container in both binary and armored (.asc) form. */
async function readAnyMessage(raw) {
  const head = raw.subarray(0, 30).toString('latin1');
  if (head.includes('-----BEGIN PGP')) {
    return openpgp.readMessage({ armoredMessage: raw.toString('utf8') });
  }
  return openpgp.readMessage({ binaryMessage: new Uint8Array(raw) });
}

/**
 * @returns {Promise<{kind: 'publicKey'|'password'|'unknown', keyIds: string[]}>}
 *   publicKey — encrypted to a key (including a key held on a Ledger)
 *   password  — encrypted with a password
 *   unknown   — not an OpenPGP container
 */
async function inspect(filePath) {
  let message;
  try {
    message = await readAnyMessage(await fs.readFile(filePath));
  } catch {
    return { kind: 'unknown', keyIds: [] };
  }

  const keyIds = message.getEncryptionKeyIDs().map((id) => id.toHex().toUpperCase());
  if (keyIds.length > 0) return { kind: 'publicKey', keyIds };

  // tag 3 — SymEncryptedSessionKeyPacket: the session key is password-protected
  const hasPassword = message.packets.some(
    (p) => p.constructor && p.constructor.tag === openpgp.enums.packet.symEncryptedSessionKey
  );
  return { kind: hasPassword ? 'password' : 'unknown', keyIds: [] };
}

module.exports = { inspect, readAnyMessage };
