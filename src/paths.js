'use strict';
const fs = require('fs');
const path = require('path');

/** Never overwrite an existing file: secret.gpg → secret (1).gpg */
function uniquePath(target) {
  if (!fs.existsSync(target)) return target;

  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);

  for (let i = 1; i < 1000; i += 1) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Too many files with that name');
}

/** Where the ciphertext goes. */
function encryptedPath(inputPath) {
  return uniquePath(`${inputPath}.gpg`);
}

/**
 * Where the decrypted output goes.
 * originalName is the filename stored inside the container at encryption time.
 * It is attacker-controlled, so we keep only its basename — a container
 * claiming to be '../../../etc/passwd' can never escape the directory.
 */
function decryptedPath(inputPath, originalName) {
  const dir = path.dirname(inputPath);
  let name;

  if (originalName) {
    name = path.basename(originalName);
  } else if (/\.(gpg|pgp|asc)$/i.test(inputPath)) {
    name = path.basename(inputPath).replace(/\.(gpg|pgp|asc)$/i, '');
  } else {
    name = `${path.basename(inputPath)}.decrypted`;
  }

  if (!name || name === '.' || name === '..') name = 'decrypted';
  return uniquePath(path.join(dir, name));
}

module.exports = { uniquePath, encryptedPath, decryptedPath };
