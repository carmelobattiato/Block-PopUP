'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {matchesHost, verdict} = require('../src/content/policy.js');

/* default env: no frames exist, href returned as-is, top is example.com */
const env = (over = {}) => ({
  absolute: href => href,
  frameExists: () => false,
  topHostname: () => 'example.com',
  ...over
});

const settings = (over = {}) => ({
  protocols: ['magnet:'],
  'popup-hosts': [],
  domain: false,
  ...over
});

const req = (over = {}) => ({
  kind: 'open',
  target: '',
  prevented: false,
  modifier: false,
  trusted: false,
  tag: '',
  download: false,
  href: 'https://ads.net/promo',
  ...over
});

test('matchesHost — exact, sub-domain and parent', () => {
  assert.equal(matchesHost('example.com', ['example.com']), true);
  assert.equal(matchesHost('ads.example.com', ['example.com']), true);
  assert.equal(matchesHost('example.com', ['ads.example.com']), true);
  assert.equal(matchesHost('other.com', ['example.com']), false);
  assert.equal(matchesHost('notexample.com', ['example.com']), false);
});

test('matchesHost — wildcard glob patterns', () => {
  // *.example.com matches sub-domains
  assert.equal(matchesHost('ads.example.com', ['*.example.com']), true);
  assert.equal(matchesHost('a.b.example.com', ['*.example.com']), true);
  // prefix/suffix globs
  assert.equal(matchesHost('tracker-1.net', ['tracker-*.net']), true);
  assert.equal(matchesHost('tracker.org', ['tracker-*.net']), false);
  // substring glob
  assert.equal(matchesHost('cdn.ads.evil.com', ['*ads*']), true);
  assert.equal(matchesHost('safe.example.com', ['*ads*']), false);
  // anchored: must match the whole host
  assert.equal(matchesHost('example.com.evil.net', ['*.example.com']), false);
  // a literal (no "*") still uses exact/sub/parent matching
  assert.equal(matchesHost('ads.example.com', ['example.com']), true);
});

test('blocks a plain window.open to a foreign host', () => {
  const v = verdict(req(), settings(), env());
  assert.equal(v.block, true);
  assert.equal(v.hostname, 'ads.net');
});

test('event already prevented by the page is allowed', () => {
  assert.equal(verdict(req({prevented: true}), settings(), env()).block, false);
});

test('genuine modifier-click (ctrl/cmd) is allowed', () => {
  assert.equal(verdict(req({kind: 'click', modifier: true, trusted: true}), settings(), env()).block, false);
});

test('untrusted modifier-click is still blocked', () => {
  assert.equal(verdict(req({kind: 'click', modifier: true, trusted: false}), settings(), env()).block, true);
});

test('anchor download is allowed', () => {
  assert.equal(verdict(req({kind: 'click', tag: 'A', download: true}), settings(), env()).block, false);
});

test('navigation that targets an existing frame is allowed', () => {
  const e = env({frameExists: name => name === 'sidebar'});
  assert.equal(verdict(req({kind: 'click', target: 'sidebar'}), settings(), e).block, false);
  // kind:'open' ignores existing-frame rule
  assert.equal(verdict(req({kind: 'open', target: 'sidebar'}), settings(), e).block, true);
});

test('whitelisted protocol is allowed', () => {
  const v = verdict(req({href: 'magnet:?xt=urn:btih:abc'}), settings(), env());
  assert.equal(v.block, false);
});

test('popup-hosts entry allows the source (incl. sub-domain)', () => {
  const v = verdict(req({href: 'https://promo.ads.net/x'}), settings({'popup-hosts': ['ads.net']}), env());
  assert.equal(v.block, false);
});

test('domain mode allows same-domain-as-top popups only when enabled', () => {
  const r = req({href: 'https://shop.example.com/x'});
  assert.equal(verdict(r, settings({domain: false}), env()).block, true);
  assert.equal(verdict(r, settings({domain: true}), env()).block, false);
});

test('unparsable href keeps blocking with empty hostname', () => {
  const v = verdict(req({href: 'about:blank'}), settings(), env());
  assert.equal(v.block, true);
  assert.equal(v.hostname, '');
});

test('absolute resolver is used for relative hrefs', () => {
  const e = env({absolute: () => 'https://resolved.net/p'});
  const v = verdict(req({href: '/p'}), settings(), e);
  assert.equal(v.hostname, 'resolved.net');
});

/* ---- additional matchesHost coverage ---- */

test('matchesHost — empty list never matches', () => {
  assert.equal(matchesHost('example.com', []), false);
});

test('matchesHost — glob is case-insensitive', () => {
  assert.equal(matchesHost('ADS.Example.COM', ['*.example.com']), true);
  assert.equal(matchesHost('Tracker-9.NET', ['tracker-*.net']), true);
});

test('matchesHost — dot in a glob is literal, not a wildcard', () => {
  assert.equal(matchesHost('aXbads.com', ['a.b*']), false);
  assert.equal(matchesHost('a.bads.com', ['a.b*']), true);
});

test('matchesHost — matches if any entry in the list matches', () => {
  assert.equal(matchesHost('ads.net', ['safe.com', 'foo.org', 'ads.net']), true);
  assert.equal(matchesHost('ads.net', ['safe.com', '*track*']), false);
});

/* ---- additional verdict coverage ---- */

test('https not in the protocol allowlist is blocked', () => {
  const v = verdict(req({href: 'https://ads.net/x'}), settings({protocols: ['magnet:']}), env());
  assert.equal(v.block, true);
});

test('ftp scheme is blocked and its hostname captured', () => {
  const v = verdict(req({href: 'ftp://files.example.org/x'}), settings(), env());
  assert.equal(v.block, true);
  assert.equal(v.hostname, 'files.example.org');
});

test('data: URL is blocked with an empty hostname', () => {
  const v = verdict(req({href: 'data:text/html,hi'}), settings(), env());
  assert.equal(v.block, true);
  assert.equal(v.hostname, '');
});

test('javascript: URL is blocked with an empty hostname', () => {
  const v = verdict(req({href: 'javascript:void(0)'}), settings(), env());
  assert.equal(v.block, true);
  assert.equal(v.hostname, '');
});

test('empty href open is blocked with an empty hostname', () => {
  const v = verdict(req({href: ''}), settings(), env());
  assert.equal(v.block, true);
  assert.equal(v.hostname, '');
});

test('prevented wins over a genuine modifier-click (still allowed)', () => {
  const v = verdict(req({kind: 'click', prevented: true, modifier: true, trusted: true}), settings(), env());
  assert.equal(v.block, false);
});

test('popup-hosts accepts wildcard entries', () => {
  const v = verdict(req({href: 'https://promo.ads.net/x'}), settings({'popup-hosts': ['*.ads.net']}), env());
  assert.equal(v.block, false);
});

test('domain mode with a cross-origin (unknown) top stays blocked', () => {
  const e = env({topHostname: () => ''});
  const v = verdict(req({href: 'https://shop.example.com/x'}), settings({domain: true}), e);
  assert.equal(v.block, true);
});

test('verdict returns the (resolved) href verbatim', () => {
  const v = verdict(req({href: 'https://ads.net/promo'}), settings(), env());
  assert.equal(v.href, 'https://ads.net/promo');
});

test('download flag only applies to anchors, not window.open', () => {
  // kind:'open' with a download flag is still a popup -> blocked
  const v = verdict(req({kind: 'open', download: true}), settings(), env());
  assert.equal(v.block, true);
});

/* ===================== non-functional ===================== */

test('NF: verdict does not mutate its req or settings arguments', () => {
  const r = Object.freeze(req({href: 'https://ads.net/x'}));
  const s = Object.freeze(settings({'popup-hosts': Object.freeze(['ads.net'])}));
  assert.doesNotThrow(() => verdict(r, s, env())); // frozen inputs -> no writes
});

test('NF: verdict is deterministic for identical inputs', () => {
  const a = verdict(req(), settings(), env());
  const b = verdict(req(), settings(), env());
  assert.deepEqual(a, b);
});

test('NF: verdict returns exactly {block, hostname, href}', () => {
  const v = verdict(req(), settings(), env());
  assert.deepEqual(Object.keys(v).sort(), ['block', 'hostname', 'href']);
});

test('NF: hostname is normalised to lower-case', () => {
  const v = verdict(req({href: 'https://ADS.Example.COM/x'}), settings(), env());
  assert.equal(v.hostname, 'ads.example.com');
});

test('NF: matchesHost never throws on regex-special literal entries', () => {
  assert.doesNotThrow(() => matchesHost('a+b.com', ['a+b.com', '(x)[y]', 'a.b$c']));
  assert.equal(matchesHost('a+b.com', ['a+b*']), true);   // + is literal in glob
  assert.equal(matchesHost('axbc.com', ['a+b*']), false);
});

test('NF: matchesHost stays fast over a large list (50k entries)', () => {
  const list = [];
  for (let i = 0; i < 50000; i++) {
    list.push('host-' + i + '.example.com');
  }
  list.push('target.net');
  const t = Date.now();
  const hit = matchesHost('target.net', list);
  assert.equal(hit, true);
  assert.ok(Date.now() - t < 200, 'matchesHost should scan 50k entries quickly');
});

test('NF: verdict stays fast with a large popup-hosts list', () => {
  const hosts = [];
  for (let i = 0; i < 20000; i++) {
    hosts.push('h' + i + '.com');
  }
  const s = settings({'popup-hosts': hosts});
  const t = Date.now();
  for (let i = 0; i < 200; i++) {
    verdict(req({href: 'https://ads.net/x'}), s, env());
  }
  assert.ok(Date.now() - t < 300, '200 verdicts over a 20k list should be quick');
});

test('NF: repeated glob matching is correct and cheap (cache)', () => {
  const t = Date.now();
  for (let i = 0; i < 20000; i++) {
    assert.equal(matchesHost('ads.tracker.net', ['*tracker*']), true);
  }
  assert.ok(Date.now() - t < 300, 'compiled glob should be reused, not recompiled');
});
