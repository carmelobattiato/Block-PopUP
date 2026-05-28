/* global config */
'use strict';

/* Preference keys owned by this options page. */
const BOOL_KEYS = [
  'enabled',
  'issue',
  'badge',
  'block-page-redirection',
  'block-automated-redirection',
  'block-page-redirection-same-origin'
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
  await config.set(prefs);
  await restore();
  showStatus('Reset to defaults');
};

document.addEventListener('DOMContentLoaded', () => {
  restore();

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
