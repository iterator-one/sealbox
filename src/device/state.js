'use strict';
/**
 * What state is the Ledger in?
 *
 * GnuPG can only tell us "there is a card" or "there is not". That is too
 * coarse for the interface, which needs to say *why* the device is unavailable,
 * so two cheap observations are added on macOS:
 *
 *   ioreg  — is a Ledger plugged into USB at all?
 *   pgrep  — is Ledger Live running? It holds the device and locks everyone else out.
 *
 * Both are read-only, both are optional: on any other system, or if the command
 * is missing, the corresponding fact is simply unknown and the state falls back
 * to what gpg alone can prove. The states are deliberately named after what the
 * user has to do, not after what the code observed.
 */

const { execFile } = require('child_process');

const STATES = ['no-gpg', 'checking', 'disconnected', 'closed', 'ledger-live', 'ready', 'no-key', 'error'];

function run(bin, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve({ ok: !err, stdout: stdout || '' });
    });
  });
}

/** True if a Ledger device is on the USB bus. Unknown → null. */
async function ledgerOnUsb() {
  if (process.platform !== 'darwin') return null;
  const res = await run('ioreg', ['-p', 'IOUSB', '-l', '-w', '0']);
  if (!res.ok) return null;
  return /Ledger|Nano S|Nano X|0x2c97/i.test(res.stdout);
}

/** True if Ledger Live is running. Unknown → null. */
async function ledgerLiveRunning() {
  if (process.platform !== 'darwin') return null;
  const res = await run('pgrep', ['-x', 'Ledger Live']);
  if (res.ok) return true;
  const fallback = await run('pgrep', ['-f', 'Ledger Live.app']);
  return fallback.ok ? true : false;
}

/**
 * Decide the state from three facts.
 *
 * @param {object} facts
 * @param {boolean} facts.hasGpg          gpg was found
 * @param {boolean} facts.cardPresent     gpg --card-status succeeded
 * @param {boolean} facts.cardHasKey      the card reports a signature key
 * @param {boolean|null} facts.onUsb      a Ledger is plugged in (null = unknown)
 * @param {boolean|null} facts.ledgerLive Ledger Live is running (null = unknown)
 */
function decide({ hasGpg, cardPresent, cardHasKey, onUsb, ledgerLive }) {
  if (!hasGpg) return 'no-gpg';
  if (cardPresent) return cardHasKey ? 'ready' : 'no-key';
  if (ledgerLive === true) return 'ledger-live';
  if (onUsb === true) return 'closed';      // plugged in, but the card is not answering
  if (onUsb === false) return 'disconnected';
  return 'disconnected';                     // nothing plugged in that we can see
}

async function observe() {
  const [onUsb, ledgerLive] = await Promise.all([ledgerOnUsb(), ledgerLiveRunning()]);
  return { onUsb, ledgerLive };
}

module.exports = { decide, observe, ledgerOnUsb, ledgerLiveRunning, STATES };
