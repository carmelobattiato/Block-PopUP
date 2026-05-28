/* global config, tldjs, URLPattern */

const $ = id => document.getElementById(id);

const page = {};

const match = (hostname, href) => {
  if (typeof URLPattern !== 'undefined') {
    try {
      if (new URLPattern({hostname}).test(href)) {
        return true;
      }
    }
    catch (e) {}
    try {
      if (new URLPattern({hostname: '*.' + hostname}).test(href)) {
        return true;
      }
    }
    catch (e) {}
  }
  else {
    try {
      const o = new URL(href);
      return hostname === o.hostname || hostname.endsWith('.' + o.hostname);
    }
    catch (e) {}
  }
};

const setSiteDisabled = disabled => {
  $('page').disabled = disabled;
  $('subs').disabled = disabled;
  $('page-row').classList.toggle('is-disabled', disabled);
  $('subs-row').classList.toggle('is-disabled', disabled);
};

/* ---------- Global toggle ---------- */
config.get(['enabled']).then(prefs => {
  $('global').checked = prefs.enabled;
  if (prefs.enabled === false) {
    setSiteDisabled(true);
  }
});

$('global').onchange = e => {
  config.set({
    enabled: e.target.checked
  });
  setSiteDisabled(e.target.checked === false);
};

/* ---------- Active tab: badge count + per-site state ---------- */
chrome.tabs.query({
  currentWindow: true,
  active: true
}, tabs => {
  if (!tabs.length) {
    return;
  }
  const tab = tabs[0];
  page.tabId = tab.id;

  // Blocked-on-this-tab count from the action badge
  chrome.action.getBadgeText({tabId: tab.id}, text => {
    const el = $('blocked-count');
    if (text === 'E') {
      el.textContent = '—';
    }
    else if (!text) {
      el.textContent = '0';
    }
    else {
      const n = parseInt(text, 10);
      el.textContent = Number.isNaN(n) ? '0' : String(n);
    }
  });

  // Buttons that message the content script
  $('allow-last-request').onclick = () => chrome.tabs.sendMessage(tab.id, {
    cmd: 'allow-last-request'
  }, () => window.close());

  $('deny-last-request').onclick = () => chrome.tabs.sendMessage(tab.id, {
    cmd: 'deny-last-request'
  }, () => window.close());

  // Per-site state
  chrome.scripting.executeScript({
    target: {
      tabId: tab.id
    },
    func: () => ({
      enabled: window.prefs?.enabled,
      hostname: location.hostname,
      href: location.href
    })
  }).then(async response => {
    const {enabled, hostname, href} = response[0].result;

    page.hostname = hostname;
    page.href = href;

    const host = $('site-host');
    if (hostname) {
      host.textContent = hostname;
    }

    if (enabled === true || enabled === false) {
      $('page').checked = enabled;
    }
    else {
      const prefs = await config.get(['top-hosts']);
      $('page').checked = prefs['top-hosts'].some(h => match(h, page.href)) ? false : true;
    }
  }).catch(() => {
    setSiteDisabled(true);
    $('site-host').textContent = 'unavailable here';
  });
});

/* ---------- Per-site toggle ---------- */
$('page').onchange = async e => {
  const prefs = await config.get(['top-hosts']);

  const rms = new Set();
  rms.add(tldjs.getDomain(page.hostname) || page.hostname);

  if ($('subs').checked) {
    try {
      const r = await chrome.scripting.executeScript({
        target: {
          tabId: page.tabId,
          allFrames: true
        },
        func: () => location.hostname
      });
      for (const o of r) {
        if (o?.result) {
          rms.add(tldjs.getDomain(o.result) || o.result);
        }
      }
    }
    catch (e) {}
  }

  if (e.target.checked) {
    for (const hostname of prefs['top-hosts']) {
      if (match(hostname, page.href)) {
        rms.add(hostname);
      }
    }
    prefs['top-hosts'] = prefs['top-hosts'].filter(s => rms.has(s) === false);
  }
  else {
    for (const d of rms) {
      prefs['top-hosts'].push(d);
    }
    prefs['top-hosts'] = prefs['top-hosts'].filter((s, i, l) => s && l.indexOf(s) === i);
  }

  config.set(prefs).then(() => chrome.tabs.reload());
};

/* ---------- Footer ---------- */
$('options').onclick = () => chrome.runtime.openOptionsPage(() => window.close());
