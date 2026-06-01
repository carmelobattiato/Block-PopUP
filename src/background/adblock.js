/* global config, tldjs, chrome */

/* Block PopUP — per-site ad-domain blocker (service worker).
 *
 * A context-menu item ("Block ads from this domain") records the registrable
 * base domain of the right-clicked ad UNDER the base domain of the site you are
 * visiting. The mapping { site: [adDomain, ...] } is compiled into
 * declarativeNetRequest dynamic rules scoped with `initiatorDomains`, so an ad
 * domain blocked on corriere.it stays loadable on every other site.
 *
 * Data shape (config 'ad-hosts'): { "corriere.it": ["doubleclick.net", ...] }
 */
const adblock = (() => {
  'use strict';

  const MENU_ID = 'pp-block-ad';

  const baseDomain = host => (tldjs.getDomain(host) || host).toLowerCase();

  /* the most specific ad URL from a context-menu info object, reduced to its
     registrable base domain (adclick.g.doubleclick.net -> doubleclick.net). */
  function pickDomain(info) {
    const url = (info && (info.linkUrl || info.srcUrl || info.frameUrl || info.pageUrl)) || '';
    let host = '';
    try {
      host = new URL(url).hostname;
    }
    catch (e) {
      return '';
    }
    return host ? baseDomain(host) : '';
  }

  /* the base domain of the visited tab (the scope an ad block is bound to) */
  function siteOf(tab) {
    let host = '';
    try {
      host = new URL(tab && tab.url).hostname;
    }
    catch (e) {
      return '';
    }
    return host ? baseDomain(host) : '';
  }

  /* a sane map, tolerating a legacy array value */
  const asMap = m => (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};

  /* one block rule per site: requests to its ad domains are blocked only when
     initiated from that site. resourceTypes omitted -> all but main_frame.
     An optional globalList produces an additional rule with no initiatorDomains
     that blocks those ad domains on every site. */
  function buildRules(map, globalList) {
    const rules = [];
    let id = 1;
    const m = asMap(map);
    for (const site of Object.keys(m)) {
      const domains = (m[site] || []).filter(Boolean);
      if (site && domains.length) {
        rules.push({
          id: id++,
          priority: 1,
          action: {type: 'block'},
          condition: {initiatorDomains: [site], requestDomains: domains}
        });
      }
    }
    const gDomains = (Array.isArray(globalList) ? globalList : []).filter(Boolean);
    if (gDomains.length) {
      rules.push({
        id: id++,
        priority: 1,
        action: {type: 'block'},
        condition: {requestDomains: gDomains}
      });
    }
    return rules;
  }

  /* rebuild every dynamic rule from the stored per-site map and global list;
     skips the DNR write entirely when the rule set is already up to date. */
  async function syncRules() {
    const data = await config.get(['ad-hosts', 'ad-hosts-global']);
    const newRules = buildRules(data['ad-hosts'], data['ad-hosts-global']);
    let existing = [];
    try {
      existing = await chrome.declarativeNetRequest.getDynamicRules();
    } catch (e) {
      console.warn('[Block PopUP] getDynamicRules failed:', e.message);
      return;
    }

    // skip the DNR write if content is identical
    if (JSON.stringify(existing) === JSON.stringify(newRules)) {
      return;
    }

    try {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existing.map(r => r.id),
        addRules: newRules
      });
    } catch (e) {
      console.warn('[Block PopUP] DNR rule update failed:', e.message);
    }
  }

  /* context-menu click: block the ad's base domain on the current site only,
     then reload the tab so the now-blocked resources disappear. */
  async function onMenuClicked(info, tab) {
    const domain = pickDomain(info);
    const site = siteOf(tab);
    if (!domain || !site) {
      return;
    }
    const {'ad-hosts': stored} = await config.get(['ad-hosts']);
    const map = asMap(stored);
    const list = Array.isArray(map[site]) ? map[site] : [];
    if (!list.includes(domain)) {
      list.push(domain);
    }
    map[site] = list;
    await config.set({'ad-hosts': map});
    if (tab && typeof tab.id === 'number') {
      chrome.tabs.reload(tab.id);
    }
  }

  function setupMenu() {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: MENU_ID,
        title: 'Block ads from this domain',
        contexts: ['all']
      });
    });
  }

  /* wiring */
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID) {
      onMenuClicked(info, tab);
    }
  });
  chrome.runtime.onInstalled.addListener(() => {
    setupMenu();
    syncRules();
  });
  chrome.runtime.onStartup.addListener(() => {
    setupMenu();
    syncRules();
  });
  config.changed(ps => {
    if (ps['ad-hosts'] || ps['ad-hosts-global']) {
      syncRules();
    }
  });

  return {MENU_ID, pickDomain, siteOf, buildRules, syncRules, onMenuClicked, setupMenu};
})();
