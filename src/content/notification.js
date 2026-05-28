/* global config */

/* Block PopUP — in-page notification overlay (ISOLATED world content script).
   Rendered only in the top frame inside a closed Shadow DOM, fully isolated
   from the host page. The service worker relays a 'show-notification' message
   to frameId 0; this module renders a card and forwards the user's choice back
   to the worker (which routes record/replay to the originating frameId). */
{
  'use strict';

  const isTop = window.top === window;

  /* safe send: swallow "Extension context invalidated" on orphaned scripts */
  const send = message => {
    try {
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage(message);
      }
    }
    catch (e) {}
  };

  /* preferences (loaded lazily on first notification) */
  const prefs = {
    'timeout': 30,
    'numbers': 5,
    'default-action': 'ignore',
    'placement': 'tr',
    'width': 420,
    'focus-popup': false
  };
  let prefsReady = false;
  const loadPrefs = async () => {
    if (!prefsReady) {
      Object.assign(prefs, await config.get(Object.keys(prefs)));
      prefsReady = true;
    }
  };

  const isHTTP = url => /^(https?|ftp):/i.test(url || '');

  /* ---- shadow host ---- */
  let host = null;
  let root = null;
  let stack = null;

  const CSS = `
:host, * { box-sizing: border-box; }
.stack {
  display: flex; flex-direction: column; gap: 10px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.card {
  --accent: #2f6df6;
  --danger: #e5484d;
  --surface: #ffffff;
  --text: #1c1f24;
  --muted: #6b7280;
  --line: rgba(16, 24, 40, .10);
  --btn: rgba(16, 24, 40, .05);
  position: relative;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: 0 10px 34px rgba(16, 24, 40, .16);
  outline: none;
  animation: pp-in .18s cubic-bezier(.2, .7, .3, 1) both;
}
.card:focus-visible { box-shadow: 0 10px 34px rgba(16, 24, 40, .16), 0 0 0 2px var(--accent); }
@media (prefers-color-scheme: dark) {
  .card {
    --surface: #1c2128;
    --text: #e6e8ec;
    --muted: #9aa3b2;
    --line: rgba(255, 255, 255, .10);
    --btn: rgba(255, 255, 255, .07);
    box-shadow: 0 10px 34px rgba(0, 0, 0, .5);
  }
}
@media (prefers-reduced-motion: reduce) { .card { animation: none; } }
.head { display: flex; align-items: center; gap: 9px; padding: 9px 12px 5px; }
.dot {
  width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--danger);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 22%, transparent);
}
.title { flex: 1; font-size: 12.5px; font-weight: 650; letter-spacing: .1px; }
.count {
  min-width: 17px; height: 17px; padding: 0 5px; border-radius: 9px;
  background: var(--danger); color: #fff; font-size: 10.5px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
}
.count[hidden] { display: none; }
.url {
  padding: 0 12px 9px; margin: 0; font-size: 11.5px; line-height: 1.35; color: var(--muted);
  word-break: break-all; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  max-height: 2.9em;
}
.actions { display: flex; align-items: center; gap: 6px; padding: 0 12px 11px; }
.btn {
  height: 24px; padding: 0 10px; border: 1px solid var(--line); border-radius: 7px;
  background: var(--btn); color: var(--text); font-size: 11.5px; font-weight: 600; cursor: pointer;
  white-space: nowrap; transition: filter .12s, background .12s;
}
.btn:hover { filter: brightness(.97); }
.btn[disabled] { opacity: .45; cursor: not-allowed; }
.btn.counting { box-shadow: 0 0 0 2px var(--accent); }
.btn.primary { background: var(--accent); border-color: transparent; color: #fff; }
.btn.danger { background: var(--danger); border-color: transparent; color: #fff; }
.btn.primary:hover, .btn.danger:hover { filter: brightness(1.06); }
.spacer { flex: 1; }
.more { position: relative; }
.more-btn { width: 28px; padding: 0; font-size: 14px; line-height: 1; }
.menu {
  position: absolute; min-width: 184px;
  background: var(--surface); border: 1px solid var(--line); border-radius: 11px;
  box-shadow: 0 10px 28px rgba(16, 24, 40, .22); padding: 5px; z-index: 2; display: none;
}
.menu.open { display: block; }
/* a card with its menu open floats above cards that appear afterwards */
.card:has(.menu.open) { position: relative; z-index: 5; }
/* open away from the screen edge the card is pinned to */
.v-top .menu { top: calc(100% + 6px); }      /* card near the top -> menu drops down */
.v-bottom .menu { bottom: calc(100% + 6px); } /* card near the bottom -> menu pops up */
.h-right .menu { right: 0; }
.h-left .menu { left: 0; }
.menu button {
  display: flex; width: 100%; align-items: center; gap: 8px; padding: 7px 10px; border: 0; border-radius: 7px;
  background: transparent; color: var(--text); font-size: 12px; font-weight: 550; cursor: pointer; text-align: left;
}
.menu button:hover { background: var(--btn); }
.menu button[disabled] { opacity: .4; cursor: not-allowed; }
@keyframes pp-in { from { opacity: 0; transform: translateY(-6px) scale(.98); } to { opacity: 1; transform: none; } }
`;

  const placementSides = p => ({
    vert: (p || 'tr').includes('b') ? 'bottom' : 'top',
    horiz: (p || 'tr').includes('l') ? 'left' : 'right'
  });

  function mount() {
    if (host && host.isConnected) {
      return;
    }
    host = document.createElement('div');
    host.setAttribute('data-pp-blocker', '');
    const {vert, horiz} = placementSides(prefs.placement);
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'z-index: 2147483647',
      vert + ': 14px',
      horiz + ': 14px',
      'width: ' + Math.max(300, prefs.width || 420) + 'px',
      'max-width: calc(100vw - 28px)'
    ].join(';');
    root = host.attachShadow({mode: 'closed'});
    const style = document.createElement('style');
    style.textContent = CSS;
    stack = document.createElement('div');
    stack.className = 'stack ' +
      (vert === 'top' ? 'v-top' : 'v-bottom') + ' ' +
      (horiz === 'left' ? 'h-left' : 'h-right');
    root.append(style, stack);
    root.addEventListener('keydown', onKeydown);
    (document.documentElement || document.body).appendChild(host);
  }

  function unmount() {
    if (host) {
      host.remove();
      host = null;
      root = null;
      stack = null;
    }
  }

  /* ---- entries ---- */
  const entries = new Map(); // key -> card

  const lastCard = () => {
    let last = null;
    for (const c of entries.values()) {
      last = c;
    }
    return last;
  };

  function el(tag, props = {}, ...kids) {
    const node = Object.assign(document.createElement(tag), props);
    for (const k of kids) {
      node.append(k);
    }
    return node;
  }

  function buildCard(req, key) {
    const card = {req, key, count: 1, timer: null, ticking: false, hover: false};
    const usableUrl = isHTTP(req.href);

    const count = el('span', {className: 'count', textContent: '1', hidden: true});
    const head = el('div', {className: 'head'},
      el('span', {className: 'dot'}),
      el('span', {className: 'title', textContent: 'Popup blocked'}),
      count);

    const url = el('p', {className: 'url', textContent: req.href || '(no address)', title: req.href || ''});

    const allow = el('button', {className: 'btn primary', textContent: 'Allow'});
    const block = el('button', {className: 'btn danger', textContent: 'Block', title: 'Always block this site', disabled: !req.hostname});
    const close = el('button', {className: 'btn', textContent: 'Close', title: 'Dismiss (stays blocked)'});
    const moreBtn = el('button', {className: 'btn more-btn', textContent: '⋯', title: 'More actions'});

    const mkItem = (label, disabled) => el('button', {textContent: label, disabled: !!disabled});
    const openTab = mkItem('Open in background tab', !usableUrl);
    const openHere = mkItem('Open in this tab', !usableUrl);
    const allowSite = mkItem('Always allow this site', !usableUrl);
    const menu = el('div', {className: 'menu'}, openTab, openHere, allowSite);

    const more = el('div', {className: 'more'}, moreBtn, menu);
    const actions = el('div', {className: 'actions'}, allow, block, close, el('span', {className: 'spacer'}), more);

    const node = el('div', {className: 'card', tabIndex: -1}, head, url, actions);
    card.el = node;
    card.badge = count;
    card.btns = {allow, block, close, more: moreBtn};

    /* interactions */
    const stopTick = () => stopTimer(card);
    close.onclick = () => dismiss(card);
    allow.onclick = e => { stopTick(); perform(card, 'allow', e.isTrusted); };
    block.onclick = () => { stopTick(); perform(card, 'block-site'); };
    openTab.onclick = () => { stopTick(); perform(card, 'tab'); };
    openHere.onclick = () => { stopTick(); perform(card, 'here'); };
    allowSite.onclick = () => { stopTick(); perform(card, 'allow-site'); };
    moreBtn.onclick = e => {
      e.stopPropagation();
      menu.classList.toggle('open');
    };
    node.addEventListener('mouseenter', () => { card.hover = true; });
    node.addEventListener('mouseleave', () => { card.hover = false; });
    node.addEventListener('click', () => menu.classList.remove('open'));

    return card;
  }

  /* the configured default action, applied when the countdown ends */
  const DEFAULT_ACTION = {
    'popup-close': card => dismiss(card),
    'block-host': card => perform(card, 'block-site'),
    'open-tab': card => perform(card, 'tab'),
    'popup-redirect': card => perform(card, 'here')
  };

  // resolve the default action for this card: which button to mark + what to run
  function resolveDefault(card) {
    const da = prefs['default-action'];
    const run = DEFAULT_ACTION[da];
    if (!run) {
      return null;
    }
    let ok = false;
    let button = null;
    if (da === 'popup-close') {
      ok = true;
      button = card.btns.close;
    }
    else if (da === 'block-host') {
      ok = Boolean(card.req.hostname);
      button = card.btns.block;
    }
    else if (da === 'open-tab' || da === 'popup-redirect') {
      ok = isHTTP(card.req.href);
      button = card.btns.more; // the action lives in the "More" menu
    }
    return ok ? {run, button} : null;
  }

  function startTimer(card) {
    if (!(prefs.timeout > 0)) {
      return;
    }
    const def = resolveDefault(card);

    // no applicable default action -> silent auto-dismiss
    if (!def) {
      card.timer = setTimeout(() => (card.hover ? startTimer(card) : dismiss(card)), prefs.timeout * 1000);
      return;
    }

    // visible countdown on the target button + highlight ring
    const button = def.button;
    const base = button.dataset.base ?? (button.dataset.base = button.textContent);
    button.classList.add('counting');
    let left = prefs.timeout;
    button.textContent = base + ' (' + left + ')';
    card.timer = setInterval(() => {
      if (card.hover) {
        return; // pause while the pointer is over the card
      }
      left -= 1;
      if (left > 0) {
        button.textContent = base + ' (' + left + ')';
      }
      else {
        stopTimer(card);
        def.run(card);
      }
    }, 1000);
  }

  function stopTimer(card) {
    clearTimeout(card.timer);
    clearInterval(card.timer);
    card.timer = null;
    // restore any button that was showing the countdown
    if (card.btns) {
      for (const b of Object.values(card.btns)) {
        if (b.classList.contains('counting')) {
          b.classList.remove('counting');
          if (b.dataset.base !== undefined) {
            b.textContent = b.dataset.base;
            delete b.dataset.base;
          }
        }
      }
    }
  }

  function enforceLimit() {
    const max = Math.max(1, prefs.numbers || 5);
    while (entries.size > max) {
      const oldest = entries.values().next().value;
      dismiss(oldest);
    }
  }

  function add(req) {
    if (!isTop) {
      return;
    }
    mount();
    const key = (req.href && req.href !== 'about:blank') ? req.href : req.id;
    const existing = entries.get(key);
    if (existing) {
      existing.count += 1;
      existing.badge.textContent = existing.count;
      existing.badge.hidden = existing.count < 2;
      stopTimer(existing);
      startTimer(existing);
      return;
    }
    const card = buildCard(req, key);
    entries.set(key, card);
    stack.appendChild(card.el);
    enforceLimit();
    if (prefs['focus-popup']) {
      card.el.focus();
    }
    startTimer(card);
  }

  function remove(card) {
    stopTimer(card);
    card.el.remove();
    entries.delete(card.key);
    if (entries.size === 0) {
      unmount();
    }
  }

  function dismiss(card) {
    remove(card); // popup stays blocked; just close the card
  }

  function perform(card, action, trusted = true) {
    const {href, hostname, id, frameId} = card.req;
    if (action === 'allow') {
      send({cmd:'popup-accepted', id, url: href, frameId, sameContext: trusted});
    }
    else if (action === 'tab') {
      send({cmd:'open-tab', url: href});
    }
    else if (action === 'here') {
      send({cmd:'popup-redirect', url: href});
    }
    else if (action === 'allow-site') {
      send({cmd:'white-list', url: href, parent: location.href});
    }
    else if (action === 'block-site') {
      send({cmd:'block-host', hostname});
    }
    remove(card);
  }

  /* keyboard inside the overlay */
  function onKeydown(e) {
    if (e.key === 'Escape') {
      const focused = root.activeElement?.closest?.('.card');
      const target = [...entries.values()].find(c => c.el === focused) || lastCard();
      if (target) {
        e.preventDefault();
        dismiss(target);
      }
    }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const cards = [...entries.values()];
      if (!cards.length) {
        return;
      }
      e.preventDefault();
      const focused = root.activeElement?.closest?.('.card');
      let i = cards.findIndex(c => c.el === focused);
      i = e.key === 'ArrowDown' ? Math.min(cards.length - 1, i + 1) : Math.max(0, i - 1);
      cards[i].el.focus();
    }
  }

  /* worker-driven keyboard commands act on the most recent card */
  const COMMAND = {
    'allow-last-request': c => perform(c, 'allow'),
    'deny-last-request': c => dismiss(c),
    'background-last-request': c => perform(c, 'tab'),
    'redirect-last-request': c => perform(c, 'here'),
    'focus-last-request': c => c.el.focus()
  };

  chrome.runtime.onMessage.addListener(request => {
    if (request.cmd === 'show-notification') {
      loadPrefs().then(() => add(request));
    }
    else if (isTop && COMMAND[request.cmd]) {
      const card = lastCard();
      if (card) {
        COMMAND[request.cmd](card);
      }
    }
  });
}
