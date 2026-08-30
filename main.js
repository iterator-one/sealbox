'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const inspector = require('./src/crypto/inspect');
const gpg = require('./src/crypto/gpg');
const card = require('./src/crypto/cardkey');
const setup = require('./src/setup/bootstrap');
const keys = require('./src/crypto/keys');
const device = require('./src/device/state');
const { encryptedPath, decryptedPath } = require('./src/paths');

// Read straight from package.json: app.getVersion() returns Electron's own
// version when the app is started with `electron .` during development.
const APP_VERSION = require('./package.json').version;

let win = null;

function createWindow() {
  // 520x640 with no native frame: the design draws its own title bar, traffic
  // lights and 32px rounded corners, so the window has to be transparent and
  // frameless or macOS would paint a second set of controls over them.
  win = new BrowserWindow({
    width: 520,
    height: 640,
    resizable: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Surface renderer errors in the terminal. Without this a script-level
  // failure leaves a silent blank window and nothing anywhere explains why.
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`[renderer] ${message} (${source}:${line})`);
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    win.show();
    if (pendingFile) offerFile(pendingFile);
  });
}

// A .gpg file double-clicked in Finder, or dropped on the app icon. macOS
// delivers it through open-file, which can fire before the window exists, so it
// is held until the renderer is ready to be told.
let pendingFile = null;
function offerFile(filePath) {
  pendingFile = filePath;
  if (win && !win.isDestroyed()) {
    win.webContents.send('file:opened', filePath);
    win.show();
    win.focus();
    pendingFile = null;
  }
}
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  offerFile(filePath);
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ================================================================== */
/* IPC: every handler returns {ok, value} or {ok: false, error}         */
/* Each channel here is reachable from the renderer — see preload.js.   */
/* ================================================================== */

const handle = (channel, fn) =>
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

/**
 * The account's full name, used to prefill the key's user id. `id -F` is the
 * macOS way to ask; everywhere else fall back to the login name. Nothing is
 * sent anywhere — it only saves the user typing their own name.
 */
async function fullName() {
  if (process.platform === 'darwin') {
    const out = await new Promise((resolve) => {
      require('child_process').execFile('id', ['-F'], { timeout: 3000 }, (err, stdout) =>
        resolve(err ? '' : (stdout || '').trim()));
    });
    if (out) return out;
  }
  try { return require('os').userInfo().username || ''; } catch { return ''; }
}

/** Environment status plus the user's own on-device key. */
handle('env:status', async () => {
  const [env, facts] = await Promise.all([gpg.status(), device.observe()]);
  const mine = env.keys.find((k) => k.onCard) || null;

  const state = device.decide({
    hasGpg: Boolean(env.gpg),
    cardPresent: Boolean(env.card),
    cardHasKey: Boolean(env.card && env.card.keyFingerprints.some((f) => f && /[^0]/.test(f))),
    onUsb: facts.onUsb,
    ledgerLive: facts.ledgerLive,
  });

  // The renderer gets one flat list; `mine` marks the key whose private half is
  // on the connected device, which is the one Sealbox can sign and decrypt with.
  const list = env.keys.map((k) => {
    const uid = keys.splitUid(k.uids[0] || '');
    return {
      id: k.fingerprint || k.keyId,
      fingerprint: k.fingerprint || k.keyId,
      fingerprintPretty: keys.prettyFingerprint(k.fingerprint || k.keyId),
      name: uid.name,
      email: uid.email,
      onCard: k.onCard,
      mine: k.onCard,
    };
  });

  // The recovery details of the key that is on the device. The timestamp is not
  // read from the key: Sealbox always generates with the same fixed one, and it
  // is that value — not the key's own creation date — that has to be typed back
  // in to regenerate it.
  const mineUid = mine ? keys.splitUid(mine.uids[0] || '') : null;
  const recovery = mine
    ? {
        timestamp: card.FAKED_TIME,
        name: mineUid.name,
        email: mineUid.email,
        keyType: mine.algo || 'ed25519 / rsa2048',
      }
    : null;

  return {
    suggestedName: await fullName(),
    gpg: env.gpg,
    version: env.version,
    card: env.card,
    device: state,
    ledgerLive: facts.ledgerLive,
    keys: list,
    myKey: mine,
    recovery,
    appVersion: APP_VERSION,
  };
});

/* ---------- on-device key generation ---------- */

handle('card:generate', async (identity) => {
  const result = await card.generateOnCard(identity, (line) => {
    if (win && !win.isDestroyed()) win.webContents.send('card:progress', line);
  });
  return result;
});

handle('card:saveRecovery', async (recovery) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Save the recovery card',
    defaultPath: path.join(app.getPath('documents'), 'sealbox-recovery.txt'),
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  if (res.canceled) return null;
  await fs.writeFile(res.filePath, card.recoveryCard(recovery), 'utf8');
  return res.filePath;
});

/* ---------- files ---------- */

handle('file:inspect', async (filePath) => {
  const stat = await fs.stat(filePath);
  const looksEncrypted = /\.(gpg|pgp|asc)$/i.test(filePath);
  const info = looksEncrypted ? await inspector.inspect(filePath) : { kind: 'none', keyIds: [] };

  return {
    path: filePath,
    name: path.basename(filePath),
    size: stat.size,
    isDirectory: stat.isDirectory(),
    encryption: info.kind,
    keyIds: info.keyIds,
  };
});

/**
 * Encrypt to a key. When the key is on the device the file is signed with it
 * too, which is what routes the operation physically through the Ledger:
 * PIN, and a button press when UIF is enabled.
 */
handle('encrypt:keys', async ({ filePath, recipientIds, signerId }) => {
  const out = encryptedPath(filePath);
  await gpg.signEncryptToKeys(filePath, out, recipientIds, signerId);
  return { outputPath: out, name: path.basename(out), signed: Boolean(signerId) };
});

handle('decrypt:card', async ({ filePath }) => {
  const out = decryptedPath(filePath, null);
  await gpg.decryptWithCard(filePath, out);
  return { outputPath: out, name: path.basename(out) };
});

/* ---------- environment preparation (no terminal) ---------- */

/** Install and configure everything needed; progress is streamed to the UI. */
handle('setup:prepare', async () => {
  try {
    return await setup.prepare(process.resourcesPath, (line) => {
      if (win && !win.isDestroyed()) win.webContents.send('setup:progress', line);
    });
  } catch (err) {
    if (err.code === 'NEEDS_MANUAL_INSTALL') {
      // Not a failure to report as a fault: the Mac simply has no package
      // manager Sealbox could drive. The renderer shows the manual route.
      throw new Error('NEEDS_MANUAL_INSTALL');
    }
    throw err;
  }
});

/** Device not answering — switch to the other communication method. */
handle('setup:retryLink', async () => {
  const next = await setup.tryNextLink(process.resourcesPath);
  await gpg.reset();
  return next;
});

/** Enable the system driver: standard macOS authentication dialog. */
handle('setup:enableDriver', async () => setup.enableDriver());

/* ---------- system ---------- */

/* ---------- public keys ---------- */

handle('keys:inspect', async (filePath) => {
  const bin = await gpg.findGpg();
  if (!bin) throw new Error('GnuPG not found');

  const res = await keys.inspectKeyFile(bin, filePath);
  if (res.error) throw new Error(res.error);

  const known = await gpg.listKeys(bin);
  const already = known.some((k) => (k.fingerprint || k.keyId) === res.key.fingerprint);
  return { ...res.key, already };
});

handle('keys:import', async (filePath) => {
  const bin = await gpg.findGpg();
  if (!bin) throw new Error('GnuPG not found');
  const res = await keys.importKeyFile(bin, filePath);
  if (res.error) throw new Error(res.error);
  return true;
});

/* ---------- window and clipboard ---------- */

handle('window:close', async () => { if (win) win.close(); return true; });
handle('window:minimise', async () => { if (win) win.minimize(); return true; });
handle('clipboard:write', async (text) => { clipboard.writeText(String(text)); return true; });

/**
 * Open one of a fixed set of pages in the browser. The renderer passes a name,
 * never a URL, so nothing it could be tricked into saying can turn into an
 * arbitrary link.
 */
const LINKS_OUT = {
  homebrew: 'https://brew.sh',
  gnupg: 'https://gnupg.org/download/',
  // Ledger Live's own URL scheme. These open a screen inside it; they cannot
  // change a setting or install anything by themselves — the user still does
  // that, in Ledger Live, where such decisions belong.
  'ledger-experimental': 'ledgerlive://settings/experimental',
  'ledger-openpgp': 'ledgerlive://myledger?installApp=OpenPGP',
  'ledger-live': 'https://www.ledger.com/ledger-live',
};
handle('shell:open', async (name) => {
  const url = LINKS_OUT[name];
  if (!url) throw new Error('unknown link');
  await shell.openExternal(url);
  return true;
});

/**
 * Quit Ledger Live. It holds the device open, so nothing else can talk to the
 * card while it runs. This is the standard AppleScript quit — the same thing
 * as choosing Quit in its menu, so unsaved work is not discarded behind
 * anyone's back — and it runs only when the user presses the button.
 */
handle('ledger:quitLive', async () => {
  if (process.platform !== 'darwin') return false;
  await new Promise((resolve) => {
    require('child_process').execFile(
      'osascript', ['-e', 'tell application "Ledger Live" to quit'], { timeout: 15000 }, () => resolve()
    );
  });
  return true;
});

/** Bring up Terminal so the install command can be pasted into it. */
handle('shell:terminal', async () => {
  if (process.platform !== 'darwin') return false;
  await new Promise((resolve, reject) => {
    require('child_process').execFile('open', ['-a', 'Terminal'], (err) => (err ? reject(err) : resolve()));
  });
  return true;
});

handle('shell:reveal', async (filePath) => { shell.showItemInFolder(filePath); return true; });
handle('shell:trash', async (filePath) => { await shell.trashItem(filePath); return true; });

handle('dialog:open', async (kind) => {
  const filters = kind === 'key'
    ? [{ name: 'OpenPGP public key', extensions: ['asc', 'gpg', 'pgp', 'key', 'txt'] }]
    : [];
  const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  return res.canceled ? null : res.filePaths[0];
});
