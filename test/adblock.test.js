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
});
