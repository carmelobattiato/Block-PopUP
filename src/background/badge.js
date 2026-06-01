/* global config */

const TITLES = {
  0: 'Block PopUP is enabled, but not active in this tab (internal/out-of-scope page or still loading).',
  1: 'Block PopUP is enabled and protects this tab',
  2: 'Block PopUP is enabled but does not protect this tab',
  3: 'Block PopUP is disabled and does not protect this tab',
  4: 'Block PopUP is disabled but protects this tab'
};

/* update global icon's state */
const icon = async () => {
  const prefs = await config.get(['enabled']);
  const path = {
    16: 'src/assets/icons/' + (prefs.enabled ? 'state/0/' : 'state/3/') + '16.png',
    32: 'src/assets/icons/' + (prefs.enabled ? 'state/0/' : 'state/3/') + '32.png'
  };
  chrome.action.setIcon({
    path
  }).catch(() => {}); // ignore transient fetch errors during reload
  chrome.action.setTitle({
    title: TITLES[prefs.enabled ? 0 : 3]
  });
};

/* observe preference changes */
config.changed(prefs => {
  if (prefs.badge && prefs.badge.newValue === false) {
    chrome.tabs.query({}, tabs => tabs.forEach(tab => chrome.action.setBadgeText({
      tabId: tab.id,
      text: ''
    })));
  }
  // maybe multiple prefs changed
  if (prefs['badge-color']) {
    chrome.action.setBadgeBackgroundColor({
      color: prefs['badge-color'].newValue
    });
  }
  //
  if (prefs.enabled) {
    icon();
  }
  if (prefs['ad-hosts'] || prefs['ad-hosts-global']) {
    chrome.tabs.query({active: true, lastFocusedWindow: true}, tabs => {
      if (tabs && tabs[0]) updateAdTitle(tabs[0].id, tabs[0].url);
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender) => {
  if (!sender.tab) {
    return;
  }
  // update badge counter
  if (request.cmd === 'popup-request') {
    const tabId = sender.tab.id;
    config.get(['badge']).then(({badge}) => {
      if (badge) {
        chrome.action.getBadgeText({tabId}, text => {
          if (text !== 'E') {
            text = text ? parseInt(text) : 0;
            text = String(text + 1);
          }
          chrome.action.setBadgeText({
            tabId,
            text
          });
        });
      }
    });
  }
  else if (request.cmd === 'state') {
    if (sender.tab) {
      config.get(['enabled']).then(({enabled}) => {
        let state = 4;
        if (enabled && request.active) {
          state = 1;
        }
        else if (enabled && request.active === false) {
          state = 2;
        }
        else if (enabled === false && request.active === false) {
          state = 3;
        }
        const path = {
          16: 'src/assets/icons/state/' + state + '/16.png',
          32: 'src/assets/icons/state/' + state + '/32.png'
        };
        chrome.action.setIcon({
          tabId: sender.tab.id,
          path
        }).catch(() => {}); // tab may be gone / reloading
        chrome.action.setTitle({
          tabId: sender.tab.id,
          title: TITLES[state]
        });
        updateAdTitle(sender.tab.id, sender.tab.url);
      });
    }
  }
});

async function updateAdTitle(tabId, tabUrl) {
  if (!tabId || !tabUrl) return;
  let site = '';
  try {
    site = tldjs.getDomain(new URL(tabUrl).hostname) || new URL(tabUrl).hostname;
  } catch (e) { return; }
  if (!site) return;

  const data = await config.get(['ad-hosts', 'ad-hosts-global']);
  const map = (data['ad-hosts'] && typeof data['ad-hosts'] === 'object' && !Array.isArray(data['ad-hosts']))
    ? data['ad-hosts'] : {};
  const perSite = Array.isArray(map[site]) ? map[site].length : 0;
  const glob = Array.isArray(data['ad-hosts-global']) ? data['ad-hosts-global'].length : 0;
  const total = perSite + glob;
  if (!total) return;

  chrome.action.getTitle({tabId}, existing => {
    void chrome.runtime.lastError;
    if (!existing) return;
    // avoid appending duplicate suffix
    const base = existing.split('\n— ')[0];
    chrome.action.setTitle({
      tabId,
      title: base + '\n— ' + total + ' ad domain(s) blocked on this page'
    });
  });
}

// on startup (run once)
{
  const once = () => {
    // icon
    icon();
    // badge color
    config.get(['badge-color']).then(prefs => chrome.action.setBadgeBackgroundColor({
      color: prefs['badge-color']
    }));
  };
  chrome.runtime.onInstalled.addListener(once);
  chrome.runtime.onStartup.addListener(once);
}
