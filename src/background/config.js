'use strict';

/* Shared preferences (classic script: loaded by the service worker via
   importScripts and injected alongside the ISOLATED content script).
   All values live in chrome.storage.local. */

const config = {
  'enabled': true,
  'numbers': 2,
  'timeout': 5,
  'default-action': 'popup-close',
  'simulate-allow': true,
  'focus-popup': false,
  'domain': false, // allow popups from the same domain
  'badge': true,
  'badge-color': '#6e6e6e',
  'whitelist-mode': 'popup-hosts',
  'placement': 'tr',
  // these hostnames may open popups on every website
  'popup-hosts': [
    'google.com', 'bing.com', 't.co', 'twitter.com', 'disqus.com', 'login.yahoo.com',
    'mail.google.com', 'doubleclick.net'
  ],
  // the blocker is disabled on these hostnames
  'top-hosts': ['github.com', 'twitter.com', 'webextension.org', 'google.com', 'paypal.com'],
  // accepted protocols (never blocked)
  'protocols': ['magnet:'],
  // hostnames where the notification UI is suppressed (counter only)
  'silent': [],
  // popup-source hostnames that are silently blocked (no UI, counter only)
  'block-hosts': [],
  // ad domains blocked per visited site: { siteBaseDomain: [adDomain, ...] }
  'ad-hosts': {},
  'issue': true,
  'block-page-redirection': false,
  'block-automated-redirection': false,
  'block-page-redirection-hostnames': [],
  'block-page-redirection-same-origin': true,
  'scope': ['*://*/*'],
  'width': 420, // notification width in px
  'sync-enabled': false // mirror settings via chrome.storage.sync (device-local flag)
};

/* keys that must never travel to chrome.storage.sync (device-specific) */
const NO_SYNC = new Set(['sync-enabled']);

/* read a list of keys (returns stored value or default); no args → everything */
config.get = async keys => {
  if (Array.isArray(keys) && keys.length) {
    const request = {};
    for (const key of keys) {
      request[key] = config[key];
    }
    return chrome.storage.local.get(request);
  }
  return chrome.storage.local.get(null);
};

/* hydrate an existing object in place with stored values for its keys */
config.update = async prefs => {
  const stored = await chrome.storage.local.get(prefs);
  Object.assign(prefs, stored);
};

/* write to local; mirror to sync when the user enabled syncing */
config.set = async prefs => {
  await chrome.storage.local.set(prefs);
  const {'sync-enabled': on} = await chrome.storage.local.get({'sync-enabled': config['sync-enabled']});
  if (on) {
    const out = {};
    for (const key in prefs) {
      if (!NO_SYNC.has(key)) {
        out[key] = prefs[key];
      }
    }
    if (Object.keys(out).length) {
      try {
        await chrome.storage.sync.set(out);
      }
      catch (e) { /* sync quota exceeded / unavailable: local copy still saved */ }
    }
  }
};

/* push every current preference to sync (used when sync is switched on).
   Returns false if the sync quota rejected the write. */
config.pushAllToSync = async () => {
  const all = await chrome.storage.local.get(null);
  const out = {};
  for (const key in config) {
    if (typeof config[key] === 'function' || NO_SYNC.has(key)) {
      continue;
    }
    out[key] = (key in all) ? all[key] : config[key];
  }
  try {
    await chrome.storage.sync.set(out);
    return true;
  }
  catch (e) {
    return false;
  }
};

config.changed = callback => chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    callback(changes);
  }
});

/* Mirror sync -> local in the service worker ONLY (importScripts is defined
   only in the worker scope, not in pages or content scripts). This avoids
   every tab racing to write the same values. Writing local here does NOT call
   config.set, so it never loops back to sync. */
if (typeof importScripts !== 'undefined') {
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'sync') {
      return;
    }
    const {'sync-enabled': on} = await chrome.storage.local.get({'sync-enabled': config['sync-enabled']});
    if (!on) {
      return;
    }
    const out = {};
    for (const key in changes) {
      if (!NO_SYNC.has(key)) {
        out[key] = changes[key].newValue;
      }
    }
    if (Object.keys(out).length) {
      chrome.storage.local.set(out);
    }
  });
}
