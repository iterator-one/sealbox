'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const device = require('../src/device/state');

const facts = (over) => Object.assign({
  hasGpg: true, cardPresent: false, cardHasKey: false, onUsb: null, ledgerLive: null,
}, over);

test('without GnuPG nothing else matters', () => {
  assert.equal(device.decide(facts({ hasGpg: false, cardPresent: true, cardHasKey: true })), 'no-gpg');
});

test('a card that answers and holds a key is ready', () => {
  assert.equal(device.decide(facts({ cardPresent: true, cardHasKey: true })), 'ready');
});

test('a card with no key on it asks for the key to be restored, not for a cable', () => {
  assert.equal(device.decide(facts({ cardPresent: true, cardHasKey: false })), 'no-key');
});

test('Ledger Live holding the device is reported as such, not as a missing device', () => {
  assert.equal(device.decide(facts({ ledgerLive: true, onUsb: true })), 'ledger-live');
});

test('plugged in but not answering means the OpenPGP app is closed', () => {
  assert.equal(device.decide(facts({ onUsb: true, ledgerLive: false })), 'closed');
});

test('nothing on the bus means disconnected', () => {
  assert.equal(device.decide(facts({ onUsb: false, ledgerLive: false })), 'disconnected');
});

test('when USB cannot be observed the state degrades to disconnected rather than guessing', () => {
  assert.equal(device.decide(facts({ onUsb: null, ledgerLive: null })), 'disconnected');
});

test('a present card wins over every other observation', () => {
  // Ledger Live can be running while the card still answers; the user does not
  // need to be told to quit anything in that case.
  assert.equal(device.decide(facts({ cardPresent: true, cardHasKey: true, ledgerLive: true })), 'ready');
});
