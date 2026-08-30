'use strict';
/**
 * Preparing the environment — without a terminal.
 *
 * An earlier version asked the user to copy a command into Terminal. For a
 * non-technical person that is a wall: an unfamiliar black window, invisible
 * password entry, cryptic output. The app now does the same work itself:
 *
 *   1. gpg is taken from the app bundle if it was placed there at build time
 *      (tools/vendor-gpg.sh) — then there is nothing to install at all;
 *   2. otherwise, if Homebrew is present, the app installs gpg itself and
 *      streams the progress into the UI;
 *   3. the app writes the configuration (~/.gnupg/*.conf) on its own;
 *   4. if the card cannot be reached, it switches to the second communication
 *      method automatically, and only if that also fails does it ask for the
 *      system driver — through the standard macOS authentication dialog.
 *
 * No terminal is opened at any step. Reviewers: see SECURITY.md section 5,
 * which documents both privileged operations in this file.
 */

const { spawn, execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const GNUPGHOME = path.join(os.homedir(), '.gnupg');

/* ------------------------------------------------------------------ */
/* Smartcard communication methods                                     */
/* ------------------------------------------------------------------ */

/**
 * scdaemon has two paths to the device; which one works depends on the macOS
 * version and on whether the system smartcard driver is enabled.
 *
 *  internal — gnupg's own CCID driver on top of libusb.
 *             Requires nothing from the system and no admin rights.
 *  pcsc     — the macOS system smartcard service.
 *             More reliable, but on macOS 14+ it needs the ifd-ccid driver
 *             enabled, which requires an administrator password.
 *
 * They are tried in that order: the one needing no privileges comes first.
 * A test in test/setup.test.js pins this ordering.
 */
const LINKS = {
  internal: [
    'reader-port "Ledger Token"',
    'allow-admin',
    'enable-pinpad-varlen',
  ].join('\n'),

  pcsc: [
    'reader-port "Ledger Token"',
    'allow-admin',
    'enable-pinpad-varlen',
    'disable-ccid',
    'pcsc-shared',
  ].join('\n'),
};

const LINK_ORDER = ['internal', 'pcsc'];

/* ------------------------------------------------------------------ */
/* Locating gpg                                                        */
/* ------------------------------------------------------------------ */

/** Path to gpg inside the app bundle, if it was vendored at build time. */
function bundledGpg(resourcesPath) {
  return resourcesPath ? path.join(resourcesPath, 'gnupg', 'bin', 'gpg') : null;
}

function gpgCandidates(resourcesPath) {
  return [
    bundledGpg(resourcesPath),
    '/opt/homebrew/bin/gpg',
    '/usr/local/bin/gpg',
    '/usr/local/MacGPG2/bin/gpg',
    '/opt/local/bin/gpg',
    'gpg',
  ].filter(Boolean);
}

function run(bin, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/** First working gpg from the candidate list, or null. */
async function findGpg(resourcesPath) {
  for (const candidate of gpgCandidates(resourcesPath)) {
    const res = await run(candidate, ['--version'], 5000);
    if (res.ok) return { path: candidate, bundled: candidate === bundledGpg(resourcesPath) };
  }
  return null;
}

/** Is Homebrew present? If so we can install gpg without user involvement. */
async function findBrew() {
  for (const candidate of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
    const res = await run(candidate, ['--version'], 5000);
    if (res.ok) return candidate;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Installation                                                        */
/* ------------------------------------------------------------------ */

/**
 * Install gpg through Homebrew, streaming progress line by line.
 * No terminal is opened — the process is spawned from inside the app.
 * This runs third-party code with the user's privileges; the output is shown
 * rather than hidden. See SECURITY.md section 5.
 */
function installWithBrew(brew, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    onProgress('Installing. This can take a few minutes…');

    const child = spawn(brew, ['install', 'gnupg', 'pinentry-mac'], {
      env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ANALYTICS: '1' },
    });

    const relay = (chunk) => {
      String(chunk)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach(onProgress);
    };

    child.stdout.on('data', relay);
    child.stderr.on('data', relay);
    child.on('error', (err) => reject(new Error(`Could not start the installation: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('The installation did not complete. Try again, or install GnuPG manually.'));
    });
  });
}

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Write the reader and pinentry configuration.
 * Existing files are never silently clobbered — a copy is kept alongside.
 */
async function writeConfig(link, resourcesPath) {
  await fs.mkdir(GNUPGHOME, { recursive: true, mode: 0o700 });

  const scd = path.join(GNUPGHOME, 'scdaemon.conf');
  await backupOnce(scd);
  await fs.writeFile(scd, `${LINKS[link]}\n`, 'utf8');

  // PIN dialog: without this gpg would try to ask for the PIN on a console,
  // which a GUI app does not have, and the operation would fail silently
  const pinentry = await findPinentry(resourcesPath);
  const agentLines = [];
  if (pinentry) agentLines.push(`pinentry-program ${pinentry}`);

  // When GnuPG travels inside the app, gpg-agent has to be told where its
  // scdaemon is: the bundled binaries were built for /opt/homebrew and that
  // path does not exist on the user's Mac. Without this the card is invisible
  // even though everything else works.
  const bundled = bundledGpg(resourcesPath);
  const usingBundled = bundled && (await run(bundled, ['--version'], 5000)).ok;
  if (usingBundled) {
    const scdaemon = path.join(path.dirname(bundled), 'scdaemon');
    if (await exists(scdaemon)) agentLines.push(`scdaemon-program ${scdaemon}`);

    const agentBinary = path.join(path.dirname(bundled), 'gpg-agent');
    if (await exists(agentBinary)) {
      const gpgConf = path.join(GNUPGHOME, 'gpg.conf');
      await backupOnce(gpgConf);
      await fs.writeFile(gpgConf, `agent-program ${agentBinary}\n`, 'utf8');
    }
  }

  if (agentLines.length) {
    const agent = path.join(GNUPGHOME, 'gpg-agent.conf');
    await backupOnce(agent);
    await fs.writeFile(agent, `${agentLines.join('\n')}\n`, 'utf8');
  }

  return { link, pinentry, bundled: Boolean(usingBundled) };
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function backupOnce(file) {
  try {
    await fs.access(file);
    await fs.access(`${file}.sealbox-backup`);
  } catch (err) {
    // only copy when the file exists and no backup has been made yet
    if (err.code === 'ENOENT') {
      try {
        await fs.copyFile(file, `${file}.sealbox-backup`);
      } catch { /* the file did not exist — nothing to copy */ }
    }
  }
}

async function findPinentry(resourcesPath) {
  const candidates = [
    resourcesPath ? path.join(resourcesPath, 'gnupg', 'bin', 'pinentry-mac') : null,
    '/opt/homebrew/bin/pinentry-mac',
    '/usr/local/bin/pinentry-mac',
    '/opt/homebrew/bin/pinentry',
    '/usr/local/bin/pinentry',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch { /* try the next candidate */ }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* System smartcard driver                                             */
/* ------------------------------------------------------------------ */

const DRIVER_KEY = '/Library/Preferences/com.apple.security.smartcard';

async function driverEnabled() {
  const res = await run('defaults', ['read', DRIVER_KEY, 'useIFDCCID'], 5000);
  return res.ok && res.stdout.trim() === '1';
}

/**
 * Enable the system smartcard driver. This shows the standard macOS
 * authentication dialog — the same one any installer shows. No terminal.
 *
 * It writes exactly one boolean to one system preference: the flag that
 * enables Apple's bundled CCID driver. Reached only after the non-privileged
 * path has failed, and the user can decline.
 */
async function enableDriver() {
  const script =
    'do shell script "defaults write /Library/Preferences/com.apple.security.smartcard useIFDCCID -bool yes" ' +
    'with administrator privileges';

  const res = await run('osascript', ['-e', script], 120000);
  if (!res.ok) {
    if (/User cancell?ed/i.test(res.stderr)) throw new Error('Cancelled');
    throw new Error('Could not enable the smartcard driver');
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Overall picture                                                     */
/* ------------------------------------------------------------------ */

/**
 * What is already in place and what is not.
 * @returns {Promise<{gpg: object|null, brew: string|null, configured: string|null, driver: boolean}>}
 */
async function status(resourcesPath) {
  const [gpg, brew, driver] = await Promise.all([
    findGpg(resourcesPath),
    findBrew(),
    driverEnabled(),
  ]);

  let configured = null;
  try {
    const text = await fs.readFile(path.join(GNUPGHOME, 'scdaemon.conf'), 'utf8');
    configured = text.includes('disable-ccid') ? 'pcsc' : 'internal';
  } catch { /* no config yet */ }

  return { gpg, brew, configured, driver };
}

/**
 * Bring the environment to a working state: install and configure.
 * The system driver is deliberately not touched here — it needs a password,
 * and asking for one is only justified once we know it is actually required.
 */
async function prepare(resourcesPath, onProgress = () => {}) {
  let gpg = await findGpg(resourcesPath);

  if (!gpg) {
    const brew = await findBrew();
    if (!brew) {
      const err = new Error('needs-manual-install');
      err.code = 'NEEDS_MANUAL_INSTALL';
      throw err;
    }
    await installWithBrew(brew, onProgress);
    gpg = await findGpg(resourcesPath);
    if (!gpg) throw new Error('GnuPG was installed but cannot be found. Restart the app.');
  } else if (gpg.bundled) {
    onProgress('GnuPG is bundled with the app — nothing to install');
  } else {
    onProgress('GnuPG is already installed');
  }

  onProgress('Configuring the device connection…');
  await writeConfig(LINK_ORDER[0], resourcesPath);

  return { gpg };
}

/**
 * The device is not answering — try the second communication method.
 * Returns the name of the method switched to, or null when the options are
 * exhausted and only the system driver is left.
 */
async function tryNextLink(resourcesPath) {
  const { configured } = await status(resourcesPath);
  const index = LINK_ORDER.indexOf(configured);
  const next = LINK_ORDER[index + 1];
  if (!next) return null;

  await writeConfig(next, resourcesPath);
  return next;
}

module.exports = {
  status, prepare, writeConfig, tryNextLink,
  findGpg, findBrew, findPinentry,
  driverEnabled, enableDriver,
  GNUPGHOME, LINKS, LINK_ORDER,
};
