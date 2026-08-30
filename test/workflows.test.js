'use strict';
/**
 * Guards against the class of mistake that cannot be caught by running the
 * code: a workflow file GitHub refuses to parse. Four release builds were lost
 * to one of these — `secrets` used inside a step's `if:`, which is not allowed
 * and invalidates the entire file, so nothing runs and no release appears.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '.github', 'workflows');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yml'));

test('there are workflows to check', () => {
  assert.ok(files.length >= 2, `expected the ci and release workflows, found ${files.join(', ')}`);
});

test('the release workflow cannot finish green without publishing', () => {
  const text = fs.readFileSync(path.join(dir, 'release.yml'), 'utf8');
  const lines = text.split('\n');

  // The step that creates the release must not be conditional: a skipped step
  // leaves a successful run that published nothing, which is exactly how a
  // release can appear to have happened when it did not.
  const attachAt = lines.findIndex((l) => /- name: Attach to the release/.test(l));
  assert.ok(attachAt > 0, 'the release workflow has no step that attaches the build');
  const attachBlock = lines.slice(attachAt, attachAt + 6).join('\n');
  assert.doesNotMatch(attachBlock, /^\s*if:/m, 'the attach step is conditional — it can be skipped silently');

  // And a run started by hand must be told which tag to publish.
  assert.match(text, /workflow_dispatch:\s*\n\s*inputs:/, 'a manual run has no tag input');
});

for (const file of files) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const lines = text.split('\n');

  test(`${file}: no "secrets" inside an if condition`, () => {
    // The secrets context is unavailable in `if:`. GitHub rejects the whole
    // file with "Unrecognized named-value: 'secrets'".
    const offenders = lines
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /^\s*if:/.test(line) && /secrets\./.test(line));
    assert.deepEqual(offenders, [], `secrets used in if: on line(s) ${offenders.map((o) => o.n).join(', ')}`);
  });

  test(`${file}: every referenced step id exists`, () => {
    const ids = new Set([...text.matchAll(/^\s*id:\s*([\w-]+)/gm)].map((m) => m[1]));
    const used = new Set([...text.matchAll(/steps\.([\w-]+)\.outputs/g)].map((m) => m[1]));
    for (const id of used) assert.ok(ids.has(id), `steps.${id} is referenced but no step declares that id`);
  });

  test(`${file}: no secret is interpolated into a run script`, () => {
    // A secret belongs in `env:`; interpolating it into a shell line puts its
    // value on a command line and into any error message that echoes it.
    let inRun = false;
    const offenders = [];
    lines.forEach((line, i) => {
      if (/^\s*run:\s*[|>]/.test(line)) inRun = true;
      else if (/^\s{0,8}-\s|^\s{0,8}\w+:/.test(line) && !/^\s*run:/.test(line)) inRun = false;
      if (inRun && /\$\{\{\s*secrets\./.test(line)) offenders.push(i + 1);
    });
    assert.deepEqual(offenders, [], `secret interpolated into a run script on line(s) ${offenders.join(', ')}`);
  });
}
