'use strict';
importScripts('export.js');

// Future destinations implement deliver(review) here, behind explicit user selection.
// The content script neither knows API tokens nor sends network requests.
const destinations = {
  async file(review) {
    const markdown = PageCritExport.renderDigest(review);
    const filename = PageCritExport.filename(review);
    const id = await saveMarkdown(markdown, filename);
    await remember(review, markdown, filename);
    return {ok: true, downloadId: id};
  }
};
function saveMarkdown(markdown, filename) {
  return chrome.downloads.download({
    url: 'data:text/markdown;charset=utf-8,' + encodeURIComponent(markdown),
    filename,
    saveAs: true,
    conflictAction: 'uniquify'
  });
}
// The last reviews you copied or downloaded, so one closed with Done can still be fetched.
// Kept as finished Markdown in chrome.storage.local (this browser profile only, never synced
// or uploaded); a review copied again replaces its older copy. Clear removes them all.
const RECENT_KEY = 'recent';
const MAX_RECENT = 10;
async function recentList() {
  const list = (await chrome.storage.local.get(RECENT_KEY))[RECENT_KEY];
  return Array.isArray(list) ? list : [];
}
async function remember(review, markdown, filename) {
  try {
    if (!chrome.storage?.local) return;
    const entry = {
      id: String(review.session.id), title: String(review.page.title || '').slice(0, 300), url: review.page.url,
      pages: review.pages?.length || 1, items: review.comments.length + review.edits.length + review.removals.length,
      savedAt: new Date().toISOString(), filename, markdown
    };
    const list = (await recentList()).filter(other => other.id !== entry.id);
    await chrome.storage.local.set({[RECENT_KEY]: [entry, ...list].slice(0, MAX_RECENT)});
  } catch (_) { /* Remembering is a convenience; delivery already happened. */ }
}
async function handleRecent(message) {
  const list = await recentList();
  if (message.action === 'list') return {ok: true, reviews: list.map(({markdown, ...meta}) => meta)};
  if (message.action === 'clear') { await chrome.storage.local.remove(RECENT_KEY); return {ok: true}; }
  if (message.action === 'delete') { await chrome.storage.local.set({[RECENT_KEY]: list.filter(other => other.id !== message.id)}); return {ok: true}; }
  const entry = list.find(other => other.id === message.id);
  if (!entry) return {ok: false, error: 'That review is no longer saved.'};
  if (message.action === 'markdown') return {ok: true, markdown: entry.markdown};
  if (message.action === 'download') return {ok: true, downloadId: await saveMarkdown(entry.markdown, entry.filename)};
  return {ok: false};
}
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
  if (message?.type === 'PAGECRIT_DRAFT') {
    if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || !/^https?:\/\//i.test(sender.url || '')) { respond({ok: false}); return; }
    handleDraft(message, sender.tab.id).then(respond).catch(() => respond({ok: false}));
    return true;
  }
  if (message?.type === 'PAGECRIT_RECENT') {
    if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || !/^https?:\/\//i.test(sender.url || '')) { respond({ok: false}); return; }
    handleRecent(message).then(respond).catch(error => respond({ok: false, error: error.message}));
    return true;
  }
  if (message?.type === 'PAGECRIT_FONT') {
    if (sender.id !== chrome.runtime.id || !sender.tab) return;
    handFont().then(respond).catch(() => respond({ok: false}));
    return true;
  }
  if (message?.type !== 'PAGECRIT_EXPORT' && message?.type !== 'PAGECRIT_RENDER') return;
  // Only our injected top-frame script can request a local export. No external messaging API.
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || !/^https?:\/\//i.test(sender.url || '')) {
    respond({ok: false, error: 'Export must come from the page you are reviewing.'});
    return;
  }
  if (message.type === 'PAGECRIT_RENDER') {
    let markdown;
    try { markdown = PageCritExport.renderDigest(message.review); } catch (error) { respond({ok: false, error: error.message}); return; }
    remember(message.review, markdown, PageCritExport.filename(message.review)).then(() => respond({ok: true, markdown}));
    return true;
  }
  destinations.file(message.review).then(respond).catch(error => respond({ok: false, code: error.code, error: error.message || 'Download failed. Your draft is still open.'}));
  return true;
});

// The toolbar button opens the review panel directly.
// Clicking it grants activeTab for the current tab only. Pages that can't be reviewed get a short
// reason on the toolbar button instead of an overlay.
async function startReview(tab) {
  if (!tab?.id) return false;
  try {
    if (!/^https?:\/\//i.test(tab.url || '')) return explain(tab.id, 'PageCrit works on regular web pages, not browser pages, PDFs or the Chrome Web Store.');
    const started = await inject(tab.id, {show: true});
    return started === true ? true : explain(tab.id, started);
  } catch (_) {
    return explain(tab.id, 'Chrome doesn’t allow PageCrit on this page.');
  }
}
async function explain(tabId, reason) {
  if (!chrome.action) return false;
  await chrome.action.setBadgeText({tabId, text: '!'});
  await chrome.action?.setBadgeBackgroundColor?.({tabId, color: '#d9443a'});
  await chrome.action?.setTitle({tabId, title: `PageCrit: ${reason}`});
  setTimeout(() => {
    chrome.action?.setBadgeText({tabId, text: ''}).catch(() => {});
    chrome.action?.setTitle({tabId, title: 'PageCrit: review this page'}).catch(() => {});
  }, 6000);
  return false;
}
chrome.action?.onClicked.addListener(tab => { startReview(tab).catch(() => {}); });
// `show: false` (automatic restore) leaves an already running review exactly as it is.
async function inject(tabId, {show}) {
  const tab = {id: tabId};
  const [inspection] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: () => ({
    modal: Boolean(document.querySelector('dialog:modal')),
    contentType: document.contentType,
    running: Boolean(globalThis.__pageCritSession)
  })});
  if (inspection?.result?.running && !show) return false;
  if (inspection?.result?.modal) return 'Close the page’s dialog first, then click again.';
  if (!['text/html', 'application/xhtml+xml'].includes(inspection?.result?.contentType)) return 'This isn’t an HTML page, so it can’t be reviewed.';
  await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['core.js', 'content.js']});
  return true;
}

// After a reload or navigation, continue an open review if Chrome still grants access to the tab.
// Without access (e.g. another site), the draft waits until the reviewer clicks the toolbar button.
chrome.tabs?.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  chrome.storage.session.get(draftKey(tabId)).then(found => { if (found[draftKey(tabId)]) return inject(tabId, {show: false}); }).catch(() => {});
});
chrome.tabs?.onRemoved.addListener(tabId => { chrome.storage?.session.remove(draftKey(tabId)).catch(() => {}); });
