/* global config, navigation */

/* Block PopUP — ISOLATED world.
 *
 * Owns the (synchronous) block decision, the short page-redirect guard, the
 * record store used to reconstruct an allowed popup, the toolbar state ping,
 * and messaging with the service worker.
 *
 * Independent implementation (MIT). Shares an internal event/attribute
 * protocol with page-hook.js and the message/record shapes with the worker.
 */
(() => {
  'use strict';

  const isTop = window.top === window;

  /* shared relay element (page-hook.js attaches to the same node) */
  const relay = (() => {
    const ID = 'ppop-port';
    let node = document.getElementById(ID);
    if (!node) {
      node = document.createElement('span');
      node.id = ID;
      node.style.display = 'none';
      (document.documentElement || document).appendChild(node);
    }
    return node;
  })();

  /* messaging that tolerates an orphaned content script after a reload */
  const send = (message, callback) => {
    try {
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage(message, callback);
      }
    }
    catch (e) { /* extension context invalidated */ }
  };

  /* enabled state — also exposed on window.prefs for the toolbar panel */
  const state = (window.prefs = {enabled: true});
  const setEnabled = on => {
    state.enabled = on === true;
    relay.dataset.enabled = state.enabled ? 'true' : 'false';
    if (isTop) {
      send({cmd: 'state', active: state.enabled});
    }
  };
  try {
    relay.dataset.enabled = 'true';
  }
  catch (e) { /* SVG/XML document */ }
  if (isTop) {
    send({cmd: 'state', active: true});
  }

  /* preferences that shape the verdict */
  const settings = {'domain': false, 'protocols': ['magnet:'], 'popup-hosts': []};

  /* short-lived guard that blocks a fallback page redirect right after a
     popup was denied (and optionally automated redirects) */
  const guard = {
    cfg: {
      'block-page-redirection': false,
      'block-automated-redirection': false,
      'block-page-redirection-same-origin': true,
      'block-page-redirection-hostnames': []
    },
    target: '',
    timer: null,
    onUnload(e) {
      try {
        const u = new URL(guard.target);
        if (guard.cfg['block-page-redirection-same-origin'] && u.origin === location.origin) {
          return; // same-origin navigation is allowed
        }
        if (guard.cfg['block-page-redirection-hostnames'].includes(u.hostname)) {
          return; // explicitly allowed destination
        }
      }
      catch (e) { /* unknown target -> block to be safe */ }
      e.preventDefault();
      e.returnValue = '';
    },
    arm() {
      if (isTop && guard.cfg['block-page-redirection']) {
        addEventListener('beforeunload', guard.onUnload, true);
        clearTimeout(guard.timer);
        guard.timer = setTimeout(guard.disarm, 2000);
      }
    },
    disarm() {
      removeEventListener('beforeunload', guard.onUnload, true);
      clearTimeout(guard.timer);
    }
  };

  config.update(settings);
  config.update(guard.cfg);
  config.get(['enabled']).then(p => setEnabled(p.enabled));
  config.changed(changes => {
    if (changes.enabled) {
      setEnabled(changes.enabled.newValue);
    }
    for (const key in settings) {
      if (changes[key]) {
        settings[key] = changes[key].newValue;
      }
    }
    for (const key in guard.cfg) {
      if (changes[key]) {
        guard.cfg[key] = changes[key].newValue;
      }
    }
  });

  if (typeof navigation !== 'undefined' && isTop) {
    navigation.addEventListener('navigate', ev => {
      guard.target = (ev.destination && ev.destination.url) || '';
      if (guard.cfg['block-automated-redirection'] && ev.userInitiated === false) {
        guard.arm();
      }
    });
  }

  /* recorded operations of placeholder windows, keyed by request id */
  const store = {};

  const newId = () => Math.random().toString(36).slice(2);

  const absolute = href => {
    if (href && !href.includes(':')) {
      try {
        const a = document.createElement('a');
        a.setAttribute('href', href);
        return a.href;
      }
      catch (e) { /* ignore */ }
    }
    return href;
  };

  const matchesHost = (host, list) =>
    list.some(h => host === h || host.endsWith('.' + h) || h.endsWith('.' + host));

  const namesExistingFrame = name => {
    if (!name) {
      return false;
    }
    const n = name.toLowerCase();
    if (n === '_self' || n === '_top' || n === '_parent') {
      return true;
    }
    try {
      if (window[name] && typeof window[name] === 'object') {
        return true;
      }
    }
    catch (e) { /* ignore */ }
    try {
      if (parent[name] && typeof parent[name] === 'object') {
        return true;
      }
    }
    catch (e) { /* cross-origin */ }
    return false;
  };

  /* decide whether a new-context request should be blocked */
  const decide = req => {
    let href = req.href || '';
    let block = true;

    if (req.kind !== 'open' && namesExistingFrame(req.target)) {
      block = false; // really a frame navigation
    }
    if (req.prevented) {
      block = false; // the page already handled the event
    }
    if (req.modifier && req.trusted) {
      block = false; // deliberate ctrl/cmd-click to open a new tab
    }
    if (req.tag === 'A' && req.download) {
      block = false; // a download, not a popup
    }

    let hostname = '';
    if (block) {
      href = absolute(href);
      if (href) {
        try {
          const u = new URL(href);
          hostname = u.hostname;
          if (settings.protocols.includes(u.protocol)) {
            block = false;
          }
          if (block && hostname && matchesHost(hostname, settings['popup-hosts'])) {
            block = false;
          }
          if (block && settings.domain) {
            try {
              const top = window.top.location.hostname;
              if (top && hostname && matchesHost(hostname, [top])) {
                block = false;
              }
            }
            catch (e) { /* cross-origin top */ }
          }
        }
        catch (e) { /* unparsable href (e.g. about:blank) -> keep blocking */ }
      }
    }

    const id = newId();
    if (req.kind === 'open') {
      store[id] = [];
      store[id].args = req.args;
    }
    return {id, href, hostname, block};
  };

  /* answer the MAIN-world hook synchronously */
  relay.addEventListener('pp-ask', e => {
    e.stopPropagation();
    if (e.target !== relay) {
      return;
    }
    if (!state.enabled) {
      relay.setAttribute('pp-blocked', '0');
      return;
    }
    const detail = e.detail || {};
    const {id, href, hostname, block} = decide(detail);
    relay.setAttribute('pp-id', id);
    relay.setAttribute('pp-blocked', block ? '1' : '0');
    if (block) {
      guard.arm();
      send({cmd: 'popup-request', type: detail.kind || '', href, hostname, id});
    }
  });

  /* collect the placeholder-window operations for later replay */
  relay.addEventListener('pp-log', e => {
    e.stopPropagation();
    const d = e.detail || {};
    if (store[d.id]) {
      store[d.id].push({tree: d.tree, action: d.action});
    }
  });

  /* commands from the service worker */
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.cmd === 'popup-accepted') {
      const records = store[message.id];
      relay.dataset.enabled = 'false'; // let the reconstructed popup through
      send({
        cmd: 'run-records',
        url: message.url,
        records,
        args: (records && records.args) || []
      }, () => {
        delete store[message.id];
        relay.dataset.enabled = state.enabled ? 'true' : 'false';
      });
    }
    else if (message.cmd === 'use-shadow') {
      relay.dataset.shadow = 'true';
    }
    else if (message.cmd === 'release-beforeunload') {
      guard.disarm();
      if (reply) {
        reply(true);
      }
    }
  });
})();
