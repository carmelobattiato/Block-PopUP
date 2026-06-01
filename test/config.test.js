'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {makeChrome, loadClassic} = require('./helpers.js');

/* load config.js fresh into a sandbox. `worker` controls whether importScripts
   is defined (only the service worker registers the sync->local mirror). */
function loadConfig({worker = false, syncThrows = false} = {}) {
  const chrome = makeChrome({syncThrows});
  const sandbox = {chrome, console};
  if (worker) {
    sandbox.importScripts = () => {};
  }
  loadClassic('src/background/config.js', sandbox, ['config', 'NO_SYNC']);
  return {chrome, config: sandbox.config, NO_SYNC: sandbox.NO_SYNC};
}

/* ---- functional: defaults & basic read/write ---- */

test('config.get returns the default when nothing is stored', async () => {
  const {config} = loadConfig();
  const p = await config.get(['enabled', 'timeout']);
  assert.equal(p.enabled, true);
  assert.equal(p.timeout, 5);
});

test('config.get returns the stored value over the default', async () => {
  const {config, chrome} = loadConfig();
  chrome.__areas.local.timeout = 12;
  const p = await config.get(['timeout']);
  assert.equal(p.timeout, 12);
});

test('config.set writes to local storage', async () => {
  const {config, chrome} = loadConfig();
  await config.set({timeout: 9});
  assert.equal(chrome.__areas.local.timeout, 9);
});

test('config.update hydrates an object in place', async () => {
  const {config, chrome} = loadConfig();
  chrome.__areas.local.domain = true;
  const obj = {domain: false, width: 420};
  await config.update(obj);
  assert.equal(obj.domain, true);
  assert.equal(obj.width, 420);
});

test('config has a sync-enabled default of false', async () => {
  const {config} = loadConfig();
  const p = await config.get(['sync-enabled']);
  assert.equal(p['sync-enabled'], false);
});

/* ---- functional: sync mirroring ---- */

test('set does NOT mirror to sync when sync-enabled is false', async () => {
  const {config, chrome} = loadConfig();
  await config.set({timeout: 7});
  assert.equal(chrome.__areas.sync.timeout, undefined);
});

test('set mirrors to sync when sync-enabled is true', async () => {
  const {config, chrome} = loadConfig();
  chrome.__areas.local['sync-enabled'] = true;
  await config.set({timeout: 7});
  assert.equal(chrome.__areas.sync.timeout, 7);
});

test('set never mirrors the device-local sync-enabled key', async () => {
  const {config, chrome} = loadConfig();
  await config.set({'sync-enabled': true, timeout: 3});
  assert.equal(chrome.__areas.sync['sync-enabled'], undefined);
  // timeout written in the same call IS mirrored (sync became enabled)
  assert.equal(chrome.__areas.sync.timeout, 3);
});

test('pushAllToSync copies all prefs except NO_SYNC keys', async () => {
  const {config, chrome, NO_SYNC} = loadConfig();
  chrome.__areas.local.timeout = 11;
  const ok = await config.pushAllToSync();
  assert.equal(ok, true);
  assert.equal(chrome.__areas.sync.timeout, 11);     // stored value
  assert.equal(chrome.__areas.sync.enabled, true);   // default value
  for (const k of NO_SYNC) {
    assert.equal(chrome.__areas.sync[k], undefined);
  }
});

test('pushAllToSync returns false when the sync quota is exceeded', async () => {
  const {config} = loadConfig({syncThrows: true});
  const ok = await config.pushAllToSync();
  assert.equal(ok, false);
});

test('set swallows a sync quota error but still saves locally', async () => {
  const {config, chrome} = loadConfig({syncThrows: true});
  chrome.__areas.local['sync-enabled'] = true;
  await config.set({timeout: 8}); // must not throw
  assert.equal(chrome.__areas.local.timeout, 8);
});

/* ---- functional: sync -> local mirror (worker only) ---- */

test('worker mirrors a sync change into local when sync is enabled', async () => {
  const {chrome} = loadConfig({worker: true});
  chrome.__areas.local['sync-enabled'] = true;
  await chrome.storage.sync.set({timeout: 21});
  assert.equal(chrome.__areas.local.timeout, 21);
});

test('worker does not mirror sync changes when sync is disabled', async () => {
  const {chrome} = loadConfig({worker: true});
  await chrome.storage.sync.set({timeout: 33});
  assert.equal(chrome.__areas.local.timeout, undefined);
});

test('non-worker context never mirrors sync into local', async () => {
  const {chrome} = loadConfig({worker: false});
  chrome.__areas.local['sync-enabled'] = true;
  await chrome.storage.sync.set({timeout: 44});
  assert.equal(chrome.__areas.local.timeout, undefined);
});

/* ---- functional: change notifications ---- */

test('config.changed fires for local changes only', async () => {
  const {config, chrome} = loadConfig();
  const seen = [];
  config.changed(changes => seen.push(Object.keys(changes)));
  await chrome.storage.local.set({timeout: 1});
  await chrome.storage.sync.set({timeout: 2});
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], ['timeout']);
});
