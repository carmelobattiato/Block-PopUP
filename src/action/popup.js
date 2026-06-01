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

const timeAgo = ts => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) {
    return 'just now';
  }
  if (s < 60) {
    return s + 's ago';
  }
  const m = Math.round(s / 60);
  if (m < 60) {
    return m + 'm ago';
  }
  return Math.round(m / 60) + 'h ago';
};

const renderHistory = list => {
  const ul = $('recent-list');
  const countEl = $('recent-count');
  const clear = $('clear-history');
  ul.textContent = '';

  if (!list.length) {
    countEl.textContent = '';
    clear.hidden = true;
    const li = document.createElement('li');
    li.className = 'recent-empty';
    li.textContent = 'No popups blocked yet';
    ul.appendChild(li);
    return;
  }

  countEl.textContent = '(' + list.length + ')';
  clear.hidden = false;

  // newest first
  for (const entry of [...list].reverse()) {
    const li = document.createElement('li');
    li.className = 'recent-item';
    li.title = entry.href || '';

    const host = document.createElement('span');
    host.className = 'recent-host';
    host.textContent = entry.hostname || entry.href || '(unknown)';

    const when = document.createElement('span');
    when.className = 'recent-when';
    when.textContent = timeAgo(entry.ts);

    li.append(host, when);
    ul.appendChild(li);
  }
};

const asAdMap = m => (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};

/* ad domains blocked on the current site (per-site), with per-row removal */
const renderAds = async tabId => {
  const ul = $('ads-list');
  const countEl = $('ads-count');
  ul.textContent = '';

  const site = page.site;
  if (!site) {
    countEl.textContent = '';
    const li = document.createElement('li');
    li.className = 'recent-empty';
    li.textContent = 'Not available on this page';
    ul.appendChild(li);
    return;
  }

  const map = asAdMap((await config.get(['ad-hosts']))['ad-hosts']);
  const list = Array.isArray(map[site]) ? map[site] : [];
  countEl.textContent = list.length ? '(' + list.length + ')' : '';

  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'recent-empty';
    li.textContent = 'No ad domains blocked on ' + site;
    ul.appendChild(li);
    return;
  }

  for (const domain of list) {
    const li = document.createElement('li');
    li.className = 'recent-item ad-item';

    const host = document.createElement('span');
    host.className = 'recent-host';
    host.textContent = domain;
    host.title = domain;

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'ad-remove';
    rm.textContent = '✕';
    rm.title = 'Unblock ' + domain + ' on ' + site;
    rm.setAttribute('aria-label', 'Unblock ' + domain + ' on ' + site);
    rm.addEventListener('click', async () => {
      const m = asAdMap((await config.get(['ad-hosts']))['ad-hosts']);
      m[site] = (m[site] || []).filter(d => d !== domain);
      if (!m[site].length) {
        delete m[site];
      }
      await config.set({'ad-hosts': m});
      await renderAds(tabId);
      if (typeof tabId === 'number') {
        chrome.tabs.reload(tabId); // restore the page without the block
      }
    });

    li.append(host, rm);
    ul.appendChild(li);
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

  // Recent blocked list (per tab, from the service worker)
  chrome.runtime.sendMessage({cmd: 'get-history', tabId: tab.id}, list => {
    void chrome.runtime.lastError;
    renderHistory(list || []);
  });
  $('clear-history').onclick = () => chrome.runtime.sendMessage({
    cmd: 'clear-history',
    tabId: tab.id
  }, () => {
    void chrome.runtime.lastError;
    renderHistory([]);
  });

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
    page.site = hostname ? (tldjs.getDomain(hostname) || hostname) : '';

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

    renderAds(tab.id);
  }).catch(() => {
    setSiteDisabled(true);
    $('site-host').textContent = 'unavailable here';
    renderAds(tab.id);
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
