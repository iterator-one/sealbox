'use strict';
/**
 * Builds preview.html — one self-contained file holding the real application
 * interface, on a "desktop" backdrop.
 *
 * The frame runs the same index.html / styles.css / renderer.js that ship in
 * the app. The only difference is that window.api is absent, so renderer.js
 * switches itself into demo mode with mock data, which lets a reviewer or a
 * designer walk every screen without a Mac, GnuPG or a Ledger.
 *
 *     node tools/build-preview.js
 */

const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');

// The fonts ship as files; inside a single-file preview they have to travel as
// data URIs or the preview would render in a different typeface than the app.
function inlineFonts(css) {
  return css.replace(/url\('fonts\/([^']+)'\)/g, (_, file) => {
    const bytes = fs.readFileSync(path.join(R, 'fonts', file));
    return `url('data:font/woff2;base64,${bytes.toString('base64')}')`;
  });
}

const html = read('index.html')
  .replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>\s*/, '')
  .replace('<link rel="stylesheet" href="styles.css" />', `<style>\n${inlineFonts(read('styles.css'))}\n</style>`)
  .replace('<script src="copy.js"></script>', `<script>\n${read('copy.js')}\n</script>`)
  .replace('<script src="renderer.js"></script>', `<script>\n${read('renderer.js')}\n</script>`);

// the source string goes into iframe.srcdoc — JSON.stringify handles escaping,
// leaving only the closing script tag to break up
const embedded = JSON.stringify(html).replace(/<\/script>/g, '<\\/script>');

const preview = `<!DOCTYPE html>
<html lang="en">
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
  .window {
    width: 520px; height: 640px;
    border-radius: 32px; overflow: hidden;
    box-shadow: 0 34px 70px rgba(0,0,0,.6);
  }
  .window iframe { width: 520px; height: 640px; border: 0; display: block; }
  .hint { max-width: 620px; text-align: center; font-size: 12.5px; line-height: 1.65; }
  .hint b { color: #dfe4ee; font-weight: 600; }
</style>
</head>
<body>

<div class="window" id="w"></div>

<p class="hint">
  A working interface, not a picture. It opens on the drop screen; press
  <b>“or choose a file”</b> to walk the encrypt flow with mock data, or
  <b>“Import public key”</b> to walk the key flow. Nothing here touches a real key.
</p>

<script>
const APP = ${embedded};
const frame = document.createElement('iframe');
frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
frame.srcdoc = APP;
document.getElementById('w').append(frame);
</script>

</body>
</html>
`;

const out = path.join(__dirname, '..', 'preview.html');
fs.writeFileSync(out, preview);
console.log('preview.html ready:', out, `(${(preview.length / 1024).toFixed(0)} KB)`);
