'use strict';
importScripts('export.js');

// Future destinations implement deliver(bundle) here, behind explicit user selection.
// The content script neither knows API tokens nor sends network requests.
const destinations = {
  async file(bundle) {
    const json = PageNotesExport.serializeBundle(bundle);
    const id = await chrome.downloads.download({
      url: 'data:application/json;charset=utf-8,' + encodeURIComponent(json),
      filename: PageNotesExport.filename(bundle),
      saveAs: true,
      conflictAction: 'uniquify'
    });
    return {ok: true, downloadId: id};
  }
};
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'PAGE_NOTES_EXPORT') return;
  // Only our injected top-frame script can request a local export. No external messaging API.
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || !/^https?:\/\//i.test(sender.url || '')) {
    respond({ok: false, error: 'Export must come from the page you are reviewing.'});
    return;
  }
  destinations.file(message.bundle).then(respond).catch(error => respond({ok: false, error: error.message || 'Download failed. Your draft is still open.'}));
  return true;
});
