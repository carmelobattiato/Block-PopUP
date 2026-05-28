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
  'issue': true,
  'block-page-redirection': false,
  'block-automated-redirection': false,
  'block-page-redirection-hostnames': [],
  'block-page-redirection-same-origin': true,
  'scope': ['*://*/*'],
  'width': 420 // notification width in px
};

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

config.set = async prefs => chrome.storage.local.set(prefs);

config.changed = callback => chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    callback(changes);
  }
});
