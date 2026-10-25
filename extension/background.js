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
// Review drafts survive reloads and navigation in the same tab. storage.session is in memory,
// cleared when the browser closes, and not readable by web pages or content scripts.
const draftKey = tabId => `draft:${tabId}`;
const MAX_DRAFT_CHARS = 4 * 1024 * 1024;
async function handleDraft(message, tabId) {
  const key = draftKey(tabId);
  if (message.action === 'load') return {ok: true, draft: (await chrome.storage.session.get(key))[key] || null};
  if (message.action === 'clear') { await chrome.storage.session.remove(key); return {ok: true}; }
  if (message.action === 'save' && message.draft && JSON.stringify(message.draft).length <= MAX_DRAFT_CHARS) {
    await chrome.storage.session.set({[key]: message.draft});
    return {ok: true};
  }
  return {ok: false};
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'PAGE_NOTES_DRAFT') {
    if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || !/^https?:\/\//i.test(sender.url || '')) { respond({ok: false}); return; }
    handleDraft(message, sender.tab.id).then(respond).catch(() => respond({ok: false}));
    return true;
  }
  if (message?.type === 'PAGE_NOTES_FONT') {
    if (sender.id !== chrome.runtime.id || !sender.tab) return;
    handFont().then(respond).catch(() => respond({ok: false}));
    return true;
  }
  if (message?.type !== 'PAGE_NOTES_EXPORT' && message?.type !== 'PAGE_NOTES_RENDER') return;
  // Only our injected top-frame script can request a local export. No external messaging API.
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || !/^https?:\/\//i.test(sender.url || '')) {
    respond({ok: false, error: 'Export must come from the page you are reviewing.'});
    return;
  }
  if (message.type === 'PAGE_NOTES_RENDER') {
    try { respond({ok: true, markdown: PageNotesExport.renderDigest(message.review)}); } catch (error) { respond({ok: false, error: error.message}); }
    return;
  }
  destinations.file(message.review).then(respond).catch(error => respond({ok: false, code: error.code, error: error.message || 'Download failed. Your draft is still open.'}));
  return true;
});

// Keyboard shortcut (Alt+Shift+N by default) starts a review like the toolbar popup does.
// Invoking a command grants activeTab for the current tab only.
async function startReview(tab) {
  if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) return false;
  return inject(tab.id, {show: true});
}
// `show: false` (automatic restore) leaves an already running review exactly as it is.
async function inject(tabId, {show}) {
  const tab = {id: tabId};
  const [inspection] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: () => ({
    modal: Boolean(document.querySelector('dialog:modal')),
    contentType: document.contentType,
    running: Boolean(globalThis.__pageNotesSession)
  })});
  if (inspection?.result?.running && !show) return false;
  if (inspection?.result?.modal || !['text/html', 'application/xhtml+xml'].includes(inspection?.result?.contentType)) return false;
  await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['core.js', 'content.js']});
  return true;
}
chrome.commands?.onCommand.addListener((command, tab) => {
  if (command === 'start-review') startReview(tab).catch(() => {});
});

// After a reload or navigation, continue an open review if Chrome still grants access to the tab.
// Without access (e.g. another site), the draft waits until the reviewer clicks the toolbar button.
chrome.tabs?.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  chrome.storage.session.get(draftKey(tabId)).then(found => { if (found[draftKey(tabId)]) return inject(tabId, {show: false}); }).catch(() => {});
});
chrome.tabs?.onRemoved.addListener(tabId => { chrome.storage?.session.remove(draftKey(tabId)).catch(() => {}); });
