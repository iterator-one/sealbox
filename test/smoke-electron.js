'use strict';
/**
 * Boots the real application in Electron and checks that the first screen
 * actually renders.
 *
 * This exists because of a bug that shipped: preload.js exposes a global
 * `window.api`, renderer.js declared a top-level `const api`, and the
 * collision made Electron fail to parse the entire renderer script. Every
 * screen stayed hidden and the window was blank. The browser preview could
 * not catch it — there is no window.api there, so there is no collision.
 *
 * Run with: npm run smoke   (needs a display; use xvfb-run on CI)
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');

// process.exit() races with stdout flushing, which once let a failing run print
// "SMOKE OK" underneath its own failure. Fail loudly, then stop the app.
let failed = false;
const fail = (message) => {
  failed = true;
  console.error(`SMOKE FAIL: ${message}`);
  app.exit(1);
};

require(path.join(__dirname, '..', 'main.js'));

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 7000));

  const win = BrowserWindow.getAllWindows()[0];
  if (!win) fail('no window was created');

  const state = await win.webContents.executeJavaScript(`(() => ({
    activeScreens: document.querySelectorAll('.screen.is-active').length,
    active: (document.querySelector('.screen.is-active') || {}).id || null,
    dropTitle: (document.querySelector('#screen-drop .title') || {}).textContent || '',
    ledger: (document.querySelector('#ledger-title') || {}).textContent || '',
    screens: document.querySelectorAll('.screen').length,
    // every <use href="#..."> must resolve to a symbol, or the screen renders
    // with invisible icons and still looks "fine" to a unit test
    brokenIcons: [...document.querySelectorAll('use')]
      .map((u) => u.getAttribute('href'))
      .filter((h) => h && h.startsWith('#') && !document.getElementById(h.slice(1))).length,
    bridge: typeof window.api,
  }))()`);

  const checks = [
    [state.activeScreens === 1, `exactly one active screen, got ${state.activeScreens}`],
    [state.active === 'screen-drop', `opens on the drop screen, got ${state.active}`],
    [state.dropTitle.trim() === 'Drop a file here', `the drop screen reads "Drop a file here", got "${state.dropTitle}"`],
    [state.ledger.trim().length > 0, 'the Ledger status row says something'],
    [state.screens >= 18, `all screens are present, got ${state.screens}`],
    [state.brokenIcons === 0, `${state.brokenIcons} icon references point at nothing`],
    [state.bridge === 'object', 'preload exposed the bridge'],
  ];

  // Walk every screen in the real window: a screen that renders empty, or that
  // pushes content outside the 520x640 frame, is a screen nobody can use.
  const walk = await win.webContents.executeJavaScript(`(() => {
    const out = [];
    for (const screen of document.querySelectorAll('.screen')) {
      document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('is-active', s === screen));
      const text = (screen.innerText || '').trim();
      out.push({
        id: screen.id,
        text: text.length,
        overflow: screen.scrollHeight - screen.clientHeight,
        wide: document.documentElement.scrollWidth > 520,
      });
    }
    return out;
  })()`);

  const empty = walk.filter((s) => s.text === 0).map((s) => s.id);
  const spilling = walk.filter((s) => s.overflow > 2).map((s) => `${s.id} (+${s.overflow}px)`);
  const wide = walk.filter((s) => s.wide).map((s) => s.id);
  checks.push(
    [empty.length === 0, `these screens render no text: ${empty.join(', ')}`],
    [spilling.length === 0, `these screens overflow the window: ${spilling.join(', ')}`],
    [wide.length === 0, `these screens are wider than the window: ${wide.join(', ')}`]
  );

  const problems = checks.filter(([ok]) => !ok).map(([, what]) => what);
  if (problems.length) return fail(problems.join('; '));
  if (failed) return;

  console.log('SMOKE OK:', JSON.stringify({ ...state, screensWalked: walk.length }));
  app.quit();
});
