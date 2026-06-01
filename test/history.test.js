'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {makeChrome, loadClassic} = require('./helpers.js');

function loadHistory(seedSession) {
  const chrome = makeChrome();
  if (seedSession) {
    chrome.__areas.session['pp-history'] = seedSession;
  }
  const sandbox = {chrome, console};
  loadClassic('src/background/history.js', sandbox, ['blockHistory']);
  return {chrome, blockHistory: sandbox.blockHistory};
}

const entry = (over = {}) => ({hostname: 'ads.net', href: 'https://ads.net/x', type: 'open', ts: Date.now(), ...over});

test('add then get returns the entry for that tab', async () => {
  const {blockHistory} = loadHistory();
  await blockHistory.add(1, entry({hostname: 'foo.com'}));
  const list = await blockHistory.get(1);
  assert.equal(list.length, 1);
  assert.equal(list[0].hostname, 'foo.com');
});

test('get for an unknown tab returns an empty array', async () => {
  const {blockHistory} = loadHistory();
  const list = await blockHistory.get(999);
  assert.equal(list.length, 0);
});

test('history is capped at 25 entries per tab', async () => {
  const {blockHistory} = loadHistory();
  for (let i = 0; i < 30; i++) {
    await blockHistory.add(1, entry({type: String(i)}));
  }
  const list = await blockHistory.get(1);
  assert.equal(list.length, 25);
});

test('cap drops the oldest entries (FIFO)', async () => {
  const {blockHistory} = loadHistory();
  for (let i = 0; i < 30; i++) {
    await blockHistory.add(1, entry({type: String(i)}));
  }
  const list = await blockHistory.get(1);
  assert.equal(list[0].type, '5');   // 0..4 dropped
  assert.equal(list[24].type, '29'); // newest kept
});

test('clear removes a tab history', async () => {
  const {blockHistory} = loadHistory();
  await blockHistory.add(2, entry());
  await blockHistory.clear(2);
  const list = await blockHistory.get(2);
  assert.equal(list.length, 0);
});

test('add ignores a non-numeric tab id without throwing', async () => {
  const {blockHistory} = loadHistory();
  await blockHistory.add('nope', entry());
  await blockHistory.add(3, entry({hostname: 'real.com'}));
  const list = await blockHistory.get(3);
  assert.equal(list.length, 1);
  assert.equal(list[0].hostname, 'real.com');
});

test('add persists to session storage under pp-history', async () => {
  const {blockHistory, chrome} = loadHistory();
  await blockHistory.add(4, entry());
  const stored = chrome.__areas.session['pp-history'];
  assert.ok(stored, 'pp-history key written');
  assert.equal(stored[4].length, 1);
});

test('existing session data is loaded on first access', async () => {
  const seeded = {7: [entry({hostname: 'restored.com'})]};
  const {blockHistory} = loadHistory(seeded);
  const list = await blockHistory.get(7);
  assert.equal(list.length, 1);
  assert.equal(list[0].hostname, 'restored.com');
});

test('clear updates the persisted session copy', async () => {
  const {blockHistory, chrome} = loadHistory();
  await blockHistory.add(8, entry());
  await blockHistory.clear(8);
  const stored = chrome.__areas.session['pp-history'];
  assert.equal(stored[8], undefined);
});

test('all entry fields are preserved round-trip', async () => {
  const {blockHistory} = loadHistory();
  const e = entry({hostname: 'h.com', href: 'https://h.com/p?q=1', type: 'click', ts: 1717000000000});
  await blockHistory.add(9, e);
  assert.deepEqual((await blockHistory.get(9))[0], e);
});

test('separate tabs keep independent histories', async () => {
  const {blockHistory} = loadHistory();
  await blockHistory.add(10, entry({hostname: 'a.com'}));
  await blockHistory.add(11, entry({hostname: 'b.com'}));
  assert.equal((await blockHistory.get(10))[0].hostname, 'a.com');
  assert.equal((await blockHistory.get(11))[0].hostname, 'b.com');
  assert.equal((await blockHistory.get(10)).length, 1);
});
