'use strict';
/**
 * The interface must never leave someone staring at a state with no explanation.
 * These tests check that promise mechanically: every device state the detector
 * can produce has something to say, and every setup step points at a screen that
 * exists in the markup.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const copy = require('../renderer/copy.js');
const device = require('../src/device/state');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

test('every device state has a status row with a title', () => {
  for (const state of device.STATES) {
    const row = copy.DEVICE_ROWS[state];
    assert.ok(row, `no status row for "${state}"`);
    assert.ok(row.title && row.title.trim().length > 0, `"${state}" has no title`);
    assert.ok(row.icon, `"${state}" has no icon`);
  }
});

test('every device state that needs a fix says what the fix is', () => {
  // "checking" and "ready" are the two states where there is nothing to do.
  const nothingToDo = new Set(['checking', 'ready']);
  for (const state of device.STATES) {
    if (nothingToDo.has(state)) continue;
    const row = copy.DEVICE_ROWS[state];
    assert.ok(row.sub || row.action, `"${state}" tells the user nothing about what to do`);
  }
});

test('every device state also has wording for the middle of an operation', () => {
  for (const state of device.STATES) {
    const screen = copy.DEVICE_SCREEN[state];
    assert.ok(screen, `no operation screen for "${state}"`);
    assert.ok(screen.title && screen.status, `"${state}" is missing a title or a status line`);
  }
});

test('the setup ladder is nine steps, numbered without gaps', () => {
  assert.equal(copy.SETUP_STEPS.length, 9);
  copy.SETUP_STEPS.forEach((s, i) => assert.equal(s.step, i + 1, `step ${i + 1} is out of order`));
});

test('every setup step points at a screen that exists in the markup', () => {
  for (const step of copy.SETUP_STEPS) {
    assert.ok(ids.has(step.screen), `step ${step.step} points at #${step.screen}, which is not in index.html`);
  }
});

test('the progress bar advances by exactly one segment per step and ends full', () => {
  const bars = copy.SETUP_STEPS.filter((s) => s.bar).map((s) => s.bar);
  assert.deepEqual(bars, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(Math.max(...bars), copy.SETUP_TOTAL);
});

test('the recipient chooser appears only when there is something to choose', () => {
  assert.equal(copy.chooserNeeded([]), false);
  assert.equal(copy.chooserNeeded([{ id: 'a' }]), false, 'a list of one is a screen only to be dismissed');
  assert.equal(copy.chooserNeeded([{ id: 'a' }, { id: 'b' }]), true);
});

test('every screen in the markup has a title element, so no screen can render empty', () => {
  const screens = [...html.matchAll(/<section class="screen[^"]*" id="([^"]+)"([\s\S]*?)<\/section>/g)];
  assert.ok(screens.length >= 18, `expected at least 18 screens, found ${screens.length}`);
  for (const [, id, body] of screens) {
    assert.ok(/class="title"/.test(body) || /class="row-title"/.test(body), `#${id} has no title`);
  }
});
