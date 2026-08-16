'use strict';

/* ==================================================================
   Sealbox UI.

   One protection mechanism: the key inside the Ledger. No passwords and
   no choices — the user drops a file and presses one button.

   On first launch a step-by-step setup is shown. Every step the app can
   verify itself, it does verify — the user is never waved through blindly.

   There is no cryptography and no disk access in this file: only calls to
   window.api. When api is absent (opened in a browser) a demo mode kicks in,
   which is how preview.html works.
   ================================================================== */

const $ = (id) => document.getElementById(id);
// NOT `const api`: preload.js exposes a global `window.api`, and a top-level
// const of the same name collides with that non-configurable global property.
// Electron then fails to parse this whole file and nothing runs at all, while
// a browser preview (where window.api is absent) works fine — which is exactly
// how the bug survived until the app was launched for real.
const bridge = window.api || demoApi();

const state = { file: null, env: null, recovery: null, result: null, source: null, step: 0 };
let poll = null;

/* ───────────────────────── navigation ───────────────────────── */

/** Window title per screen. */
const HEADERS = {
  'screen-guide':   { title: 'Setup' },
  'screen-drop':    { title: 'Sealbox' },
  'screen-newkey':  { title: 'New key', back: true },
  'screen-keybusy': { title: 'Creating key' },
  'screen-keydone': { title: 'Key ready' },
  'screen-encrypt': { title: 'Lock file', back: true },
  'screen-decrypt': { title: 'Open file', back: true },
  'screen-busy':    { title: 'Working' },
  'screen-done':    { title: 'Done' },
  'screen-error':   { title: 'Error' },
};

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('is-active', s.id === id));
  const header = HEADERS[id] || { title: 'Sealbox' };
  $('header-title').textContent = header.title;
  $('btn-header-back').hidden = !header.back;
  if (poll) { clearInterval(poll); poll = null; }
}

function reset() {
  state.file = null;
  state.result = null;
  state.source = null;
  show('screen-drop');
  refreshEnv().then(renderStatusline);
  poll = setInterval(() => refreshEnv().then(renderStatusline), 3000);
}

document.querySelectorAll('[data-action="reset"]').forEach((b) => b.addEventListener('click', reset));
$('btn-header-back').addEventListener('click', reset);

function fail(title, text, tip) {
  $('err-title').textContent = title;
  $('err-text').textContent = text;
  $('err-tip').hidden = !tip;
  if (tip) $('err-tip').textContent = tip.replace(/<\/?b>/g, '');
  show('screen-error');
}

const humanSize = (b) =>
  b < 1024 ? `${b} bytes`
  : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB`
  : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB`
  : `${(b / 1024 ** 3).toFixed(2)} GB`;

const shortFpr = (f) => (!f ? '' : f.slice(-16).replace(/(.{4})/g, '$1 ').trim());

/* ───────────────────────── system state ───────────────────────── */

async function refreshEnv() {
  const res = await bridge.status();
  state.env = res.ok ? res.value : { gpg: null, card: null, keys: [], myKey: null };
  return state.env;
}

const hasGpg = () => Boolean(state.env && state.env.gpg);
const deviceOn = () => Boolean(state.env && state.env.card && state.env.card.serial);
const hasKey = () => Boolean(state.env && state.env.myKey);

function renderStatusline() {
  const el = $('statusline');
  const ready = hasGpg() && deviceOn();
  el.className = `status-row clickable ${ready ? 'ok' : 'waiting'}`;
  el.lastElementChild.textContent = !hasGpg()
    ? 'Setup needed — click here'
    : !deviceOn()
      ? 'Ledger not connected — click here'
      : hasKey() ? 'Ledger connected, key in place' : 'Ledger connected, no key yet';
}

// the status line is clickable — it opens the guide at the relevant step
$('statusline').addEventListener('click', () => openGuide(hasGpg() ? 4 : 1));

/* ═══════════════════ setup guide ═══════════════════ */

const GUIDE = [
  {
    title: 'Encrypt any file',
    lead: 'Sealbox locks a file so only you can open it, with your Ledger in hand.',
    note: 'Setup is four short steps, once.',
  },
  {
    title: 'Preparation',
    lead: 'The app installs and configures everything itself.',
    action: {
      label: 'Prepare',
      busy: 'Working…',
      run: async () => {
        const res = await bridge.setupPrepare();
        if (!res.ok) throw new Error(res.error);
        await refreshEnv();
      },
    },
    check: () => hasGpg(),
    checkText: { ok: 'Ready', wait: 'Press “Prepare”' },
  },
  {
    title: 'The app on your Ledger',
    lead: 'Install the OpenPGP app onto the device.',
    steps: [
      { text: 'Ledger Live → gear icon → Experimental features' },
      { text: 'Turn on Developer mode' },
      { text: 'My Ledger → find OpenPGP → Install' },
    ],
    note: 'If two apps are listed, pick OpenPGP without the “.XL”.',
  },
  {
    title: 'Seed mode',
    lead: 'Without it the key cannot be restored after a Ledger update.',
    steps: [
      { text: 'Quit Ledger Live' },
      { text: 'Open OpenPGP on the device' },
      { text: 'Settings → Seed mode → on' },
    ],
  },
  {
    title: 'Connection check',
    lead: 'Leave OpenPGP open on the device screen. The dot turns green by itself.',
    check: () => deviceOn(),
    checkText: { ok: 'Device connected', wait: 'Looking for the device…' },
    fix: {
      label: 'Device not found',
      run: async () => {
        const next = await bridge.setupRetryLink();
        if (next.ok && next.value) return 'Trying the other connection method, hold on';

        const res = await bridge.setupEnableDriver();
        if (!res.ok) throw new Error(res.error);
        return 'Driver enabled. Restart your computer';
      },
    },
  },
];

/** @param {number} from index of the step to open at */
function openGuide(from = 0) {
  state.step = from;
  renderGuide();
  show('screen-guide');
  poll = setInterval(async () => { await refreshEnv(); renderCheck(); }, 2000);
}

function renderGuide() {
  const step = GUIDE[state.step];

  $('guide-dots').innerHTML = GUIDE
    .map((_, i) => `<i class="${i < state.step ? 'done' : i === state.step ? 'now' : ''}"></i>`)
    .join('');

  $('guide-title').textContent = step.title;
  $('guide-lead').textContent = step.lead;

  // numbered step row
  $('guide-steps').innerHTML = (step.steps || [])
    .map((s, i) => `
      <div class="step-row">
        <span class="step-num">${i + 1}</span>
        <div class="step-text">
          <div class="step-title">${s.text}</div>
          ${s.sub ? `<div class="step-sub">${s.sub}</div>` : ''}
        </div>
      </div>`)
    .join('');
  $('guide-steps').hidden = !(step.steps || []).length;

  $('guide-note').hidden = !step.note;
  if (step.note) $('guide-note').textContent = step.note;

  const action = $('btn-guide-action');
  action.hidden = !step.action;
  action.disabled = false;
  if (step.action) action.textContent = step.action.label;

  $('guide-log').hidden = true;
  $('guide-log').textContent = '';

  const fix = $('btn-guide-fix');
  fix.hidden = !step.fix;
  if (step.fix) fix.textContent = step.fix.label;

  $('btn-guide-back').textContent = state.step === 0 ? 'Skip' : 'Back';
  $('btn-guide-next').textContent = state.step === GUIDE.length - 1 ? 'Finish' : 'Next';

  renderCheck();
}

function renderCheck() {
  const step = GUIDE[state.step];
  const box = $('guide-check');
  if (!step || !step.check) { box.hidden = true; $('btn-guide-next').disabled = false; return; }

  const ok = step.check();
  box.hidden = false;
  box.className = `status-row ${ok ? 'ok' : 'waiting'}`;
  $('guide-check-text').textContent = ok ? step.checkText.ok : step.checkText.wait;
  $('btn-guide-next').disabled = !ok;

  // hide the action button once the step is satisfied
  const action = $('btn-guide-action');
  if (step.action) action.hidden = ok;
  if (step.fix) $('btn-guide-fix').hidden = ok;
}

$('btn-guide-action').addEventListener('click', async () => {
  const step = GUIDE[state.step];
  if (!step.action) return;

  const button = $('btn-guide-action');
  button.disabled = true;
  button.textContent = step.action.busy || 'Working…';

  // while work is in progress show this, not “press Prepare”
  const box = $('guide-check');
  box.hidden = false;
  box.className = 'status-row waiting';
  $('guide-check-text').textContent = 'Installing, please wait…';

  const log = $('guide-log');
  log.hidden = false;
  log.textContent = '';
  const stop = bridge.onSetupProgress((line) => {
    log.textContent += `${line}\n`;
    log.scrollTop = log.scrollHeight;
  });

  try {
    await step.action.run();
    renderCheck();
  } catch (err) {
    log.textContent += `\n${err.message}\n`;
    button.disabled = false;
    button.textContent = 'Try again';
  } finally {
    stop();
  }
});

$('btn-guide-fix').addEventListener('click', async () => {
  const step = GUIDE[state.step];
  if (!step.fix) return;

  const button = $('btn-guide-fix');
  button.disabled = true;
  try {
    const message = await step.fix.run();
    $('guide-check-text').textContent = message;
  } catch (err) {
    $('guide-check-text').textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

$('btn-guide-next').addEventListener('click', () => {
  if (state.step === GUIDE.length - 1) {
    // if a file was waiting when the guide opened, go straight back to it
    if (state.file) return accept(state.file.path);
    return reset();
  }
  state.step += 1;
  renderGuide();
});

$('btn-guide-back').addEventListener('click', () => {
  if (state.step === 0) return reset();
  state.step -= 1;
  renderGuide();
});

$('btn-help').addEventListener('click', () => openGuide(0));
$('btn-err-help').addEventListener('click', () => openGuide(1));

/* ═══════════════════ accepting a file ═══════════════════ */

const dropzone = $('dropzone');
let dragDepth = 0;

document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth += 1; dropzone.classList.add('is-over'); });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropzone.classList.remove('is-over');
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove('is-over');
  const file = e.dataTransfer && e.dataTransfer.files[0];
  if (!file) return;
  const p = bridge.pathForFile(file);
  if (p) await accept(p);
});

$('btn-pick').addEventListener('click', async () => {
  const res = await bridge.pickFile();
  if (res && res.ok && res.value) await accept(res.value);
});

async function accept(filePath) {
  await refreshEnv();

  const res = await bridge.inspect(filePath);
  if (!res.ok) return fail('That did not work', res.error);

  const info = res.value;
  if (info.isDirectory) {
    return fail('That is a folder', 'Only single files are supported for now. Compress the folder first: right-click it and choose Compress.');
  }
  state.file = info;

  if (info.encryption === 'publicKey') return openDecrypt(info);

  if (info.encryption === 'password') {
    return fail(
      'This file is password-protected',
      'It was locked with a password, not with a device. Sealbox only works with a Ledger.',
      'You can open it in Terminal with: gpg --decrypt filename'
    );
  }

  // Something is missing — open the guide at exactly that step instead of
  // showing an error. The file stays in state and we come back to it.
  if (!hasGpg()) return openGuide(1);
  if (!deviceOn()) return openGuide(4);

  if (!hasKey()) return openNewKey(info);
  openEncrypt(info);
}

/* ═══════════════════ key creation ═══════════════════ */

function openNewKey(info) {
  $('nk-context').textContent = `“${info.name}” is waiting. We will create the key and lock it right away.`;
  show('screen-newkey');
  validateNewKey();
  poll = setInterval(async () => { await refreshEnv(); validateNewKey(); }, 2500);
  setTimeout(() => $('nk-name').focus(), 150);
}

['nk-name', 'nk-email'].forEach((id) => {
  $(id).addEventListener('input', validateNewKey);
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !$('btn-genkey').disabled) $('btn-genkey').click();
  });
});

function validateNewKey() {
  const name = $('nk-name').value.trim();
  const email = $('nk-email').value.trim();
  const okName = name.length >= 5;
  const okMail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const on = deviceOn();

  const box = $('nk-check');
  box.className = `status-row ${on ? 'ok' : 'waiting'}`;
  $('nk-check-text').textContent = on
    ? `Ledger connected · ${state.env.card.serial}`
    : 'Waiting for the device. Plug in the Ledger and open OpenPGP on it';

  $('btn-genkey').disabled = !(okName && okMail && on);
}

$('btn-toggle-log').addEventListener('click', () => {
  const log = $('key-log');
  log.hidden = !log.hidden;
  $('btn-toggle-log').textContent = log.hidden ? 'Show details' : 'Hide details';
});

$('btn-genkey').addEventListener('click', async () => {
  const identity = { name: $('nk-name').value.trim(), email: $('nk-email').value.trim() };

  $('key-log').textContent = '';
  show('screen-keybusy');

  const stop = bridge.onKeyProgress((line) => {
    const log = $('key-log');
    log.textContent += `${line}\n`;
    log.scrollTop = log.scrollHeight;
  });

  const res = await bridge.generateKey(identity);
  stop();

  if (!res.ok) {
    return fail(
      'Could not create the key',
      res.error,
      'Check that the Ledger is connected, the OpenPGP app is open on it, and Ledger Live is closed'
    );
  }

  state.recovery = res.value.recovery;
  renderRecovery(res.value.recovery);
  await refreshEnv();
  show('screen-keydone');
});

function renderRecovery(r) {
  const rows = [
    ['Timestamp', r.fakedTime],
    ['Name', r.name],
    ['Email', r.email],
    ['Device', r.serial || '—'],
    ['Fingerprint', shortFpr(r.fingerprint) || '—'],
  ];
  const box = $('recovery-box');
  box.textContent = '';
  rows.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'kv-row';
    const key = document.createElement('span');
    key.className = 'kv-key';
    key.textContent = label;
    const val = document.createElement('span');
    val.className = 'kv-val mono';
    val.textContent = value;
    row.append(key, val);
    box.append(row);
  });
}

$('btn-save-recovery').addEventListener('click', async () => {
  const res = await bridge.saveRecovery(state.recovery);
  if (!res.ok) return fail('Could not save', res.error);
  if (res.value) {
    $('btn-save-recovery').textContent = 'Saved ✓';
    $('btn-save-recovery').disabled = true;
  }
});

$('btn-continue').addEventListener('click', () => {
  $('btn-save-recovery').textContent = 'Save the recovery card';
  $('btn-save-recovery').disabled = false;
  if (state.file) openEncrypt(state.file);
  else reset();
});

/* ═══════════════════ encryption ═══════════════════ */

function openEncrypt(info) {
  const my = state.env.myKey;
  $('enc-name').textContent = info.name;
  $('enc-size').textContent = humanSize(info.size);
  $('mk-title').textContent = (my && my.uids[0]) || '—';

  show('screen-encrypt');
  updateEncCheck();
  poll = setInterval(async () => { await refreshEnv(); updateEncCheck(); }, 2500);
}

function updateEncCheck() {
  const on = deviceOn();
  const box = $('enc-check');
  box.className = `status-row ${on ? 'ok' : 'waiting'}`;
  $('enc-check-text').textContent = on
    ? 'Ledger connected — it will confirm the operation'
    : 'Plug in the Ledger and open the OpenPGP app on it';
  $('btn-encrypt').disabled = !on;
}

$('btn-encrypt').addEventListener('click', async () => {
  const file = state.file;
  const my = state.env.myKey;
  const id = my.fingerprint || my.keyId;

  busy('Locking the file', 'Look at the Ledger: it will ask for a PIN and a confirmation. Factory default is 123456.');

  const res = await bridge.encryptWithKey(file.path, id, id);
  if (!res.ok) {
    return fail('Could not lock the file', res.error,
      'Check that the Ledger is connected and the OpenPGP app is open on it');
  }
  done('File locked', res.value, file.path, 'It can only be opened with your Ledger.');
});

/* ═══════════════════ decryption ═══════════════════ */

function openDecrypt(info) {
  $('dec-name').textContent = info.name;
  $('dec-size').textContent = humanSize(info.size);
  show('screen-decrypt');
  updateDecCheck();
  poll = setInterval(async () => { await refreshEnv(); updateDecCheck(); }, 2500);
}

function updateDecCheck() {
  const on = deviceOn();
  const box = $('dec-check');
  box.className = `status-row ${on ? 'ok' : 'waiting'}`;
  $('dec-check-text').textContent = on
    ? 'Ledger connected — ready to open'
    : 'Plug in the Ledger and open the OpenPGP app on it';
  $('btn-decrypt').disabled = !on;
}

$('btn-decrypt').addEventListener('click', async () => {
  busy('Opening the file', 'Look at the Ledger: it will ask for a PIN. Factory default is 123456.');

  const res = await bridge.decryptWithCard(state.file.path);
  if (!res.ok) {
    return fail('Could not open the file', res.error,
      'Make sure this is the same Ledger the file was locked with');
  }
  done('File opened', res.value, null, 'The plain file now sits next to the locked one.');
});

/* ═══════════════════ progress and result ═══════════════════ */

function busy(text, tip) {
  $('busy-text').textContent = text;
  $('busy-tip').textContent = (tip || '').replace(/<\/?b>/g, '');
  show('screen-busy');
}

function done(title, result, sourcePath, explain) {
  state.result = result.outputPath;
  state.source = sourcePath;
  $('done-title').textContent = title;
  $('done-file').textContent = result.name;
  $('done-explain').textContent = explain || '';
  $('btn-trash').hidden = !sourcePath;
  show('screen-done');
}

$('btn-reveal').addEventListener('click', () => state.result && bridge.reveal(state.result));

$('btn-trash').addEventListener('click', async () => {
  if (!state.source) return;
  const res = await bridge.trash(state.source);
  if (!res.ok) return fail('Could not move the file', res.error);
  $('btn-trash').hidden = true;
  $('done-explain').textContent = 'The unlocked file has been moved to Trash.';
});

/* ═══════════════════ demo mode ═══════════════════ */

function demoApi() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (value) => ({ ok: true, value });

  let myKey = null;
  let progress = () => {};
  let prepared = false;   // as on a first launch: preparation has not run yet

  const files = {
    '/Users/boris/Documents/Lease agreement.docx':
      { name: 'Lease agreement.docx', size: 1_284_096, encryption: 'none', isDirectory: false },
    '/Users/boris/Documents/Lease agreement.docx.gpg':
      { name: 'Lease agreement.docx.gpg', size: 1_285_318, encryption: 'publicKey', isDirectory: false },
  };
  const names = Object.keys(files);
  let cursor = 0;

  return {
    pathForFile: (f) => f.path || names[0],

    status: async () => ok({
      gpg: prepared ? '/opt/homebrew/bin/gpg' : null,
      version: prepared ? 'gpg (GnuPG) 2.4.8' : null,
      card: { serial: '937F8BE3', reader: 'Ledger Nano X' },
      appVersion: '1.0.0',
      myKey,
      keys: myKey ? [myKey] : [],
    }),
    setupPrepare: async () => {
      for (const line of [
        'Checking what is already installed…',
        'Installing. This can take a few minutes…',
        '==> Pouring gnupg--2.4.8.arm64_sonoma.bottle.tar.gz',
        '==> Pouring pinentry-mac--1.1.1.arm64_sonoma.bottle.tar.gz',
        'Configuring the device connection…',
      ]) { progress(line); await wait(650); }
      prepared = true;
      return ok({});
    },
    setupRetryLink: async () => { await wait(600); return ok('pcsc'); },
    setupEnableDriver: async () => { await wait(600); return ok(true); },
    onSetupProgress: (cb) => { progress = cb; return () => { progress = () => {}; }; },


    onKeyProgress: (cb) => { progress = cb; return () => { progress = () => {}; }; },

    generateKey: async (identity) => {
      const lines = [
        'device 937F8BE3',
        '← cardedit.prompt: admin',
        '← cardedit.prompt: generate',
        '← cardedit.genkeys.backup_enc: n',
        '← keygen.valid: 0',
        `← keygen.name: ${identity.name}`,
        `← keygen.email: ${identity.email}`,
        '← keygen.userid.cmd: O',
        'gpg: waiting for confirmation on the device…',
        'key created',
      ];
      for (const l of lines) { progress(l); await wait(260); }

      myKey = {
        keyId: 'E4C302BC8672419D',
        fingerprint: '60F7D30628782B4AAA3A3782E4C302BC8672419D',
        uids: [`${identity.name} <${identity.email}>`],
        onCard: true,
      };
      return ok({
        fingerprint: myKey.fingerprint,
        recovery: {
          fakedTime: '19990101T000000!',
          name: identity.name,
          email: identity.email,
          serial: '937F8BE3',
          fingerprint: myKey.fingerprint,
        },
      });
    },

    saveRecovery: async () => { await wait(400); return ok('/Users/boris/Documents/sealbox-recovery.txt'); },
    inspect: async (p) => { await wait(120); return ok({ path: p, keyIds: [], ...files[p] }); },
    pickFile: async () => { const p = names[cursor % names.length]; cursor += 1; return ok(p); },

    encryptWithKey: async () => { await wait(1800); return ok({ outputPath: '/x.gpg', name: 'Lease agreement.docx.gpg' }); },
    decryptWithCard: async () => { await wait(1600); return ok({ outputPath: '/x', name: 'Lease agreement.docx' }); },

    reveal: async () => ok(true),
    trash: async () => { await wait(300); return ok(true); },
  };
}

/* ═══════════════════ start ═══════════════════ */

/*
 * The app always opens on the drop screen. The setup guide is not a gate:
 * it appears only when something is actually missing, at the step that is
 * missing — either because the user dropped a file and we cannot proceed,
 * or because they clicked the status line or the "?" button.
 */
(async function start() {
  // Show the drop screen immediately. Probing the environment can take several
  // seconds — searching for gpg, asking the card for its status — and the window
  // used to stay blank for the whole of it, which reads as a broken app.
  state.env = { gpg: null, card: null, keys: [], myKey: null };
  show('screen-drop');
  $('statusline').lastElementChild.textContent = 'Checking…';

  await refreshEnv();
  // the badge shows the real app version, so it can never drift from package.json
  if (state.env && state.env.appVersion) $('version-badge').textContent = `v${state.env.appVersion}`;
  reset();
})();
