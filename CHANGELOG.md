# Changelog

All notable changes to **Block PopUP** are documented in this file.

## [Unreleased]

---

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

