/* Block PopUP — pure block-decision policy.
 *
 * No DOM, no chrome.* — only data in, verdict out. This makes the core
 * blocking rules unit-testable in Node while the same file loads as a classic
 * content script (exposing `self.PPolicy`) inside the ISOLATED world.
 *
 * Independent implementation (MIT).
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  else {
    root.PPolicy = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* a host matches an entry when it is the entry, a sub-domain of it, or a
     parent of it (so "example.com" covers "ads.example.com" and vice-versa) */
  function matchesHost(host, list) {
    return list.some(h => host === h || host.endsWith('.' + h) || h.endsWith('.' + host));
  }

  /* Decide whether a new-context request should be blocked.
   *
   * req      — {kind, target, prevented, modifier, trusted, tag, download, href}
   * settings — {protocols:[], 'popup-hosts':[], domain:bool}
   * env      — {absolute(href)->href, frameExists(name)->bool, topHostname()->string}
   *
   * Returns {href, hostname, block}. Pure: env supplies every side effect.
   */
  function verdict(req, settings, env) {
    let href = req.href || '';
    let block = true;

    if (req.kind !== 'open' && env.frameExists(req.target)) {
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
      href = env.absolute(href);
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
            const top = env.topHostname();
            if (top && hostname && matchesHost(hostname, [top])) {
              block = false;
            }
          }
        }
        catch (e) { /* unparsable href (e.g. about:blank) -> keep blocking */ }
      }
    }

    return {href, hostname, block};
  }

  return {matchesHost, verdict};
});
