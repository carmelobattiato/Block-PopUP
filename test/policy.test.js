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
