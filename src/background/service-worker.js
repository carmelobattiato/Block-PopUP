/* global config, PPolicy */

if (typeof importScripts !== 'undefined') {
  self.importScripts('config.js');
  self.importScripts('badge.js');
  self.importScripts('history.js');
  self.importScripts('../content/policy.js'); // shared host matcher (PPolicy)
  self.importScripts('../action/tld.js');     // registrable-domain parser (tldjs)
  self.importScripts('adblock.js');           // context menu + ad-domain DNR rules
}

/* tabId → expiry timestamp (ms). In-memory: resets if service worker is killed. */
const snoozeMap = new Map();

/* enable or disable the blocker */
const activate = async () => {
  if (activate.busy) {
    return;
  }
  activate.busy = true;

  const prefs = await config.get(['enabled', 'top-hosts', 'scope']);
  try {
    await chrome.scripting.unregisterContentScripts();

    if (prefs.enabled) {
      // exception list
      const th = [];
      for (const hostname of prefs['top-hosts']) {
        try {
          await activate.test('*://' + hostname + '/*');
          th.push('*://' + hostname + '/*');
        }
        catch (e) {
          console.warn('Cannot use ' + hostname + ' rule. Reason: ' + e.message);
        }
        try {
          await activate.test('*://*.' + hostname + '/*');
          th.push('*://*.' + hostname + '/*');
        }
        catch (e) {
          console.warn('Cannot use *.' + hostname + ' rule. Reason: ' + e.message);
        }
      }

      const props = {
        'matches': prefs.scope,
        'excludeMatches': th,
        'allFrames': true,
        'matchOriginAsFallback': true,
        'runAt': 'document_start'
      };

      await chrome.scripting.registerContentScripts([{
        'id': 'main',
        'js': ['/src/content/page-hook.js'],
        'world': 'MAIN',
        ...props
      }, {
        'id': 'isolated',
        'js': ['/src/background/config.js', '/src/content/policy.js', '/src/content/notification.js', '/src/content/blocker.js'],
        'world': 'ISOLATED',
        ...props
      }]);

      // only on top frame
      if (th.length) {
        await chrome.scripting.registerContentScripts([{
          'id': 'disabled',
          'js': ['/src/content/disabled.js'],
          'world': 'ISOLATED',
          'matches': th,
          'runAt': 'document_start'
        }]);
      }
    }
  }
  catch (e) {
    await chrome.scripting.unregisterContentScripts();

    const props = {
      'matches': prefs.scope,
      'allFrames': true,
      'matchOriginAsFallback': true,
      'runAt': 'document_start'
    };
    await chrome.scripting.registerContentScripts([{
      'id': 'main',
      'js': ['/src/content/page-hook.js'],
      'world': 'MAIN',
      ...props
    }, {
      'id': 'isolated',
      'js': ['/src/background/config.js', '/src/content/policy.js', '/src/content/notification.js', '/src/content/blocker.js'],
      'world': 'ISOLATED',
      ...props
    }]);

    chrome.action.setBadgeBackgroundColor({color: '#b16464'});
    chrome.action.setBadgeText({text: 'E'});
    chrome.action.setTitle({title: 'Registering the blocking filter failed (an exclusion rule is malformed). Fix it in the options page.\n\n' + e.message});
    console.error('Blocker Registration Failed', e);
  }
  activate.busy = false;
};
activate.test = async pattern => {
  await chrome.scripting.registerContentScripts([{
    'id': 'test',
    'js': ['/src/content/probe.js'],
    'world': 'MAIN',
    'matches': ['*://*/*'],
    'excludeMatches': [pattern]
  }]);
  await chrome.scripting.unregisterContentScripts({
    ids: ['test']
  }).catch(() => {});
};
chrome.runtime.onStartup.addListener(activate);
chrome.runtime.onInstalled.addListener(activate);
config.changed(ps => {
  if (ps.enabled || ps['top-hosts'] || ps.scope) {
    activate();
  }
});

chrome.runtime.onMessage.addListener((request, sender, response) => {
  // only accept messages from this extension (own content scripts or pages)
  if (sender.id !== chrome.runtime.id) {
    return;
  }
  if (request.cmd === 'snooze-tab') {
    const tabId = request.tabId;
    const minutes = typeof request.minutes === 'number' ? request.minutes : 10;
    snoozeMap.set(tabId, Date.now() + minutes * 60 * 1000);
    response(true);
    return true;
  }
  if (request.cmd === 'snooze-status') {
    const tabId = request.tabId;
    const exp = snoozeMap.get(tabId);
    const minsLeft = (exp && exp > Date.now()) ? Math.ceil((exp - Date.now()) / 60000) : 0;
    response(minsLeft);
    return true;
  }
  // history/clear come from the toolbar panel (an extension page, no sender.tab)
  if (request.cmd === 'get-history') {
    blockHistory.get(request.tabId).then(list => response(list));
    return true;
  }
  if (request.cmd === 'clear-history') {
    blockHistory.clear(request.tabId).then(() => response(true));
    return true;
  }
  // everything below originates from a content script and needs a tab
  if (!sender.tab) {
    return;
  }
  if (request.cmd === 'popup-request') {
    blockHistory.add(sender.tab.id, {
      hostname: request.hostname,
      href: request.href,
      type: request.type,
      ts: Date.now()
    });
    // snooze: history recorded, badge increments (via badge.js listener), but no card
    if (snoozeMap.has(sender.tab.id) && Date.now() < snoozeMap.get(sender.tab.id)) {
      return;
    }
    config.get(['silent', 'block-hosts', 'issue', 'placement', 'width']).then(prefs => {
      if (prefs.issue === false) {
        return;
      }
      // permanently blocked popup source: skip the notification UI.
      // badge.js still increments the counter on this same message.
      const src = request.hostname;
      if (src && PPolicy.matchesHost(src, prefs['block-hosts'] || [])) {
        return;
      }
      const {hostname} = new URL(sender.tab.url);
      if (prefs.silent.includes(hostname)) {
        return;
      }
      // render the notification overlay in the TOP frame (frameId 0).
      // the originating frameId is preserved so "Allow" routes back to the
      // right frame for the record/replay step.
      chrome.tabs.sendMessage(sender.tab.id, {
        cmd: 'show-notification',
        type: request.type,
        href: request.href,
        hostname: request.hostname,
        id: request.id,
        frameId: sender.frameId,
        placement: prefs.placement,
        width: prefs.width
      }, {frameId: 0}, () => chrome.runtime.lastError);
    });
  }
  // popup is accepted
  else if (request.cmd === 'popup-accepted') {
    if (request.url.startsWith('http') || request.url.startsWith('ftp')) {
      config.get(['simulate-allow']).then(prefs => {
        if (prefs['simulate-allow'] && request.sameContext !== true) {
          chrome.tabs.create({
            url: request.url,
            openerTabId: sender.tab.id
          });
        }
        else {
          chrome.tabs.sendMessage(sender.tab.id, request, {
            frameId: request.frameId
          });
        }
      });
    }
    else {
      chrome.tabs.sendMessage(sender.tab.id, request, {
        frameId: request.frameId
      });
    }
  }
  else if (request.cmd === 'run-records') {
    chrome.scripting.executeScript({
      target: {
        tabId: sender.tab.id,
        frameIds: [sender.frameId]
      },
      world: 'MAIN',
      func: (records, href, args) => {
        if (records) {
          const w = window.open(...args);
          for (const record of records) {
            let c = w;
            for (const name of record.tree) {
              c = c[name];
            }
            const {method, args} = record.action;
            if (method) {
              c[method](...args);
            }
            const {prop, value} = record.action;
            if (prop) {
              c[prop] = value;
            }
          }
        }
        else if (/^(https?|ftp):/i.test(href) || href === 'about:blank') {
          const a = document.createElement('a');
          a.target = '_blank';
          a.href = href;
          a.click();
        }
      },
      args: [request.records || false, request.url, request.args]
    }).finally(() => response(true));

    return true;
  }
  // open a new tab or redirect current tab
  else if (request.cmd === 'popup-redirect' || request.cmd === 'open-tab') {
    const url = request.url;
    // validating request before proceeding
    if (url.startsWith('http') || url.startsWith('ftp') || url === 'about:blank') {
      if (request.cmd === 'popup-redirect') {
        // make sure redirect prevent is off (this needs {frameId: 1} when Edge supports it)
        chrome.tabs.sendMessage(sender.tab.id, {
          cmd: 'release-beforeunload'
        }, () => {
          chrome.tabs.update(sender.tab.id, {
            url
          });
        });
      }
      else {
        chrome.tabs.create({
          url,
          active: false,
          index: sender.tab.index + 1
        });
      }
    }
  }
  else if (request.cmd === 'white-list') {
    config.get(['whitelist-mode', 'top-hosts', 'popup-hosts']).then(prefs => {
      const mode = prefs['whitelist-mode'];

      let hostname = '';
      try {
        hostname = new URL(mode === 'popup-hosts' ? request.url : request.parent).hostname;
      }
      catch (e) {}
      if (!hostname) {
        return;
      }
      prefs[mode].push(hostname);
      prefs[mode] = prefs[mode].filter((h, i, l) => l.indexOf(h) === i);
      config.set({
        [mode]: prefs[mode]
      });
      // re-registration (excludeMatches) happens via config.changed -> activate();
      // reload so the now-excluded top-frame site loses the blocker immediately.
      if (mode === 'top-hosts') {
        chrome.tabs.reload(sender.tab.id);
      }
    });
  }
  // permanently block all popups from a source hostname
  else if (request.cmd === 'block-host') {
    if (request.hostname) {
      config.get(['block-hosts']).then(prefs => {
        const list = prefs['block-hosts'] || [];
        if (!list.includes(request.hostname)) {
          list.push(request.hostname);
          config.set({'block-hosts': list});
        }
      });
    }
  }
  // undo a just-added block (the notification's Undo toast)
  else if (request.cmd === 'unblock-host') {
    if (request.hostname) {
      config.get(['block-hosts']).then(prefs => {
        const list = (prefs['block-hosts'] || []).filter(h => h !== request.hostname);
        config.set({'block-hosts': list});
      });
    }
  }
});

/* keep the per-tab blocked history scoped to the current page */
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) {
    blockHistory.clear(tabId); // top-frame navigation -> fresh page history
    snoozeMap.delete(tabId);
  }
});
chrome.tabs.onRemoved.addListener(tabId => {
  blockHistory.clear(tabId);
  snoozeMap.delete(tabId);
});

/* commands */
chrome.commands.onCommand.addListener(cmd => chrome.tabs.query({
  active: true,
  lastFocusedWindow: true
}, tabs => tabs && tabs[0] && chrome.tabs.sendMessage(tabs[0].id, {
  cmd
})));
