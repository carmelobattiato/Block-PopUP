/* Block PopUP — injected only on excluded ("disabled") top sites.
   Tells the toolbar icon this tab is not protected. */
try {
  if (chrome.runtime?.id) {
    chrome.runtime.sendMessage({cmd: 'state', active: false});
  }
}
catch (e) { /* orphaned content script */ }
