'use strict';
/**
 * Generate the key on the device itself — with no terminal involved.
 *
 * gpg has no non-interactive command for this: `--card-edit` is a dialogue.
 * It does have a machine protocol though: with `--command-fd 0 --status-fd 2`
 * gpg announces what it is waiting for, in lines like
 *
 *     [GNUPG:] GET_LINE keygen.email
 *
 * and we write the answer to stdin. The dialogue is therefore traversed
 * programmatically and predictably, instead of by scraping human-readable text.
 *
 * The PIN does NOT travel through this channel: pinentry asks for it directly.
 * This program never sees it and has no way to see it.
 *
 * WARNING: the device wipes its OpenPGP keys on every firmware update. The only
 * way back is to repeat generation with the same faked-system-time, name and
 * email — which is why the timestamp is fixed and why we hand the user a
 * "recovery card" afterwards.
 */

const { spawn } = require('child_process');
const { findGpg, cardStatus } = require('./gpg');

/** Feeds into the key fingerprint. Must never change, or the key changes. */
const FAKED_TIME = '19990101T000000!';

/**
 * Answers to the wizard's questions. An array acts as a queue: a repeated
 * question gets the next answer in order.
 */
function answersFor({ name, email, comment }) {
  return {
    // card-edit menu: enable admin commands -> generate -> quit
    'cardedit.prompt': ['admin', 'generate', 'quit'],
    // no off-card backup: the entire point is that the private key never
    // leaves the secure element
    'cardedit.genkeys.backup_enc': 'n',
    'cardedit.genkeys.replace_keys': 'y',
    'keygen.valid': '0',
    'keygen.name': name,
    'keygen.email': email,
    'keygen.comment': comment || '',
    'keygen.userid.cmd': 'O',
  };
}

/**
 * @param {{name: string, email: string, comment?: string}} identity
 * @param {(line: string) => void} [onProgress] — debug log sink
 * @returns {Promise<{fingerprint: string|null, recovery: object, log: string[]}>}
 */
async function generateOnCard(identity, onProgress = () => {}) {
  if (!identity.name || identity.name.trim().length < 5) {
    throw new Error('The name must be at least 5 characters — gpg requires this');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(identity.email || '')) {
    throw new Error('Enter a valid email address');
  }

  const bin = await findGpg();
  if (!bin) throw new Error('GnuPG not found. Install it with: brew install gnupg pinentry-mac');

  const card = await cardStatus(bin);
  if (!card || !card.serial) {
    throw new Error('Device not found. Connect the Ledger and open the OpenPGP app on it');
  }
  const hadKeys = (card.keyFingerprints || []).some((f) => f && f !== 'none');

  const answers = answersFor(identity);
  const queues = {};
  const log = [];

  const say = (line) => { log.push(line); onProgress(line); };
  say(`device ${card.serial}${hadKeys ? ' (existing keys will be replaced)' : ''}`);

  await drive(bin, [
    '--faked-system-time', FAKED_TIME,
    '--command-fd', '0',
    '--status-fd', '2',
    '--card-edit',
  ], answers, queues, say);

  const after = await cardStatus(bin);
  const fingerprint = (after && after.keyFingerprints && after.keyFingerprints[0]) || null;

  return {
    fingerprint,
    recovery: {
      fakedTime: FAKED_TIME,
      name: identity.name,
      email: identity.email,
      comment: identity.comment || '',
      serial: card.serial,
      fingerprint,
    },
    log,
  };
}

/** Drives gpg's dialogue, answering each prompt from the answer map. */
function drive(bin, args, answers, queues, say) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let failure = null;

    const reply = (keyword, isBool) => {
      let value = answers[keyword];

      if (Array.isArray(value)) {
        if (!queues[keyword]) queues[keyword] = value.slice();
        value = queues[keyword].shift();
        if (value === undefined) value = 'quit';
      }

      if (value === undefined) {
        // Unknown prompt: refuse to guess. Leave the dialogue and record the
        // keyword in the log, so the missing answer can be added as one line.
        say(`UNKNOWN PROMPT: ${keyword}`);
        failure = `gpg asked something this app does not know how to answer: ${keyword}`;
        value = isBool ? 'n' : 'quit';
      }

      say(`← ${keyword}: ${maskAnswer(keyword, value)}`);
      child.stdin.write(`${value}\n`);
    };

    child.stderr.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('[GNUPG:] ')) {
          if (line.trim()) say(`gpg: ${line.trim()}`);
          continue;
        }
        const [, keyword, ...rest] = line.slice(9).split(' ');
        const status = line.slice(9).split(' ')[0];
        const arg = line.slice(9).split(' ')[1] || '';

        if (status === 'GET_LINE') reply(arg, false);
        else if (status === 'GET_BOOL') reply(arg, true);
        else if (status === 'GET_HIDDEN') {
          // the PIN must come from pinentry, never from us
          say(`gpg asked for hidden input (${arg}) — answering empty, letting pinentry handle it`);
          child.stdin.write('\n');
        } else if (status === 'KEY_CREATED') {
          say(`key created: ${arg} ${rest.join(' ')}`.trim());
        } else if (status === 'PROGRESS') {
          say('…');
        } else if (status === 'ERROR' || status === 'FAILURE') {
          say(`gpg error: ${line.slice(9)}`);
        }
      }
    });

    child.stdout.on('data', (c) => {
      const text = c.toString('utf8').trim();
      if (text) say(text.split('\n').slice(-1)[0]);
    });

    child.on('error', (err) => reject(new Error(`Could not start gpg: ${err.message}`)));

    child.on('close', (code) => {
      if (failure) return reject(new Error(failure));
      if (code !== 0) return reject(new Error(`gpg exited with code ${code}. See the log for details.`));
      resolve();
    });

    // guard against a stuck dialogue: RSA generation on a Nano takes minutes, not tens of minutes
    setTimeout(() => {
      if (!child.killed) {
        child.kill();
        reject(new Error('Key generation did not finish within 15 minutes — aborted'));
      }
    }, 15 * 60 * 1000).unref();
  });
}

/** Anything that looks like a secret must not reach the log. */
function maskAnswer(keyword, value) {
  return /pin|passphrase|hidden/i.test(keyword) ? '••••' : String(value);
}

/** The recovery card text — what the user should keep on paper. */
function recoveryCard(recovery) {
  return `KEY RECOVERY CARD
=================

The Ledger wipes its OpenPGP keys on every firmware update and whenever the
OpenPGP app is reinstalled. That is normal device behaviour, not a fault.

The same key can be recreated by repeating generation with EXACTLY these
parameters. One wrong character produces a different key, and everything
encrypted with the old one becomes unreadable.

  Timestamp   : ${recovery.fakedTime}
  Name        : ${recovery.name}
  Comment     : ${recovery.comment || '(empty)'}
  Email       : ${recovery.email}
  Device      : ${recovery.serial || '-'}
  Fingerprint : ${recovery.fingerprint || '-'}

To recover manually:

  gpg --faked-system-time ${recovery.fakedTime} --card-edit
  admin
  generate

and enter the same name, comment and email.

Required conditions:
  - Seed mode is enabled on the device (Settings -> Seed mode)
  - you still have the device's 24-word recovery phrase

Print this file or copy it out by hand. Keeping it next to your recovery
phrase is a bad idea: together they are enough to reconstruct the key.
`;
}

module.exports = { generateOnCard, recoveryCard, FAKED_TIME };
