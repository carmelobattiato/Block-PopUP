# Changelog

All notable changes to **Block PopUP** are documented in this file.

## [Unreleased]

---

## [0.7] — 2026-07-17

- Silent-block tracking: each blocked popup now records whether a notification card was shown (`notified`) or the block was silent (`silent`) — distinguishable in the toolbar panel "Recent blocked" list
- Toolbar panel history: entries now carry a coloured badge — blue **notified** for popups where the card appeared, grey **silent** for popups suppressed by the always-block list or the silent list; dark-mode palette included
- `service-worker.js` refactored: `popup-request` handler merges stats update and notification decision into a single `config.get` call; `silent` flag is determined before writing to history so the stored entry is always accurate
- Fixed: `block-hosts` check now also matches the parent-page hostname (not only the popup destination), so adding a source site to always-blocked silences all its outgoing popups even when the destination is unknown

---

## [0.6] — 2026-06-02

- `syncRules()` skips the declarativeNetRequest write when rules are unchanged (performance fix)
- DNR rule quota counter ("X / 5000 dynamic rules used") in Options → Blocked ad domains; warning when approaching limit
- Unit test suite for `adblock.js` pure functions (`pickDomain`, `siteOf`, `buildRules`) — 82 tests total
- Global ad blocking: right-click context menu now has a submenu — "On this site only" vs "Everywhere (all sites)"
- Options → Blocked ad domains: new "Blocked everywhere" section with per-entry removal for globally blocked domains
- Snooze: toolbar panel "Snooze 10 min" button suppresses popup notification cards on the current tab temporarily; resets on navigation
- Statistics dashboard in Options: lifetime popup count, per-site and global ad-domain totals, tracking start date, Reset button
- Badge tooltip shows how many ad domains are blocked on the current page
- Cosmetic element hiding: content script injects CSS to visually hide elements from blocked ad domains at page load
- Filter list import: paste a URL to fetch EasyList / uBlock-format filter lists; parsed domains are added to the global blocklist
- Firefox MV3 compatibility: `gecko.id` added to manifest, `matchOriginAsFallback` guarded by user-agent check


## [0.5] — 2026-06-02

- Block ads by domain, per site: right-click an ad and choose “Block ads from this domain” to block that ad domain (e.g. `doubleclick.net`) only on the site you are visiting (declarativeNetRequest scoped by initiator). The same ad domain still loads on other sites. Review and remove blocked domains for the current page from the toolbar panel, or for all sites under Options → Blocked ad domains.


## [0.3] — 2026-06-01

- Test suite expanded to 62 tests: functional coverage of the optional-sync config layer and the per-tab blocked history, plus non-functional checks (purity, determinism, robustness, and performance on large lists)


## [0.2] — 2026-05-29

- Accessibility: the notification card now exposes ARIA roles, a screen-reader live region announcing blocked popups, a proper menu role with `aria-expanded`, visible focus rings, and an in-card focus trap when auto-focus is enabled
- Recent blocked: the toolbar panel now lists the popups blocked on the current tab (source and time), with a Clear action; the list is per-page and resets on navigation
- Undo: choosing "Block this site" now shows a 5-second Undo toast so an accidental block can be reverted before it persists
- Options: each domain list now has a filter box that shows matching entries with a count and jumps to them in the list — handy for long lists
- Optional sync: a new "Sync settings across devices" switch mirrors all preferences through `chrome.storage.sync`, with graceful handling if the sync quota is exceeded
- Domain matching now supports wildcard patterns (e.g. `*.example.com`, `tracker-*.net`, `*ads*`) in the allow and always-block lists


## [0.1] — 2026-05-29

- First release of Block PopUP — a strict, modern popup blocker for Chrome & Edge (Manifest V3).
- Pre-emptive blocking of `window.open`, `target=_blank` link clicks and form submissions, before any new window opens, across all frames
- Modern in-page notification rendered in an isolated Shadow DOM (rounded card, automatic dark/light)
- Per-popup actions: Allow, Block, Close, plus a More menu (Open in background tab, Open in this tab, Always allow this site)
- Always-block list: silence a source domain permanently — no notification, only the counter keeps counting
- Auto-resolve with a visible countdown that highlights the default action
- Toolbar panel: global on/off, per-site on/off (incl. sub-frames), blocked count, Allow / Block last request
- Options page: general settings, domain lists (allowed sources · disabled sites · always-blocked), redirect protection, and import / export / reset
- Page-redirect protection, with optional blocking of automated redirects
- Privacy-first: no analytics, no remote requests, settings stored locally
- Unit-tested block-decision engine, plus a local self-test page (`test/popups.html`) with no external URLs
- Continuous integration (GitHub Actions): syntax check, manifest validation, unit tests, and tagged release packaging
- MIT licensed

