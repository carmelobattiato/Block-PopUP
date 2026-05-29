/* global chrome */

/* Block PopUP — per-tab blocked-popup history (service worker).
 *
 * Keeps the most recent blocked requests per tab in memory, mirrored to
 * chrome.storage.session so the list survives service-worker restarts within
 * the same browser session. Reset on top-frame navigation, dropped on close.
 */
const blockHistory = (() => {
  'use strict';

  const MAX = 25;
  const KEY = 'pp-history'; // session key -> { [tabId]: entries[] }
  const mem = new Map();    // tabId(number) -> entries[]
  let loaded = false;

  const persist = () => {
    const obj = {};
    for (const [k, v] of mem) {
      obj[k] = v;
    }
    try {
      chrome.storage.session.set({[KEY]: obj});
    }
    catch (e) { /* session storage unavailable */ }
  };

  const ready = async () => {
    if (loaded) {
      return;
    }
    try {
      const got = await chrome.storage.session.get(KEY);
      const obj = got[KEY] || {};
      for (const k in obj) {
        mem.set(Number(k), obj[k]);
      }
    }
    catch (e) { /* ignore */ }
    loaded = true;
  };

  return {
    async add(tabId, entry) {
      if (typeof tabId !== 'number') {
        return;
      }
      await ready();
      const list = mem.get(tabId) || [];
      list.push(entry);
      while (list.length > MAX) {
        list.shift();
      }
      mem.set(tabId, list);
      persist();
    },
    async get(tabId) {
      await ready();
      return mem.get(tabId) || [];
    },
    async clear(tabId) {
      await ready();
      if (mem.delete(tabId)) {
        persist();
      }
    }
  };
})();
