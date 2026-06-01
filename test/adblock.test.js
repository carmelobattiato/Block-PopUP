'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {loadClassic} = require('./helpers.js');

/* adblock.js depends on the `config`, `tldjs` and `chrome` globals. We provide
   light stubs so the per-site logic can be exercised in Node.
   `ad-hosts` is a map { site: [adDomain, ...] }. */
function loadAdblock(initialMap = {}) {
  const store = {'ad-hosts': initialMap};
  const config = {
    async get(keys) {
      const o = {};
      for (const k of keys) {
        o[k] = store[k];
      }
      return o;
    },
    async set(prefs) {
      Object.assign(store, prefs);
    },
    changed() {}
  };

  // registrable-domain stub: last two labels (good enough for *.com/.net/.it)
  const tldjs = {getDomain: host => host.split('.').slice(-2).join('.')};

  const dnr = {
    rules: [{id: 1}, {id: 2}],
    lastUpdate: null,
    async getDynamicRules() {
      return this.rules;
    },
    async updateDynamicRules(arg) {
      this.lastUpdate = arg;
    }
  };
  const reloaded = [];
  const chrome = {
    runtime: {onInstalled: {addListener() {}}, onStartup: {addListener() {}}},
    contextMenus: {onClicked: {addListener() {}}, removeAll(cb) { if (cb) { cb(); } }, create() {}},
    declarativeNetRequest: dnr,
    tabs: {reload(id) { reloaded.push(id); }}
  };

  const sandbox = {chrome, config, tldjs, console, URL};
  loadClassic('src/background/adblock.js', sandbox, ['adblock']);
  return {adblock: sandbox.adblock, store, dnr, reloaded};
}

const tab = (url, id = 1) => ({id, url});

/* ---- pickDomain ---- */

test('pickDomain prefers linkUrl and reduces to the base domain', () => {
  const {adblock} = loadAdblock();
  const d = adblock.pickDomain({
    linkUrl: 'https://adclick.g.doubleclick.net/pcs/click?xai=AKA',
    srcUrl: 'https://img.cdn.example.com/a.png'
  });
  assert.equal(d, 'doubleclick.net');
});

test('pickDomain falls back srcUrl -> frameUrl -> pageUrl', () => {
  const {adblock} = loadAdblock();
  assert.equal(adblock.pickDomain({srcUrl: 'https://img.ads.net/a.png'}), 'ads.net');
  assert.equal(adblock.pickDomain({frameUrl: 'https://x.frame.io/f'}), 'frame.io');
  assert.equal(adblock.pickDomain({pageUrl: 'https://www.page.org/p'}), 'page.org');
});

test('pickDomain returns "" for missing or invalid URLs', () => {
  const {adblock} = loadAdblock();
  assert.equal(adblock.pickDomain({}), '');
  assert.equal(adblock.pickDomain({linkUrl: 'not a url'}), '');
  assert.equal(adblock.pickDomain(null), '');
});

/* ---- siteOf ---- */

test('siteOf returns the base domain of the tab url', () => {
  const {adblock} = loadAdblock();
  assert.equal(adblock.siteOf(tab('https://www.corriere.it/sport/x')), 'corriere.it');
  assert.equal(adblock.siteOf(tab('https://video.corriere.it/y')), 'corriere.it');
});

test('siteOf returns "" for a tab without a usable url', () => {
  const {adblock} = loadAdblock();
  assert.equal(adblock.siteOf({id: 1}), '');
  assert.equal(adblock.siteOf(tab('')), '');
  assert.equal(adblock.siteOf(null), '');
});

/* ---- buildRules (per-site) ---- */

test('buildRules makes one scoped rule per site', () => {
  const {adblock} = loadAdblock();
  const rules = adblock.buildRules({
    'corriere.it': ['doubleclick.net', 'taboola.com'],
    'repubblica.it': ['outbrain.com']
  });
  assert.equal(rules.length, 2);
  assert.equal(rules[0].id, 1);
  assert.equal(rules[1].id, 2);
  assert.equal(rules[0].action.type, 'block');
  assert.deepEqual([...rules[0].condition.initiatorDomains], ['corriere.it']);
  assert.deepEqual([...rules[0].condition.requestDomains], ['doubleclick.net', 'taboola.com']);
});

test('buildRules omits resourceTypes (main_frame stays allowed)', () => {
  const {adblock} = loadAdblock();
  const rules = adblock.buildRules({'a.com': ['ads.net']});
  assert.equal('resourceTypes' in rules[0].condition, false);
});

test('buildRules skips sites with an empty domain list', () => {
  const {adblock} = loadAdblock();
  const rules = adblock.buildRules({'a.com': [], 'b.com': ['ads.net']});
  assert.equal(rules.length, 1);
  assert.deepEqual([...rules[0].condition.initiatorDomains], ['b.com']);
});

test('buildRules returns [] for an empty map or a legacy array', () => {
  const {adblock} = loadAdblock();
  assert.equal(adblock.buildRules({}).length, 0);
  assert.equal(adblock.buildRules(['ads.net']).length, 0); // legacy shape tolerated
});

/* ---- syncRules ---- */

test('syncRules rebuilds dynamic rules from the stored map', async () => {
  const {adblock, dnr} = loadAdblock({'corriere.it': ['doubleclick.net']});
  dnr.rules = [{id: 1}, {id: 2}, {id: 9}];
  await adblock.syncRules();
  assert.deepEqual([...dnr.lastUpdate.removeRuleIds], [1, 2, 9]);
  assert.equal(dnr.lastUpdate.addRules.length, 1);
  assert.deepEqual([...dnr.lastUpdate.addRules[0].condition.initiatorDomains], ['corriere.it']);
});

/* ---- onMenuClicked (per-site) ---- */

test('onMenuClicked blocks the ad domain under the current site and reloads', async () => {
  const {adblock, store, reloaded} = loadAdblock();
  await adblock.onMenuClicked(
    {linkUrl: 'https://adclick.g.doubleclick.net/x'},
    tab('https://www.corriere.it/article', 7)
  );
  assert.deepEqual([...store['ad-hosts']['corriere.it']], ['doubleclick.net']);
  assert.deepEqual(reloaded, [7]);
});

test('onMenuClicked keeps sites independent', async () => {
  const {adblock, store} = loadAdblock({'corriere.it': ['doubleclick.net']});
  await adblock.onMenuClicked(
    {linkUrl: 'https://ads.doubleclick.net/y'},
    tab('https://www.repubblica.it/z', 3)
  );
  assert.deepEqual([...store['ad-hosts']['corriere.it']], ['doubleclick.net']);
  assert.deepEqual([...store['ad-hosts']['repubblica.it']], ['doubleclick.net']);
});

test('onMenuClicked does not duplicate a domain already blocked on the site', async () => {
  const {adblock, store} = loadAdblock({'corriere.it': ['doubleclick.net']});
  await adblock.onMenuClicked(
    {linkUrl: 'https://x.doubleclick.net/q'},
    tab('https://corriere.it/a', 5)
  );
  assert.equal(store['ad-hosts']['corriere.it'].length, 1);
});

test('onMenuClicked ignores clicks with no ad domain or no site', async () => {
  const {adblock, store, reloaded} = loadAdblock();
  await adblock.onMenuClicked({}, tab('https://corriere.it/a', 1));        // no ad domain
  await adblock.onMenuClicked({linkUrl: 'https://ads.net/x'}, {id: 2});    // no site url
  assert.equal(Object.keys(store['ad-hosts']).length, 0);
  assert.equal(reloaded.length, 0);
});
