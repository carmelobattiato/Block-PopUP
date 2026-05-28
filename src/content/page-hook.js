/* Block PopUP — MAIN-world page hook.
 *
 * Wraps the APIs a page uses to spawn a new browsing context (window.open,
 * anchor/area clicks with a target, programmatic clicks and form submits) and
 * asks the privileged ISOLATED world for a verdict through a shared hidden
 * element. The answer is delivered synchronously (via attributes set during a
 * CustomEvent dispatch) so window.open() can return a placeholder immediately.
 *
 * Independent implementation (MIT). It shares only an internal event/attribute
 * protocol with blocker.js; both files belong to this project.
 */
(() => {
  'use strict';

  /* shared, invisible relay element (blocker.js attaches to the same node) */
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

  const armed = () => relay.dataset.enabled !== 'false';
  const usePlaceholderFrame = () => relay.dataset.shadow === 'true';

  /* synchronous request -> verdict */
  const consult = detail => {
    relay.dispatchEvent(new CustomEvent('pp-ask', {detail}));
    return {
      id: relay.getAttribute('pp-id'),
      blocked: relay.getAttribute('pp-blocked') === '1'
    };
  };

  const journal = (id, path, op) =>
    relay.dispatchEvent(new CustomEvent('pp-log', {detail: {id, tree: path, action: op}}));

  /* a placeholder window that journals everything the page does to it, so the
     real popup can be reconstructed verbatim if the user later allows it. The
     live `window` is used purely as a read-only type oracle (call vs. nested
     object vs. value) and is never actually invoked. */
  const placeholder = (id, oracle, path = []) => new Proxy(function () {}, {
    get(_t, key) {
      if (key === 'closed') {
        return false;
      }
      if (key === Symbol.toPrimitive || key === 'toString' || key === 'valueOf') {
        return () => '';
      }
      let sample;
      try {
        sample = oracle ? oracle[key] : undefined;
      }
      catch (e) { /* cross-origin etc. */ }
      if (typeof sample === 'function') {
        return (...args) => {
          journal(id, path, {method: key, args});
        };
      }
      if (sample && typeof sample === 'object') {
        return placeholder(id, sample, [...path, key]);
      }
      return sample;
    },
    set(_t, key, value) {
      journal(id, path, {prop: key, value});
      return true;
    },
    apply() {
      return placeholder(id, oracle, path);
    }
  });

  /* does a target attribute point to a *new* browsing context? */
  const escapes = target => {
    const t = (target || '').toLowerCase();
    return t !== '' && t !== '_self' && t !== '_top' && t !== '_parent';
  };

  /* ---- window.open ---- */
  const nativeOpen = window.open;
  window.open = new Proxy(nativeOpen, {
    apply(target, self, args) {
      if (!armed()) {
        return Reflect.apply(target, self, args);
      }
      const name = args[1];
      if (typeof name === 'string' && name && window.frames[name]) {
        return Reflect.apply(target, self, args); // targeting an existing frame
      }
      const {id, blocked} = consult({kind: 'open', href: String(args[0] ?? ''), args});
      if (!blocked) {
        return Reflect.apply(target, self, args);
      }
      if (usePlaceholderFrame()) {
        const frame = document.createElement('iframe');
        frame.style.display = 'none';
        (document.body || document.documentElement).appendChild(frame);
        return frame.contentWindow;
      }
      return placeholder(id, window);
    }
  });

  /* ---- user clicks that reach an anchor/area opening a new context ---- */
  const handleClick = e => {
    if (!armed()) {
      return;
    }
    const el = e.target.closest && e.target.closest('a[target], area[target], a[href]');
    if (!el || !escapes(el.target)) {
      return;
    }
    const {blocked} = consult({
      kind: 'click',
      href: el.href || el.getAttribute('href') || '',
      target: el.target,
      download: el.tagName === 'A' && el.hasAttribute('download'),
      tag: el.tagName,
      prevented: e.defaultPrevented,
      modifier: e.metaKey || e.ctrlKey,
      button: e.button || 0,
      trusted: e.isTrusted
    });
    if (blocked) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const wire = doc => doc.addEventListener('click', handleClick, true);
  wire(document);

  /* ---- programmatic anchor.click() ---- */
  const anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = new Proxy(anchorClick, {
    apply(target, self, args) {
      if (armed() && escapes(self.target)) {
        const {blocked} = consult({
          kind: 'click', href: self.href, target: self.target,
          download: self.hasAttribute('download'), tag: 'A', trusted: false
        });
        if (blocked) {
          return undefined;
        }
      }
      return Reflect.apply(target, self, args);
    }
  });

  /* ---- anchor.dispatchEvent for click-like synthetic events ---- */
  const anchorDispatch = HTMLAnchorElement.prototype.dispatchEvent;
  HTMLAnchorElement.prototype.dispatchEvent = new Proxy(anchorDispatch, {
    apply(target, self, args) {
      const ev = args[0];
      const clickish = ev && ['click', 'auxclick', 'dblclick'].includes(ev.type);
      if (clickish && armed() && escapes(self.target)) {
        const {blocked} = consult({kind: 'click', href: self.href, target: self.target, tag: 'A', trusted: !!ev.isTrusted});
        if (blocked) {
          return false;
        }
      }
      return Reflect.apply(target, self, args);
    }
  });

  /* ---- form submissions into a new context ---- */
  const formSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = new Proxy(formSubmit, {
    apply(target, self, args) {
      if (armed() && escapes(self.target)) {
        const {blocked} = consult({kind: 'form', href: self.action, target: self.target, tag: 'FORM', trusted: false});
        if (blocked) {
          return undefined;
        }
      }
      return Reflect.apply(target, self, args);
    }
  });

  const formDispatch = HTMLFormElement.prototype.dispatchEvent;
  HTMLFormElement.prototype.dispatchEvent = new Proxy(formDispatch, {
    apply(target, self, args) {
      const ev = args[0];
      if (ev && ev.type === 'submit' && armed() && escapes(self.target)) {
        const {blocked} = consult({kind: 'form', href: self.action, target: self.target, tag: 'FORM', trusted: !!ev.isTrusted});
        if (blocked) {
          return false;
        }
      }
      return Reflect.apply(target, self, args);
    }
  });

  /* document.write() can replace the whole DOM and drop our click listener */
  const write = Document.prototype.write;
  let rootEl = document.documentElement;
  Document.prototype.write = new Proxy(write, {
    apply(target, self, args) {
      const result = Reflect.apply(target, self, args);
      if (self.documentElement !== rootEl) {
        rootEl = self.documentElement;
        wire(self);
      }
      return result;
    }
  });
})();
