'use strict';
/*
 * Sealbox — interface logic.
 *
 * The layout lives in index.html and styles.css; this file only decides which
 * screen is visible and what it says. Every screen is a <section class="screen">
 * and exactly one of them carries .is-active at any time.
 *
 * NOT `const api`: preload.js exposes a global `window.api`, and a top-level
 * const of the same name collides with that non-configurable global property.
 * Electron then fails to parse this whole file and nothing runs at all, while a
 * browser preview (where window.api is absent) works fine — which is exactly how
 * that bug survived until the app was launched for real.
 */

const bridge = window.api || demoApi();

const $ = (id) => document.getElementById(id);
const on = (id, event, fn) => { const el = $(id); if (el) el.addEventListener(event, fn); };

const state = {
  screen: 'screen-drop',
  env: null,          // last status from the main process
  file: null,         // the file being encrypted or decrypted
  keys: [],           // public keys we can encrypt to
  selected: new Set(),
  pendingKey: null,   // a public key file waiting to be confirmed
  result: null,       // { outputPath, sourcePath, kind }
  setupStep: 0,
  seedAcknowledged: false,
  recovery: null,
  waitTimer: null,
  afterDevice: null,  // what to run once the device becomes ready
};

/* ---------- screens ---------- */

function show(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('is-active', el.id === id));
  state.screen = id;
  hideNotice();
}

function notice(line1, line2) {
  $('notice-1').textContent = line1;
  const second = $('notice-2');
  second.textContent = line2 || '';
  second.hidden = !line2;
  $('notice').hidden = false;
}
function hideNotice() { $('notice').hidden = true; }

/* ---------- small helpers ---------- */

function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// The file pill: icon, name, a dot, and the size. The dot and size are dropped
// when there is no size to show, exactly as in the design.
function fillPill(el, name, size) {
  el.textContent = '';
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'icon');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-file');
  icon.appendChild(use);
  el.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'name';
  label.textContent = name;
  el.appendChild(label);

  if (size) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    el.appendChild(dot);
    const s = document.createElement('span');
    s.textContent = size;
    el.appendChild(s);
  }
}

function setProgress(id, filled, total) {
  const bar = $(id);
  if (!bar) return;
  bar.textContent = '';
  for (let i = 0; i < total; i += 1) {
    const seg = document.createElement('span');
    if (i < filled) {
      seg.className = i === filled - 1 && filled < total ? 'on last' : 'on';
    }
    bar.appendChild(seg);
  }
}

function icon(el, name) {
  el.innerHTML = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  el.appendChild(svg);
}

/* ---------- device status ---------- */

// The wording for every device state and setup step lives in copy.js, so a
// test can check that no state is left without something to say.
const COPY = (window.SEALBOX_COPY || require('./copy.js'));
const DEVICE_ROWS = COPY.DEVICE_ROWS;

function paintLedgerBar(deviceState) {
  const row = DEVICE_ROWS[deviceState] || DEVICE_ROWS.error;
  const chip = $('ledger-chip');
  chip.classList.toggle('ready', Boolean(row.ready));
  icon(chip, row.icon);
  $('ledger-title').textContent = row.title;
  const sub = $('ledger-sub');
  sub.textContent = row.sub || '';
  sub.hidden = !row.sub;
  const action = $('ledger-action');
  action.hidden = !row.action;
  action.textContent = row.action || '';
  action.className = row.secondary ? 'btn secondary' : 'btn primary';
}

async function refreshStatus() {
  const res = await bridge.status();
  if (!res || !res.ok) return null;
  state.env = res.value;
  state.keys = res.value.keys || [];
  paintLedgerBar(res.value.device);
  return res.value;
}

const DEVICE_SCREEN = COPY.DEVICE_SCREEN;

function paintDeviceScreen(deviceState) {
  const row = DEVICE_SCREEN[deviceState] || DEVICE_SCREEN.error;
  fillPill($('device-file'), state.file.name, humanSize(state.file.size));
  $('device-title').textContent = row.title;
  const sub = $('device-sub');
  sub.textContent = row.sub || '';
  sub.hidden = !row.sub;
  $('device-status-text').textContent = row.status;
  $('device-ring').hidden = Boolean(row.ready);
  $('device-check').hidden = !row.ready;
  $('device-status').classList.toggle('done', Boolean(row.ready));
  // Waiting is fine when the fix is physical — plug it in, open the app. When
  // the machine itself is not ready there is nothing to wait for, so offer the
  // guide instead of leaving a spinner running forever.
  $('device-setup').hidden = deviceState !== 'no-gpg';
  show('screen-device');
  if (row.note) notice(row.note, row.note2);
}

/* Wait for the device, then run `next`. Polls, because a Ledger appears and
   disappears without telling anyone. */
function waitForDevice(next) {
  state.afterDevice = next;
  const tick = async () => {
    const env = await refreshStatus();
    if (!env) return;
    if (env.device === 'ready') {
      stopWaiting();
      const run = state.afterDevice;
      state.afterDevice = null;
      if (run) run();
      return;
    }
    if (state.screen === 'screen-device') paintDeviceScreen(env.device);
  };
  paintDeviceScreen(state.env ? state.env.device : 'disconnected');
  stopWaiting();
  state.waitTimer = setInterval(tick, 1500);
}
function stopWaiting() { if (state.waitTimer) { clearInterval(state.waitTimer); state.waitTimer = null; } }

/* ---------- the main flow ---------- */

async function accept(filePath) {
  hideNotice();
  const res = await bridge.inspect(filePath);
  if (!res.ok) return notice('Sealbox could not read this file', res.error);
  const info = res.value;
  state.file = { path: filePath, name: info.name, size: info.size, encryption: info.encryption, keyIds: info.keyIds };

  if (info.isDirectory) return notice('Folders are not supported yet', 'Compress it into an archive first');

  if (info.encryption === 'password') {
    return notice('This file is protected by a password', 'Sealbox opens files locked with a Ledger only');
  }
  if (info.encryption === 'publicKey') return startDecrypt();
  return startEncrypt();
}

/* ---------- encrypting ---------- */

async function startEncrypt() {
  const env = await refreshStatus();
  if (!env) return;
  if (!state.keys.length) {
    fillPill($('nokeys-file'), state.file.name, humanSize(state.file.size));
    return show('screen-nokeys');
  }
  state.selected = new Set(state.keys.filter((k) => k.mine).map((k) => k.id));
  if (!state.selected.size) state.selected.add(state.keys[0].id);
  paintKeyList();
  show('screen-keys');
}

function paintKeyList() {
  fillPill($('keys-file'), state.file.name, humanSize(state.file.size));
  const list = $('keylist');
  list.textContent = '';

  state.keys.forEach((key) => {
    const row = document.createElement('button');
    row.className = 'keyrow' + (state.selected.has(key.id) ? ' is-selected' : '');
    row.dataset.id = key.id;

    const box = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    box.setAttribute('class', 'box');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', state.selected.has(key.id) ? '#i-box-on' : '#i-box-off');
    box.appendChild(use);
    row.appendChild(box);

    const info = document.createElement('span');
    info.className = 'info';
    const line = document.createElement('span');
    line.className = 'line';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = key.name || key.email || key.fingerprint;
    line.appendChild(name);
    if (key.mine || key.isNew) {
      const badge = document.createElement('span');
      badge.className = 'badge ' + (key.mine ? 'mine' : 'new');
      badge.textContent = key.mine ? 'Your key' : 'New';
      line.appendChild(badge);
    }
    info.appendChild(line);
    const mail = document.createElement('span');
    mail.className = 'mail';
    mail.textContent = key.email || key.fingerprint;
    info.appendChild(mail);
    row.appendChild(info);

    row.addEventListener('click', () => {
      if (state.selected.has(key.id)) state.selected.delete(key.id);
      else state.selected.add(key.id);
      paintKeyList();
    });
    list.appendChild(row);
  });

  const count = state.selected.size;
  const button = $('btn-encrypt');
  button.disabled = count === 0;
  button.textContent = count === 1 ? 'Encrypt for 1 key' : `Encrypt for ${count} keys`;
}

function runEncrypt() {
  const recipients = [...state.selected];
  const mine = state.keys.find((k) => k.mine);
  // Signing is what routes the operation through the device. Without a key of
  // our own there is nothing to sign with, so we encrypt without a signature
  // and say so on the result screen.
  const signer = mine && mine.onCard ? mine.id : null;

  const run = async () => {
    working('Encrypting file…', '');
    const res = await bridge.encryptTo(state.file.path, recipients, signer);
    if (!res.ok) return failedOperation(res.error);
    state.result = { outputPath: res.value.outputPath, name: res.value.name, kind: 'encrypted', signed: res.value.signed };
    paintDone();
  };

  if (!signer) return run();
  if (state.env && state.env.device === 'ready') return run();
  waitForDevice(run);
}

/* ---------- decrypting ---------- */

function startDecrypt() {
  const run = async () => {
    working('Decrypting file…', 'Follow the prompts on your Ledger.');
    const res = await bridge.decrypt(state.file.path);
    if (!res.ok) return failedOperation(res.error);
    state.result = { outputPath: res.value.outputPath, name: res.value.name, kind: 'decrypted' };
    paintDone();
  };
  if (state.env && state.env.device === 'ready') return run();
  waitForDevice(run);
}

function working(title, sub) {
  fillPill($('working-file'), state.file.name, humanSize(state.file.size));
  $('working-title').textContent = title;
  $('working-sub').textContent = sub || '';
  show('screen-working');
}

// Errors during an operation keep the working screen and add the bar, the way
// the design shows them.
function failedOperation(message) {
  const text = String(message || '');
  if (/cancel/i.test(text)) return notice('The request was cancelled on your Ledger', 'Try again');
  if (/wrong pin|bad pin/i.test(text)) return notice('Wrong PIN', 'Try again');
  if (/no secret key|not available/i.test(text)) return notice('This Ledger can’t decrypt the file', 'Connect a Ledger that holds one of the required keys');
  if (/damaged|unsupported|no valid openpgp/i.test(text)) return notice('The file may be damaged or unsupported', 'Choose another file');
  if (/device|card/i.test(text)) return notice('Reconnect your Ledger to continue.');
  notice(text || 'Something went wrong');
}

function paintDone() {
  const encrypted = state.result.kind === 'encrypted';
  fillPill($('done-file'), state.result.name, '');
  $('done-title').textContent = encrypted ? 'File encrypted' : 'File decrypted';
  const sub = $('done-sub');
  if (encrypted) {
    const n = state.selected.size;
    sub.textContent = `Can be decrypted by ${n} ${n === 1 ? 'key' : 'keys'}`;
  } else {
    sub.textContent = '';
  }
  sub.hidden = !sub.textContent;
  $('btn-trash').textContent = encrypted ? 'Move original to Trash' : 'Move encrypted file to Trash';
  $('done-caption').textContent = encrypted
    ? 'The original file is still on your Mac.'
    : 'The encrypted file is still on your Mac.';
  show('screen-done');
}

/* ---------- importing a public key ---------- */

function openImport() { show('screen-import'); }

async function acceptKeyFile(filePath) {
  const res = await bridge.inspectKey(filePath);
  if (!res.ok) {
    if (res.error === 'unreadable') return notice('Choose a valid OpenPGP public key');
    return notice('This file doesn’t contain an OpenPGP public key');
  }
  const key = res.value;
  if (key.already) return notice(`${key.name || key.email} is already in your public keys`);
  state.pendingKey = { ...key, path: filePath };
  $('review-name').textContent = key.name || '(no name)';
  $('review-mail').textContent = key.email || '';
  $('review-fpr').textContent = key.fingerprintPretty || key.fingerprint;
  show('screen-review');
}

async function addPendingKey() {
  const res = await bridge.addKey(state.pendingKey.path);
  if (!res.ok) return notice('Sealbox could not add this key', res.error);
  await refreshStatus();
  state.pendingKey = null;
  if (state.file && state.file.encryption !== 'publicKey') return startEncrypt();
  show('screen-drop');
}

/* The Details button on the status row. It shows the same card as the last step
   of setup, filled from the key that is actually on the device — so it is
   never an empty form. */
function showKeyDetails() {
  const recovery = state.env && state.env.recovery;
  if (!recovery) return openSetup(1);
  state.recovery = recovery;
  $('rec-time').textContent = recovery.timestamp;
  $('rec-name').textContent = recovery.name || '—';
  $('rec-mail').textContent = recovery.email || '—';
  $('rec-type').textContent = recovery.keyType || '—';
  openSetup(8);
}

/* ---------- setup ---------- */

const SETUP_TOTAL = COPY.SETUP_TOTAL;

function openSetup(step) {
  state.setupStep = step;
  switch (step) {
    case 1:
      show('s-intro');
      break;
    case 2:
      setProgress('p-prepare', 1, SETUP_TOTAL);
      show('s-prepare');
      break;
    case 3:
      setProgress('p-openpgp', 2, SETUP_TOTAL);
      show('s-openpgp');
      break;
    case 4:
      setProgress('p-seed', 3, SETUP_TOTAL);
      show('s-seed');
      break;
    case 5:
      setProgress('p-connect', 4, SETUP_TOTAL);
      show('s-connect');
      pollConnect();
      break;
    case 6:
      setProgress('p-key', 5, SETUP_TOTAL);
      show('s-key');
      break;
    case 7:
      setProgress('p-creating', 6, SETUP_TOTAL);
      show('s-creating');
      break;
    case 8:
      setProgress('p-recovery', 7, SETUP_TOTAL);
      show('s-recovery');
      break;
    case 9:
      show('s-done');
      break;
    default:
      show('screen-drop');
  }
}

async function runPrepare() {
  $('s-prepare-title').textContent = 'Preparing your Mac';
  $('s-prepare-sub').textContent = 'This may take a moment.';
  const button = $('s-prepare-next');
  button.className = 'btn secondary inert';
  button.textContent = 'Preparing…';
  button.disabled = true;
  $('s-prepare-log').hidden = false;

  const res = await bridge.setupPrepare();
  button.disabled = false;
  button.className = 'btn primary';
  button.textContent = 'Prepare Mac';
  if (!res.ok) {
    // A Mac with no package manager is not a fault to apologise for — it is a
    // one-line install the user has to run themselves, so say exactly that
    // instead of showing a failure screen with nothing behind it.
    if (res.error === 'NEEDS_MANUAL_INSTALL') {
      setProgress('p-manual', 1, SETUP_TOTAL);
      return show('s-manual');
    }
    $('s-failed-sub').textContent = 'Something went wrong during setup.';
    $('s-failed-log').textContent = res.error || '';
    $('s-failed-log').hidden = true;
    return show('s-prepare-failed');
  }
  $('s-prepare-title').textContent = 'Mac is ready';
  $('s-prepare-sub').textContent = '';
  $('s-prepare-sub').hidden = true;
  button.className = 'btn primary';
  button.textContent = 'Continue';
  button.onclick = () => openSetup(3);
}

function pollConnect() {
  stopWaiting();
  const paint = (device) => {
    const ready = device === 'ready' || device === 'no-key';
    $('s-connect-ring').hidden = ready;
    $('s-connect-check').hidden = !ready;
    $('s-connect-status').classList.toggle('done', ready);
    $('s-connect-next').hidden = !ready;
    $('s-connect-text').textContent =
      ready ? 'Ledger ready'
        : device === 'closed' ? 'Open OpenPGP on your Ledger'
        : device === 'ledger-live' ? 'Quit Ledger Live'
        : 'Waiting for Ledger…';
    $('s-connect-sub').innerHTML = ready
      ? 'Quit Ledger Live, then connect and unlock your Ledger.<br />Open OpenPGP on your Ledger.'
      : 'Connect and unlock your Ledger, then open OpenPGP.<br />Make sure Ledger Live is closed.';
  };
  paint(state.env ? state.env.device : 'disconnected');
  state.waitTimer = setInterval(async () => {
    const env = await refreshStatus();
    if (env && state.screen === 's-connect') paint(env.device);
  }, 1500);
}

async function createKey() {
  const name = $('s-key-name').value.trim();
  const email = $('s-key-mail').value.trim();
  if (!name || !email) return notice('Enter a name and an email', 'They become part of the key and of its recovery details');
  openSetup(7);
  const res = await bridge.generateKey(name, email);
  if (!res.ok) {
    openSetup(6);
    return notice('The key was not created', res.error);
  }
  state.recovery = res.value.recovery;
  $('s-creating-status').hidden = false;
  setTimeout(() => {
    $('rec-time').textContent = state.recovery.timestamp;
    $('rec-name').textContent = state.recovery.name;
    $('rec-mail').textContent = state.recovery.email;
    $('rec-type').textContent = state.recovery.keyType;
    openSetup(8);
  }, 900);
}

async function saveRecovery() {
  const res = await bridge.saveRecovery(state.recovery);
  if (!res.ok) return notice('Could not save the file', res.error);
  const button = $('s-recovery-next');
  button.className = 'btn secondary inert';
  button.textContent = '✓ Recovery details saved';
  button.onclick = () => openSetup(9);
  setTimeout(() => {
    button.className = 'btn primary';
    button.textContent = 'Continue';
  }, 1200);
}

/* ---------- events ---------- */

function wire() {
  on('win-close', 'click', () => bridge.windowClose());
  on('win-min', 'click', () => bridge.windowMinimise());
  on('notice-x', 'click', hideNotice);

  // Drag and drop, on the whole window: dropping is the app's one gesture.
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (state.screen === 'screen-drop') $('dropzone').classList.add('is-over');
  });
  document.addEventListener('dragleave', () => $('dropzone').classList.remove('is-over'));
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    $('dropzone').classList.remove('is-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const path = bridge.pathForFile(file);
    if (!path) return;
    if (state.screen === 'screen-import') return acceptKeyFile(path);
    if (state.screen === 'screen-drop') return accept(path);
  });

  on('btn-choose', 'click', async () => {
    const res = await bridge.pickFile('any');
    if (res.ok && res.value) accept(res.value);
  });
  on('btn-choose-key', 'click', async () => {
    const res = await bridge.pickFile('key');
    if (res.ok && res.value) acceptKeyFile(res.value);
  });

  ['btn-import-key', 'btn-import-key-2', 'btn-import-key-3'].forEach((id) => on(id, 'click', openImport));
  on('import-back', 'click', () => show(state.file ? 'screen-keys' : 'screen-drop'));
  on('review-back', 'click', openImport);
  on('review-close', 'click', () => show('screen-drop'));
  on('btn-add-key', 'click', addPendingKey);
  on('nokeys-close', 'click', () => show('screen-drop'));
  on('btn-setup-ledger', 'click', () => openSetup(1));

  on('btn-encrypt', 'click', runEncrypt);
  on('device-close', 'click', () => { stopWaiting(); show('screen-drop'); });
  on('device-setup', 'click', () => { stopWaiting(); openSetup(1); });
  on('done-close', 'click', reset);
  on('btn-reveal', 'click', () => bridge.reveal(state.result.outputPath));
  on('btn-trash', 'click', async () => {
    const target = state.result.kind === 'encrypted' ? state.file.path : state.file.path;
    const res = await bridge.trash(target);
    if (!res.ok) return notice('Could not move the file to Trash', res.error);
    $('btn-trash').disabled = true;
    $('done-caption').textContent = 'Moved to Trash.';
  });

  on('ledger-action', 'click', async () => {
    const current = state.env ? state.env.device : null;
    if (current === 'ready') return showKeyDetails();
    if (current === 'no-gpg' || current === 'no-key') return openSetup(1);
    // "Connect", "Check again", "Try again" all mean the same thing: look again.
    paintLedgerBar('checking');
    await refreshStatus();
  });
  on('ledgerbar', 'click', (e) => { if (e.target.id !== 'ledger-action') refreshStatus(); });

  on('s-intro-next', 'click', () => openSetup(2));
  on('s-intro-close', 'click', () => show('screen-drop'));
  on('s-prepare-next', 'click', runPrepare);
  on('s-prepare-close', 'click', () => show('screen-drop'));
  on('s-failed-retry', 'click', () => openSetup(2));
  on('s-manual-close', 'click', () => show('screen-drop'));
  on('s-manual-copy', 'click', () => bridge.copyText($('s-manual-cmd').textContent.trim()));
  on('s-manual-site', 'click', () => bridge.openLink('homebrew'));
  on('s-manual-terminal', 'click', async () => {
    // Copy first, then bring Terminal up: the user only has to paste.
    await bridge.copyText($('s-manual-cmd').textContent.trim());
    const res = await bridge.openTerminal();
    const button = $('s-manual-terminal');
    button.textContent = res && res.ok ? 'Copied — paste it in Terminal' : 'Copied to the clipboard';
    setTimeout(() => { button.textContent = 'Open Terminal'; }, 4000);
  });
  on('s-failed-details', 'click', () => { $('s-failed-log').hidden = !$('s-failed-log').hidden; });
  on('s-openpgp-back', 'click', () => openSetup(2));
  on('s-openpgp-close', 'click', () => show('screen-drop'));
  on('s-openpgp-next', 'click', () => openSetup(4));
  on('s-seed-back', 'click', () => openSetup(3));
  on('s-seed-close', 'click', () => show('screen-drop'));
  on('s-seed-consent', 'click', () => {
    state.seedAcknowledged = !state.seedAcknowledged;
    $('s-seed-box').setAttribute('href', state.seedAcknowledged ? '#i-box-on' : '#i-box-off');
    $('s-seed-next').disabled = !state.seedAcknowledged;
  });
  on('s-seed-next', 'click', () => openSetup(5));
  on('s-connect-back', 'click', () => { stopWaiting(); openSetup(4); });
  on('s-connect-close', 'click', () => { stopWaiting(); show('screen-drop'); });
  on('s-connect-next', 'click', () => { stopWaiting(); openSetup(6); });
  on('s-key-back', 'click', () => openSetup(5));
  on('s-key-close', 'click', () => show('screen-drop'));
  on('s-key-next', 'click', createKey);
  on('s-recovery-close', 'click', () => openSetup(9));
  on('s-recovery-copy', 'click', () => bridge.copyText(recoveryText()));
  on('s-recovery-next', 'click', saveRecovery);
  on('s-done-next', 'click', () => { refreshStatus(); show('screen-drop'); });
}

function recoveryText() {
  const r = state.recovery || {};
  return `Timestamp: ${r.timestamp}\nName: ${r.name}\nEmail: ${r.email}\nKey type: ${r.keyType}`;
}

function reset() {
  state.file = null;
  state.result = null;
  state.selected = new Set();
  stopWaiting();
  show('screen-drop');
  refreshStatus();
}

/* ---------- start ---------- */

(async function start() {
  wire();
  // Show the drop screen immediately. Probing the environment can take a couple
  // of seconds on a machine with no GnuPG, and the window used to stay blank
  // for the whole of it.
  paintLedgerBar('checking');
  show('screen-drop');
  await refreshStatus();
  if (state.env && state.env.device === 'no-gpg' && !state.keys.length) {
    // Nothing is set up at all: offer the guide instead of an empty window.
    openSetup(1);
  }
})();

/* ---------- demo bridge ---------- */

// preview.html runs this file in a browser, where window.api does not exist.
// The demo bridge lets a reviewer or designer walk every screen without a Mac,
// GnuPG or a device.
function demoApi() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (value) => ({ ok: true, value });
  return {
    pathForFile: (f) => `/demo/${f.name}`,
    status: async () => ok({
      gpg: '/usr/local/bin/gpg',
      device: 'ready',
      appVersion: '1.1.0',
      keys: [
        { id: 'E4C302BC8672419D', fingerprint: 'E4C302BC8672419D', name: 'Boris Zozulya', email: 'boris@example.com', mine: true, onCard: true },
        { id: 'AA11BB22CC33DD44', fingerprint: 'AA11BB22CC33DD44', name: 'Alex Morgan', email: 'alex@example.com', isNew: true },
        { id: 'FF99EE88DD77CC66', fingerprint: 'FF99EE88DD77CC66', name: 'John Smith', email: 'john@example.com' },
      ],
      recovery: { timestamp: '19990101T000000!', name: 'Boris', email: 'boris@example.com', keyType: 'ed25519 / rsa2048' },
    }),
    inspect: async () => ok({ name: 'contract.pdf', size: 2516582, encryption: 'unknown', keyIds: [], isDirectory: false }),
    inspectKey: async () => ok({ name: 'Alex Morgan', email: 'alex@example.com', fingerprint: 'E4C302BC8672419D', fingerprintPretty: 'E4C3 02BC 8672 419D', already: false }),
    addKey: async () => ok({}),
    encryptTo: async () => { await wait(1200); return ok({ outputPath: '/demo/contract.pdf.gpg', name: 'contract.pdf.gpg', signed: true }); },
    decrypt: async () => { await wait(1200); return ok({ outputPath: '/demo/contract.pdf', name: 'contract.pdf' }); },
    generateKey: async () => { await wait(1500); return ok({ recovery: { timestamp: '19990101T000000!', name: 'Boris', email: 'boris@example.com', keyType: 'ed25519 / rsa2048' } }); },
    saveRecovery: async () => ok('/demo/recovery.txt'),
    setupPrepare: async () => { await wait(1200); return ok({}); },
    copyText: async () => ok({}),
    reveal: async () => ok({}),
    trash: async () => ok({}),
    // In the preview, picking a file always "works" so a reviewer can walk the
    // whole flow with the mouse.
    pickFile: async (kind) => ok(kind === 'key' ? '/demo/alex-public.asc' : '/demo/contract.pdf'),
    openLink: async () => ok({}),
    openTerminal: async () => ok({}),
    windowClose: () => {},
    windowMinimise: () => {},
  };
}
