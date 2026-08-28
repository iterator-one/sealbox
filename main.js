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
  win.once('ready-to-show', () => win.show());
}

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

  return {
    gpg: env.gpg,
    version: env.version,
    card: env.card,
    device: state,
    ledgerLive: facts.ledgerLive,
    keys: list,
    myKey: mine,
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
      const e = new Error('No way to install GnuPG automatically was found.');
      e.manual = true;
      throw e;
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

handle('shell:reveal', async (filePath) => { shell.showItemInFolder(filePath); return true; });
handle('shell:trash', async (filePath) => { await shell.trashItem(filePath); return true; });

handle('dialog:open', async (kind) => {
  const filters = kind === 'key'
    ? [{ name: 'OpenPGP public key', extensions: ['asc', 'gpg', 'pgp', 'key', 'txt'] }]
    : [];
  const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  return res.canceled ? null : res.filePaths[0];
});
