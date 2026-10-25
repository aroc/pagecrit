'use strict';
importScripts('export.js');

// Future destinations implement deliver(review) here, behind explicit user selection.
// The content script neither knows API tokens nor sends network requests.
const destinations = {
  async file(review) {
    const markdown = PageNotesExport.renderDigest(review);
    const id = await chrome.downloads.download({
      url: 'data:text/markdown;charset=utf-8,' + encodeURIComponent(markdown),
      filename: PageNotesExport.filename(review),
      saveAs: true,
      conflictAction: 'uniquify'
    });
    return {ok: true, downloadId: id};
  }
};
// The overlay's handwriting face ships inside the extension. Handing the bytes over here
// avoids web_accessible_resources, so pages cannot probe for the extension.
let fontData = null;
async function handFont() {
  if (!fontData) {
    const bytes = new Uint8Array(await (await fetch(chrome.runtime.getURL('fonts/caveat-latin.woff2'))).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    fontData = btoa(binary);
  }
  return {ok: true, data: fontData};
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'PAGE_NOTES_FONT') {
    if (sender.id !== chrome.runtime.id || !sender.tab) return;
    handFont().then(respond).catch(() => respond({ok: false}));
    return true;
  }
  if (message?.type !== 'PAGE_NOTES_EXPORT') return;
  // Only our injected top-frame script can request a local export. No external messaging API.
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || !/^https?:\/\//i.test(sender.url || '')) {
    respond({ok: false, error: 'Export must come from the page you are reviewing.'});
    return;
  }
  destinations.file(message.review).then(respond).catch(error => respond({ok: false, code: error.code, error: error.message || 'Download failed. Your draft is still open.'}));
  return true;
});
