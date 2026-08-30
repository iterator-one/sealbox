'use strict';
/**
 * Every string the interface can show about the device or the setup flow.
 *
 * This lives apart from renderer.js for one reason: it can then be loaded by a
 * test in Node as well as by the window, so "does each device state actually
 * have something to say to the user?" is a question a test can answer instead
 * of a person having to click through eight states by hand.
 *
 * The wording comes from the design file, verbatim.
 */

// Wrapped in a function on purpose: index.html loads this as a classic script
// alongside renderer.js, so both share one global scope. A top-level `const
// DEVICE_ROWS` here would collide with any binding of the same name over there
// and Electron would refuse to parse the other file entirely — the same failure
// that once shipped as a blank window.
(function () {
  const DEVICE_ROWS = {
  'no-gpg': {
    icon: 'shield-plus',
    title: 'Ledger not set up',
    sub: 'Set up your Ledger to create and use your key.',
    action: 'Set up',
  },
  checking: {
    icon: 'hourglass',
    title: 'Checking Ledger…',
  },
  disconnected: {
    icon: 'link-broken',
    title: 'Ledger disconnected',
    sub: 'Connect your Ledger when you need it.',
    action: 'Connect',
  },
  closed: {
    icon: 'alert',
    title: 'Open OpenPGP',
    sub: 'Open the OpenPGP app on your Ledger.',
  },
  'ledger-live': {
    icon: 'alert',
    title: 'Quit Ledger Live',
    sub: 'Ledger Live is using your Ledger.',
    action: 'Quit it',
  },
  ready: {
    icon: 'check',
    title: 'Ledger ready',
    action: 'Details',
    secondary: true,
    ready: true,
  },
  'no-key': {
    icon: 'pin',
    title: 'Key not found',
    sub: 'Restore your key to access encrypted files.',
    action: 'Restore key',
  },
  error: {
    icon: 'alert',
    title: 'Ledger unavailable',
    sub: 'Sealbox couldn’t connect to your Ledger.',
    action: 'Try again',
  },
  };

  /** The same states, said differently when an operation is already under way. */
  const DEVICE_SCREEN = {
  'no-gpg': {
    title: 'Finish setting up',
    sub: 'Sealbox needs a few tools before it can talk to your Ledger.',
    status: 'Waiting for Ledger…',
  },
  checking: { title: 'Connect your Ledger', status: 'Checking Ledger…' },
  disconnected: { title: 'Connect your Ledger', status: 'Waiting for Ledger…' },
  closed: {
    title: 'Open OpenPGP',
    sub: 'Open the OpenPGP app on your Ledger.',
    status: 'Waiting for Ledger…',
  },
  'ledger-live': {
    title: 'Connect your Ledger',
    status: 'Waiting for Ledger…',
    note: 'Ledger Live is using your Ledger',
  },
  ready: { title: 'Connect your Ledger', status: 'Ledger ready', ready: true },
  'no-key': {
    title: 'Connect your Ledger',
    status: 'Ledger ready',
    ready: true,
    note: 'This Ledger can’t decrypt the file',
    note2: 'Connect a Ledger that holds one of the required keys',
  },
  error: {
    title: 'Connect your Ledger',
    status: 'Waiting for Ledger…',
    note: 'Reconnect your Ledger to continue.',
  },
  };

  /**
   * The setup ladder. `screen` is the id in index.html, `bar` is how many of the
   * seven segments are filled — steps without a bar are the ones the design shows
   * without one (the welcome, the failure, the finish).
   */
  const SETUP_STEPS = [
  { step: 1, screen: 's-intro', title: 'Set up your Ledger' },
  { step: 2, screen: 's-prepare', title: 'Prepare your Mac', bar: 1 },
  { step: 3, screen: 's-openpgp', title: 'Install OpenPGP on Ledger', bar: 2 },
  { step: 4, screen: 's-seed', title: 'Enable Seed mode', bar: 3 },
  { step: 5, screen: 's-connect', title: 'Connect your Ledger', bar: 4 },
  { step: 6, screen: 's-key', title: 'Create your encryption key', bar: 5 },
  { step: 7, screen: 's-creating', title: 'Finish on your Ledger', bar: 6 },
  { step: 8, screen: 's-recovery', title: 'Save your recovery details', bar: 7 },
  { step: 9, screen: 's-done', title: 'Setup complete' },
  ];

  const SETUP_TOTAL = 7;

  /**
   * Does the user have a choice to make about recipients? With a single key
   * there is nothing to choose, and a list of one is a screen that exists only
   * to be dismissed.
   */
  function chooserNeeded(keys) {
    return Array.isArray(keys) && keys.length > 1;
  }

  // Loaded both as a plain script in the window and as a module in tests.
  const exported = { DEVICE_ROWS, DEVICE_SCREEN, SETUP_STEPS, SETUP_TOTAL, chooserNeeded };
  if (typeof window !== 'undefined') window.SEALBOX_COPY = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
}());
