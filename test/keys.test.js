'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const keys = require('../src/crypto/keys');

test('a colon listing becomes one entry per key, with the first uid split up', () => {
  const listing = [
    'tru::1:1700000000:0:3:1:5',
    'pub:u:255:22:E4C302BC8672419D:1580000000:::u:::scESC::::::ed25519:::0:',
    'fpr:::::::::AAAA1111BBBB2222CCCC3333E4C302BC8672419D:',
    'uid:u::::1580000000::ABC::Boris Zozulya (work) <boris@example.com>::::::::::0:',
    'sub:u:2048:1:1111222233334444:1580000000::::::e::::::rsa2048::',
  ].join('\n');

  const parsed = keys.parseKeyListing(listing);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'Boris Zozulya');
  assert.equal(parsed[0].email, 'boris@example.com');
  assert.equal(parsed[0].fingerprint, 'AAAA1111BBBB2222CCCC3333E4C302BC8672419D');
});

test('a key with no uid is not offered as a recipient', () => {
  const listing = 'pub:u:255:22:E4C302BC8672419D:1580000000:::u:::scESC::::::ed25519:::0:\nfpr:::::::::AAAA:';
  assert.deepEqual(keys.parseKeyListing(listing), []);
});

test('uids without a comment or without a name still split correctly', () => {
  assert.deepEqual(keys.splitUid('Alex Morgan <alex@example.com>'), { name: 'Alex Morgan', email: 'alex@example.com' });
  assert.deepEqual(keys.splitUid('<alex@example.com>'), { name: '', email: 'alex@example.com' });
  assert.deepEqual(keys.splitUid('just a label'), { name: 'just a label', email: '' });
});

test('escaped characters in a uid are decoded, so a colon in a name cannot break the parser', () => {
  const listing = [
    'pub:u:255:22:AAAA:1580000000:::u:::scESC::::::ed25519:::0:',
    'fpr:::::::::FFFF:',
    'uid:u::::1580000000::ABC::Acme\\x3a Ltd <ops@acme.test>::::::::::0:',
  ].join('\n');
  assert.equal(keys.parseKeyListing(listing)[0].name, 'Acme: Ltd');
});

test('the fingerprint is shown in groups of four, last sixteen characters', () => {
  assert.equal(keys.prettyFingerprint('AAAA1111BBBB2222CCCC3333E4C302BC8672419D'), 'CCCC 3333 E4C3 02BC 8672 419D'.slice(-19));
  assert.equal(keys.prettyFingerprint('E4C302BC8672419D'), 'E4C3 02BC 8672 419D');
});
