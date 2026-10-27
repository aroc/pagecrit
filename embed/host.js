/* In-page stand-in for the extension's service worker, used by the pagecrit.dev demo build
   (npm run embed). It answers the same messages as background.js. Nothing leaves the browser:
   the draft lives in this tab's sessionStorage, recent reviews in this site's localStorage,
   and downloads are local Blob files. */
(function (root) {
  'use strict';
  const DRAFT_KEY = 'pagecrit:draft';
  const RECENT_KEY = 'pagecrit:recent';
  const LAYOUT_KEY = 'pagecrit:layout';
  const MAX_RECENT = 10;
  const MAX_DRAFT_CHARS = 4 * 1024 * 1024;
  const Export = root.PageCritExport;
  const read = (store, key) => { try { return JSON.parse(store.getItem(key)); } catch (_) { return null; } };
  const write = (store, key, value) => { try { store.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } };
  const recentList = () => { const list = read(localStorage, RECENT_KEY); return Array.isArray(list) ? list : []; };
  function remember(review, markdown, filename) {
    const entry = {
      id: String(review.session.id), title: String(review.page.title || '').slice(0, 300), url: review.page.url,
      pages: review.pages?.length || 1, items: review.comments.length + review.edits.length + review.removals.length,
      savedAt: new Date().toISOString(), filename, markdown
    };
    write(localStorage, RECENT_KEY, [entry, ...recentList().filter(other => other.id !== entry.id)].slice(0, MAX_RECENT));
  }
  // A detached link: its click never reaches the page or PageCrit's own click blocking.
  function download(markdown, filename) {
    const url = URL.createObjectURL(new Blob([markdown], {type: 'text/markdown;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  let fontData = null;
  async function handFont() {
    if (!fontData) {
      const bytes = new Uint8Array(await (await fetch(host.fontUrl)).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      fontData = btoa(binary);
    }
    return {ok: true, data: fontData};
  }
  function handleDraft(message) {
    if (message.action === 'load') return {ok: true, draft: read(sessionStorage, DRAFT_KEY)};
    if (message.action === 'clear') { try { sessionStorage.removeItem(DRAFT_KEY); } catch (_) { /* Nothing saved. */ } return {ok: true}; }
    if (message.action === 'save' && message.draft && JSON.stringify(message.draft).length <= MAX_DRAFT_CHARS) return {ok: write(sessionStorage, DRAFT_KEY, message.draft)};
    return {ok: false};
  }
  function handleRecent(message) {
    const list = recentList();
    if (message.action === 'list') return {ok: true, reviews: list.map(({markdown, ...meta}) => meta)};
    if (message.action === 'clear') { try { localStorage.removeItem(RECENT_KEY); } catch (_) { /* Nothing saved. */ } return {ok: true}; }
    if (message.action === 'delete') return {ok: write(localStorage, RECENT_KEY, list.filter(other => other.id !== message.id))};
    const entry = list.find(other => other.id === message.id);
    if (!entry) return {ok: false, error: 'That review is no longer saved.'};
    if (message.action === 'markdown') return {ok: true, markdown: entry.markdown};
    if (message.action === 'download') { download(entry.markdown, entry.filename); return {ok: true}; }
    return {ok: false};
  }
  function handle(message) {
    if (message?.type === 'PAGECRIT_DRAFT') return handleDraft(message);
    if (message?.type === 'PAGECRIT_RECENT') return handleRecent(message);
    if (message?.type === 'PAGECRIT_FONT') return handFont();
    if (message?.type === 'PAGECRIT_LAYOUT') {
      if (message.action !== 'set') return {ok: true, layout: read(localStorage, LAYOUT_KEY)};
      const {sidebar, width} = message.layout || {};
      return {ok: typeof sidebar === 'boolean' && Number.isFinite(width) && write(localStorage, LAYOUT_KEY, {sidebar, width})};
    }
    if (message?.type !== 'PAGECRIT_EXPORT' && message?.type !== 'PAGECRIT_RENDER') return {ok: false};
    const markdown = Export.renderDigest(message.review);
    const filename = Export.filename(message.review);
    if (message.type === 'PAGECRIT_EXPORT') download(markdown, filename);
    remember(message.review, markdown, filename);
    return {ok: true, markdown};
  }
  const host = {
    fontUrl: '',
    async sendMessage(message) {
      try { return await handle(message); } catch (error) { return {ok: false, error: error.message}; }
    },
    // The toolbar button is the only sender in the extension; the demo has none.
    onMessage: {addListener() {}, removeListener() {}}
  };
  root.PageCritHost = host;
})(globalThis);
