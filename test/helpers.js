'use strict';

/* Test helpers: run the extension's classic scripts (config.js, history.js)
 * inside a vm sandbox with an in-memory chrome.* mock, so they can be tested
 * in Node with no browser and no external dependencies. */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/* a minimal, in-memory chrome.storage with onChanged, used by the scripts.
   set() awaits all listeners so async mirror logic settles before we assert. */
function makeChrome(opts = {}) {
  const areas = {local: {}, sync: {}, session: {}};
  const listeners = [];

  const mkArea = name => ({
    async get(req) {
      const store = areas[name];
      if (req == null) {
        return {...store};
      }
      if (Array.isArray(req)) {
        const o = {};
        for (const k of req) {
          if (k in store) {
            o[k] = store[k];
          }
        }
        return o;
      }
      if (typeof req === 'object') {
        const o = {};
        for (const k in req) {
          o[k] = (k in store) ? store[k] : req[k];
        }
        return o;
      }
      if (typeof req === 'string') {
        return (req in store) ? {[req]: store[req]} : {};
      }
      return {...store};
    },
    async set(obj) {
      if (name === 'sync' && opts.syncThrows) {
        throw new Error('QUOTA_BYTES quota exceeded');
      }
      const store = areas[name];
      const changes = {};
      for (const k in obj) {
        changes[k] = {oldValue: store[k], newValue: obj[k]};
        store[k] = obj[k];
      }
      await Promise.all(listeners.map(l => l(changes, name)));
    }
  });

  return {
    __areas: areas,
    __listeners: listeners,
    storage: {
      local: mkArea('local'),
      sync: mkArea('sync'),
      session: mkArea('session'),
      onChanged: {addListener: cb => listeners.push(cb)}
    }
  };
}

/* load a classic (non-module) script into a sandbox; `expose` lists top-level
   const names to surface on the sandbox global for assertions. */
function loadClassic(relFromRoot, sandbox, expose = []) {
  let code = fs.readFileSync(path.join(__dirname, '..', relFromRoot), 'utf8');
  if (expose.length) {
    code += '\n;' + expose.map(n => `globalThis.${n}=typeof ${n}!=="undefined"?${n}:undefined;`).join('');
  }
  const context = vm.createContext(sandbox);
  vm.runInContext(code, context, {filename: relFromRoot});
  return sandbox;
}

const tick = () => new Promise(r => setTimeout(r, 0));

module.exports = {makeChrome, loadClassic, tick};
