/* global config */
'use strict';

/* Preference keys owned by this options page. */
const BOOL_KEYS = [
  'enabled',
  'issue',
  'badge',
  'block-page-redirection',
  'block-automated-redirection',
  'block-page-redirection-same-origin',
  'sync-enabled'
];

const SELECT_KEYS = ['placement', 'default-action'];

const COLOR_KEYS = ['badge-color'];

/* numeric key -> minimum value */
const NUMBER_KEYS = {
  'timeout': 1,
  'numbers': 1,
  'width': 300
};

const LIST_KEYS = [
  'popup-hosts',
  'top-hosts',
  'block-hosts',
  'block-page-redirection-hostnames'
];

const ALL_KEYS = [
  ...BOOL_KEYS,
  ...SELECT_KEYS,
  ...COLOR_KEYS,
  ...Object.keys(NUMBER_KEYS),
  ...LIST_KEYS
];

const $ = id => document.getElementById(id);

const parseHosts = str => str.split(/[\s,]+/)
  .map(s => s.replace(/^https?:\/\//, '').split('/')[0].trim())
  .filter((h, i, l) => h && l.indexOf(h) === i);

/* transient status message */
let statusTimer = null;
const showStatus = (text = 'Saved') => {
  const el = $('status');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => el.classList.remove('show'), 1800);
};

/* ---- render stored values into the form ---- */
const restore = async () => {
  const prefs = await config.get(ALL_KEYS);

  for (const key of BOOL_KEYS) {
    $(key).checked = Boolean(prefs[key]);
  }
  for (const key of SELECT_KEYS) {
    $(key).value = prefs[key];
  }
  for (const key of COLOR_KEYS) {
    $(key).value = prefs[key];
  }
  for (const key of Object.keys(NUMBER_KEYS)) {
    $(key).value = prefs[key];
  }
  for (const key of LIST_KEYS) {
    const list = Array.isArray(prefs[key]) ? prefs[key] : parseHosts(String(prefs[key] || ''));
    $(key).value = list.join(', ');
  }
};

/* ---- collect form values and persist ---- */
const save = async () => {
  const wasSync = (await config.get(['sync-enabled']))['sync-enabled'];
  const prefs = {};

  for (const key of BOOL_KEYS) {
    prefs[key] = $(key).checked;
  }
  // turning automated-redirect block ON forces page-redirection ON
  if (prefs['block-automated-redirection']) {
    prefs['block-page-redirection'] = true;
    $('block-page-redirection').checked = true;
  }
  for (const key of SELECT_KEYS) {
    prefs[key] = $(key).value;
  }
  for (const key of COLOR_KEYS) {
    prefs[key] = $(key).value;
  }
  for (const [key, min] of Object.entries(NUMBER_KEYS)) {
    let n = parseInt($(key).value, 10);
    if (!Number.isFinite(n)) {
      n = min;
    }
    n = Math.max(min, n);
    prefs[key] = n;
    $(key).value = n;
  }
  for (const key of LIST_KEYS) {
    const list = parseHosts($(key).value);
    prefs[key] = list;
    $(key).value = list.join(', ');
  }

  await config.set(prefs);

  // just switched sync on -> seed the whole current config to sync storage
  if (prefs['sync-enabled'] && !wasSync) {
    const ok = await config.pushAllToSync();
    showStatus(ok ? 'Saved — syncing enabled' : 'Saved — but sync quota exceeded');
    return;
  }
  showStatus('Saved');
};

/* ---- backup: export ---- */
const exportSettings = async () => {
  const all = await config.get([]);
  const blob = new Blob([JSON.stringify(all, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'block-popup-settings.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

/* ---- backup: import ---- */
const importSettings = file => {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid settings file');
      }
      // only accept known preference keys (ignore unknown/function props)
      const clean = {};
      for (const key of Object.keys(parsed)) {
        if (key in config && typeof config[key] !== 'function') {
          clean[key] = parsed[key];
        }
      }
      await config.set(clean);
      chrome.runtime.reload();
    }
    catch (e) {
      showStatus('Import failed');
      console.error(e);
    }
  };
  reader.onerror = () => showStatus('Import failed');
  reader.readAsText(file);
};

/* ---- backup: reset to defaults ---- */
const resetDefaults = async () => {
  const prefs = {};
  for (const key of ALL_KEYS) {
    prefs[key] = config[key];
  }
  prefs['ad-hosts'] = {}; // structured map, not part of ALL_KEYS
  await config.set(prefs);
  await restore();
  renderAdGroups();
  showStatus('Reset to defaults');
};

/* ---- per-list search/filter (keeps the textarea as source of truth) ---- */
const SEARCH_KEYS = ['popup-hosts', 'top-hosts', 'block-hosts'];
const MAX_MATCHES = 60;

const selectInTextarea = (textarea, host) => {
  const i = textarea.value.indexOf(host);
  textarea.focus();
  if (i >= 0) {
    // setSelectionRange scrolls the selection into view on focus
    textarea.setSelectionRange(i, i + host.length);
  }
};

const wireSearch = key => {
  const input = $(key + '-search');
  const panel = $(key + '-matches');
  const textarea = $(key);
  if (!input || !panel || !textarea) {
    return;
  }
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    panel.textContent = '';
    if (!q) {
      panel.hidden = true;
      return;
    }
    const entries = parseHosts(textarea.value);
    const matches = entries.filter(h => h.toLowerCase().includes(q));

    const count = document.createElement('span');
    count.className = 'list-count';
    count.textContent = matches.length + ' of ' + entries.length;
    panel.appendChild(count);

    for (const host of matches.slice(0, MAX_MATCHES)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'list-match';
      chip.textContent = host;
      chip.title = 'Select "' + host + '" in the list';
      chip.addEventListener('click', () => selectInTextarea(textarea, host));
      panel.appendChild(chip);
    }
    if (matches.length > MAX_MATCHES) {
      const more = document.createElement('span');
      more.className = 'list-count';
      more.textContent = '+' + (matches.length - MAX_MATCHES) + ' more';
      panel.appendChild(more);
    }
    panel.hidden = false;
  });
  // a filtered list can go stale after editing the textarea
  textarea.addEventListener('input', () => {
    if (input.value) {
      input.dispatchEvent(new Event('input'));
    }
  });
};

/* ---- per-site blocked ad domains (structured map, edited live) ---- */
const asAdMap = m => (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};

const renderAdGroups = async () => {
  const root = $('ad-groups');
  root.textContent = '';
  const map = asAdMap((await config.get(['ad-hosts']))['ad-hosts']);
  const sites = Object.keys(map).filter(s => (map[s] || []).length).sort();

  if (!sites.length) {
    const p = document.createElement('p');
    p.className = 'ad-empty';
    p.textContent = 'No ad domains blocked yet. Right-click an ad on any page to block its domain for that site.';
    root.appendChild(p);
    return;
  }

  for (const site of sites) {
    const group = document.createElement('div');
    group.className = 'ad-group';

    const head = document.createElement('div');
    head.className = 'ad-site';
    head.textContent = site;
    group.appendChild(head);

    const ul = document.createElement('ul');
    ul.className = 'ad-domains';
    for (const domain of map[site]) {
      const li = document.createElement('li');
      li.className = 'ad-domain';

      const name = document.createElement('span');
      name.className = 'ad-domain-name';
      name.textContent = domain;

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
        renderAdGroups();
      });

      li.append(name, rm);
      ul.appendChild(li);
    }
    group.appendChild(ul);
    root.appendChild(group);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  restore();
  renderAdGroups();

  for (const key of SEARCH_KEYS) {
    wireSearch(key);
  }

  $('save').addEventListener('click', save);
  $('export').addEventListener('click', exportSettings);
  $('reset').addEventListener('click', resetDefaults);

  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      importSettings(file);
    }
    e.target.value = '';
  });

  // keep the dependent switches consistent live
  $('block-automated-redirection').addEventListener('change', e => {
    if (e.target.checked) {
      $('block-page-redirection').checked = true;
    }
  });
});
