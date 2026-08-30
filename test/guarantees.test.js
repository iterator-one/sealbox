'use strict';
/**
 * The promises in SECURITY.md, checked mechanically.
 *
 * These ran only in CI before, as greps in the workflow, which meant a
 * violation was found after a push instead of before one — and the network
 * check was blunt enough to fail on an address that is handed to the browser
 * rather than fetched. Both now live here, where `npm test` runs them.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function sourceFiles() {
  const files = ['main.js', 'preload.js'];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.js')) files.push(rel);
    }
  };
  walk('src');
  return files;
}

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('nothing in the app opens a network connection', () => {
  // Not a URL check — a URL is only an address. This looks for the APIs that
  // would actually make a request.
  const forbidden = /\bfetch\s*\(|XMLHttpRequest|require\('(?:net|dns|https?|tls)'\)|axios|node-fetch|got\s*\(/;
  for (const file of sourceFiles()) {
    const offenders = read(file)
      .split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => forbidden.test(line) && !line.startsWith('*') && !line.startsWith('//'));
    assert.deepEqual(offenders, [], `${file} reaches the network on line(s) ${offenders.map((o) => o.n).join(', ')}`);
  }
});

test('an address may appear in exactly one file, and only to be handed to the system', () => {
  const urlLike = /https?:\/\/|ledgerlive:\/\//;
  for (const file of sourceFiles()) {
    if (file === path.join('src', 'links.js')) continue;
    const offenders = read(file)
      .split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      // comments may cite an address; code may not hold one
      .filter(({ line }) => urlLike.test(line) && !line.startsWith('*') && !line.startsWith('//') && !line.startsWith('#'));
    assert.deepEqual(offenders, [], `${file} contains an address outside src/links.js, line(s) ${offenders.map((o) => o.n).join(', ')}`);
  }
});

test('every address in the allowlist is one of the two schemes we intend', () => {
  const { LINKS } = require('../src/links');
  const names = Object.keys(LINKS);
  assert.ok(names.length > 0);
  for (const name of names) {
    const url = LINKS[name];
    assert.match(url, /^(https:\/\/|ledgerlive:\/\/)/, `${name} is neither https nor a Ledger Live link`);
    assert.doesNotMatch(url, /\s/, `${name} contains whitespace`);
  }
});

test('no shell strings anywhere: every external command goes through an argument array', () => {
  const forbidden = /\bexec\s*\(|execSync|shell:\s*true/;
  for (const file of sourceFiles()) {
    const offenders = read(file)
      .split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => forbidden.test(line) && !line.startsWith('*') && !line.startsWith('//'));
    assert.deepEqual(offenders, [], `${file} builds a shell command on line(s) ${offenders.map((o) => o.n).join(', ')}`);
  }
});

test('the renderer is given no more power than preload.js lists', () => {
  const preload = read('preload.js');
  const exposed = [...preload.matchAll(/^  (\w+):/gm)].map((m) => m[1]);
  assert.ok(exposed.length > 0);
  // A renderer that could reach ipcRenderer directly would make the list moot.
  assert.doesNotMatch(preload, /exposeInMainWorld\([^)]*ipcRenderer/, 'ipcRenderer itself must not be exposed');
  assert.match(read('main.js'), /contextIsolation: true/);
  assert.match(read('main.js'), /nodeIntegration: false/);
});
