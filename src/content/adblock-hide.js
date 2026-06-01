/* global config */
/* Block PopUP — cosmetic element hiding.
 * Injects CSS at document_start to hide elements whose src/href contains
 * a blocked ad domain (per-site list + global list). */
(async () => {
  'use strict';

  const hostname = location.hostname;
  let site = '';
  try {
    const parts = hostname.split('.');
    site = parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
  } catch (e) {}

  const data = await config.get(['ad-hosts', 'ad-hosts-global']);
  const map = (data['ad-hosts'] && typeof data['ad-hosts'] === 'object' && !Array.isArray(data['ad-hosts']))
    ? data['ad-hosts'] : {};
  const perSite = Array.isArray(map[site]) ? map[site] : [];
  const global = Array.isArray(data['ad-hosts-global']) ? data['ad-hosts-global'] : [];
  const domains = [...new Set([...perSite, ...global])].filter(Boolean);

  if (!domains.length) return;

  const attrs = ['src', 'href', 'data-src', 'action'];
  const tags = ['img', 'iframe', 'script', 'embed', 'source', 'video', 'audio'];

  const selectors = domains.flatMap(domain =>
    tags.flatMap(tag =>
      attrs.map(attr => `${tag}[${attr}*="${domain}"]`)
    )
  );

  const style = document.createElement('style');
  style.id = 'ppop-ad-hide';
  style.textContent = selectors.join(',\n') + ' {\n  display: none !important;\n  visibility: hidden !important;\n}';

  (document.head || document.documentElement).appendChild(style);
})();
