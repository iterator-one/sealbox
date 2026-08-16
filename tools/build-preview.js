'use strict';
/**
 * Builds preview.html — one self-contained file holding the real application
 * interface inside an iframe, on a "desktop" backdrop.
 *
 * The iframe runs the same index.html / styles.css / renderer.js that ship in
 * the app. The only difference is that window.api is absent, so renderer.js
 * switches itself into demo mode with mock data.
 *
 *     node tools/build-preview.js
 */

const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');

const dataUri = (file) =>
  `data:image/svg+xml;base64,${fs.readFileSync(path.join(R, 'assets', file)).toString('base64')}`;

const html = read('index.html')
  .replace(/src="assets\/([^"]+)"/g, (_, f) => `src="${dataUri(f)}"`)
  .replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>\s*/, '')
  .replace('<link rel="stylesheet" href="styles.css" />', `<style>\n${read('styles.css')}\n</style>`)
  .replace('<script src="renderer.js"></script>', `<script>\n${read('renderer.js')}\n</script>`);

// the source string goes into iframe.srcdoc — JSON.stringify handles escaping,
// leaving only the closing script tag to break up
const embedded = JSON.stringify(html).replace(/<\/script>/g, '<\\/script>');

const preview = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sealbox — UI preview</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 22px; padding: 36px 20px;
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
    background:
      radial-gradient(900px 600px at 18% 8%, #3a3070 0%, transparent 55%),
      radial-gradient(800px 700px at 88% 92%, #10456b 0%, transparent 55%),
      linear-gradient(160deg, #171a21 0%, #0d0f13 100%);
    color: #97a0b3;
  }
  .stack { display: flex; gap: 30px; align-items: flex-start; flex-wrap: wrap; justify-content: center; }
  .unit { display: flex; flex-direction: column; align-items: center; gap: 11px; }
  .window {
    position: relative;
    width: 440px; height: 700px;
    border-radius: 24px; overflow: hidden;
    box-shadow: 0 34px 70px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08);
    background: #101217;
  }
  
  .window.light { background: #f6f7f9; }
  .window iframe { width: 100%; height: 100%; border: 0; display: block; }
  .lights { position: absolute; top: 14px; left: 13px; display: flex; gap: 8px; z-index: 5; pointer-events: none; }
  .lights i { width: 11px; height: 11px; border-radius: 50%; display: block; }
  .lights i:nth-child(1) { background: #ff5f57; }
  .lights i:nth-child(2) { background: #febc2e; }
  .lights i:nth-child(3) { background: #28c840; }
  .caption { font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase; color: #a0a0a0; }
  .hint {
    max-width: 620px; text-align: center; font-size: 12.5px; line-height: 1.65; color: #97a0b3;
  }
  .hint b { color: #dfe4ee; font-weight: 600; }
  kbd {
    font: inherit; font-size: 11.5px; background: rgba(255,255,255,.09);
    border: 1px solid rgba(255,255,255,.14); border-radius: 5px; padding: 1px 6px;
  }
</style>
</head>
<body>

<div class="stack">
  <div class="unit">
    <div class="window" id="w-a"><span class="lights"><i></i><i></i><i></i></span></div>
    <span class="caption">Dark</span>
  </div>
  <div class="unit">
    <div class="window light" id="w-b"><span class="lights"><i></i><i></i><i></i></span></div>
    <span class="caption">Light</span>
  </div>
</div>

<p class="hint">
  A working interface, not a picture. The app opens on the drop screen; press
  <b>“Choose a file”</b> and it will notice what is missing and open the setup guide at that
  exact step. The two windows are independent.
</p>

<script>
const APP = ${embedded};

function mount(id, theme) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.srcdoc = APP.replace('<html lang="en">', '<html lang="en" data-theme="' + theme + '">');
  document.getElementById(id).append(frame);
}

mount('w-a', 'dark');
mount('w-b', 'light');
</script>

</body>
</html>
`;

const out = path.join(__dirname, '..', 'preview.html');
fs.writeFileSync(out, preview);
console.log('preview.html ready:', out, `(${(preview.length / 1024).toFixed(0)} KB)`);
