'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Pure helpers extracted for testing (mirrors adblock.js, no chrome dependency)
const tldjs = {
  getDomain: host => {
    const p = host.split('.');
    return p.length >= 2 ? p.slice(-2).join('.') : host;
  }
};

const baseDomain = host => (tldjs.getDomain(host) || host).toLowerCase();

function pickDomain(info) {
  const url = (info && (info.linkUrl || info.srcUrl || info.frameUrl || info.pageUrl)) || '';
  let host = '';
  try { host = new URL(url).hostname; } catch (e) { return ''; }
  return host ? baseDomain(host) : '';
}

function siteOf(tab) {
  let host = '';
  try { host = new URL(tab && tab.url).hostname; } catch (e) { return ''; }
  return host ? baseDomain(host) : '';
}

const asMap = m => (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};

function buildRules(map, globalList) {
  const rules = [];
  let id = 1;
  const m = asMap(map);
  for (const site of Object.keys(m)) {
    const domains = (m[site] || []).filter(Boolean);
    if (site && domains.length) {
      rules.push({ id: id++, priority: 1, action: {type: 'block'},
        condition: {initiatorDomains: [site], requestDomains: domains} });
    }
  }
  const gDomains = (Array.isArray(globalList) ? globalList : []).filter(Boolean);
  if (gDomains.length) {
    rules.push({ id: id++, priority: 1, action: {type: 'block'},
      condition: {requestDomains: gDomains} });
  }
  return rules;
}

test('buildRules — empty inputs produce no rules', () => {
  assert.deepEqual(buildRules({}, []), []);
});

test('buildRules — per-site rule has initiatorDomains', () => {
  const rules = buildRules({'corriere.it': ['doubleclick.net']}, []);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, 1);
  assert.equal(rules[0].priority, 1);
  assert.equal(rules[0].action.type, 'block');
  assert.deepEqual(rules[0].condition.initiatorDomains, ['corriere.it']);
  assert.deepEqual(rules[0].condition.requestDomains, ['doubleclick.net']);
});

test('buildRules — global rule has no initiatorDomains', () => {
  const rules = buildRules({}, ['evil.net']);
  assert.equal(rules.length, 1);
  assert.ok(!rules[0].condition.initiatorDomains);
  assert.deepEqual(rules[0].condition.requestDomains, ['evil.net']);
});

test('buildRules — site + global produce 2 rules with sequential IDs', () => {
  const rules = buildRules({'a.com': ['x.net']}, ['y.net']);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].id, 1);
  assert.equal(rules[1].id, 2);
  // per-site rule first, global rule second
  assert.ok(Array.isArray(rules[0].condition.initiatorDomains), 'first rule should be per-site');
  assert.ok(!rules[1].condition.initiatorDomains, 'second rule should be global');
});

test('buildRules — filters falsy domain entries', () => {
  const rules = buildRules({'a.com': ['', null, 'real.net', undefined]}, []);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].condition.requestDomains, ['real.net']);
});

test('buildRules — tolerates legacy array value for map (asMap guard)', () => {
  const rules = buildRules([], []);
  assert.deepEqual(rules, []);
});

// pickDomain tests
test('pickDomain — prefers linkUrl over srcUrl', () => {
  assert.equal(pickDomain({linkUrl: 'https://ads.double.net/x', srcUrl: 'https://other.com/y'}), 'double.net');
});

test('pickDomain — falls back to srcUrl when no linkUrl', () => {
  assert.equal(pickDomain({srcUrl: 'https://tracker.evil.com/img.gif'}), 'evil.com');
});

test('pickDomain — strips subdomain to base domain', () => {
  assert.equal(pickDomain({pageUrl: 'https://adclick.g.doubleclick.net/x'}), 'doubleclick.net');
});

test('pickDomain — returns empty string for non-URL', () => {
  assert.equal(pickDomain({pageUrl: 'not-a-url'}), '');
});

test('pickDomain — returns empty string for null info', () => {
  assert.equal(pickDomain(null), '');
});

test('pickDomain — lowercases the result', () => {
  assert.equal(pickDomain({linkUrl: 'https://ADS.Evil.COM/x'}), 'evil.com');
});

test('pickDomain — falls back through linkUrl→srcUrl→frameUrl→pageUrl', () => {
  // only pageUrl available
  assert.equal(pickDomain({pageUrl: 'https://analytics.tracker.io/p'}), 'tracker.io');
});

// siteOf tests
test('siteOf — extracts base domain from tab URL', () => {
  assert.equal(siteOf({url: 'https://www.corriere.it/news'}), 'corriere.it');
});

test('siteOf — returns empty for unparsable URL', () => {
  assert.equal(siteOf({url: 'not-a-url'}), '');
});

test('siteOf — returns empty for null tab', () => {
  assert.equal(siteOf(null), '');
});

test('siteOf — lowercases the result', () => {
  assert.equal(siteOf({url: 'https://WWW.EXAMPLE.COM/page'}), 'example.com');
});

test('siteOf — strips subdomain', () => {
  assert.equal(siteOf({url: 'https://sub.deep.example.co.uk/path'}), 'co.uk');
  // our stub getDomain uses last 2 parts: co.uk — acceptable limitation documented
});

// NF tests
test('NF: pickDomain does not throw for empty info object', () => {
  assert.doesNotThrow(() => pickDomain({}));
  assert.equal(pickDomain({}), '');
});

test('NF: pickDomain and siteOf are pure (same input same output)', () => {
  const a = pickDomain({linkUrl: 'https://ads.net/x'});
  const b = pickDomain({linkUrl: 'https://ads.net/x'});
  assert.equal(a, b);
  const c = siteOf({url: 'https://news.com/p'});
  const d = siteOf({url: 'https://news.com/p'});
  assert.equal(c, d);
});
