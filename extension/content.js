/* Page Notes: an explicit, local-only review session. No automatic page access. */
(() => {
  'use strict';
  if (globalThis.__pageNotesSession) {
    globalThis.__pageNotesSession.show();
    return;
  }
  const core = globalThis.PageNotesCore;
  if (!core) throw new Error('Page Notes core did not load. Reload the extension and try again.');

  const MAX_TEXT = 20000;
  const MAX_COMMENT = 10000;
  const MAX_ITEMS = 500;
  const VERSION = '0.2.0';
  const id = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const startUrl = location.href;
  const startTitle = document.title;
  const initialViewport = { width: innerWidth, height: innerHeight, devicePixelRatio };
  const initialScroll = { x: scrollX, y: scrollY };
  const state = {
    sessionId: id(), startedAt: now(),
    mode: 'browse', anchorKind: 'element', comments: [], edits: [], removals: [],
    pending: null, notice: '', noticeType: '', busy: false, confirmingClose: false,
    collapsed: false, dock: 'tr', pos: null, closed: false, frame: 0, routeChanged: false,
    sent: '', hoverPoint: null, selectedId: null, revealSelected: false,
  };
  // References never enter the exported review. Keeping them avoids matching a different
  // repeated element when a framework replaces DOM nodes during a review.
  const pinElements = new Map();
  const pinContainers = new Map();
  const editSegments = new Map();
  const removedElements = new Map();

  const host = document.createElement('div');
  host.setAttribute('data-page-notes-root', '');
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  // Pen-on-printout: cobalt ink pins, a highlighter for what's active, red pen for removals.
  style.textContent = `
    :host{--ink:#1f2430;--pencil:#676b79;--faint:#9a9daa;--line:#ebecf1;--paper:#fff;--wash:#f6f7fa;--cobalt:#2f4be0;--cobalt-deep:#2238b8;--cobalt-soft:#eef1fe;--marker:#ffe36e;--marker-soft:#fff5c4;--red:#d9443a;--red-soft:#fdeeec;--green:#1d7f4c;--green-mark:#c9efd6;--hand:"Page Notes Hand",ui-rounded,system-ui,sans-serif;--sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font:14px/1.5 var(--sans);color:var(--ink);color-scheme:light}
    *,*::before,*::after{box-sizing:border-box} [hidden]{display:none!important}.sr{position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    button,input,textarea,select{font:inherit;color:inherit} button{cursor:pointer} button:disabled{cursor:wait;opacity:.5}
    button:focus-visible,textarea:focus-visible,select:focus-visible,.item:focus-visible{outline:2px solid var(--cobalt);outline-offset:2px}
    .panel{font:14px/1.5 var(--sans);color:var(--ink);pointer-events:auto;position:fixed;right:18px;top:18px;width:364px;max-width:calc(100vw - 32px);max-height:calc(100vh - 36px);display:flex;flex-direction:column;background:var(--paper);border:1px solid #e3e4eb;border-radius:22px;box-shadow:0 1px 0 #1f24300a,0 28px 64px -24px #1f243066;overflow:hidden}
    .header{padding:14px 12px 4px 18px;display:flex;gap:8px;align-items:center;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none}.dragging,.dragging .header{cursor:grabbing}
    .logo{font-size:19px;line-height:1}.brand{font:700 29px/1 var(--hand);letter-spacing:.2px;flex:1;transform:translateY(1px)}
    .smallbutton{border:0;background:transparent;border-radius:999px;color:var(--pencil);width:30px;height:30px;display:grid;place-items:center;font-size:18px;line-height:1}.smallbutton:hover{background:var(--wash);color:var(--ink)}
    .body{overflow:auto;padding:4px 18px 16px}.muted{color:var(--pencil);font-size:13px}
    .modes{display:flex;gap:2px;margin:6px -6px 4px}.mode{flex:1 1 auto;border:0;background:transparent;color:var(--pencil);font-size:13px;font-weight:600;padding:8px 6px;border-radius:5px 12px 6px 13px/12px 6px 13px 5px;white-space:nowrap}.mode:hover{color:var(--ink)}
    .mode.active{color:var(--ink);background:var(--marker);transform:rotate(-1.2deg)}
    .anchor{display:flex;gap:16px;margin:6px 0 2px}.anchoropt{border:0;background:none;padding:2px 0;font-size:13px;color:var(--pencil);border-bottom:2px solid transparent}.anchoropt.active{color:var(--ink);font-weight:600;border-bottom-color:var(--cobalt)}
    .instructions{font-size:13px;color:var(--pencil);margin:8px 0 12px}
    .notice{padding:9px 12px;background:var(--cobalt-soft);color:var(--cobalt-deep);border-radius:12px;font-size:13px;margin:10px 0;overflow-wrap:anywhere}.notice.error{background:var(--red-soft);color:#a8322a}
    .editor{padding:14px;border-radius:16px;background:var(--wash);margin:12px 0}.editor h3{font:700 23px/1.1 var(--hand);margin:0 0 8px}.editor textarea{resize:vertical;width:100%;min-height:105px;max-height:300px;background:var(--paper);border:1px solid #dfe1e8;border-radius:12px;padding:10px 12px;font-size:14px;line-height:1.5}.editor textarea:focus-visible{outline:none;border-color:var(--cobalt);box-shadow:0 0 0 3px #2f4be026}.editor label{display:block;font-size:13px;color:var(--pencil);margin-bottom:8px}.editor .muted{margin:0}
    .actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
    .button{border:1px solid #dcdee6;border-radius:12px;padding:8px 14px;background:var(--paper);font-size:13px;font-weight:600}.button:hover{border-color:#c4c7d2}.primary{background:var(--cobalt);color:white;border-color:var(--cobalt)}.primary:hover{background:var(--cobalt-deep);border-color:var(--cobalt-deep)}.danger{color:#a8322a;border-color:#f0c3be}
    .sectionhead{display:flex;align-items:baseline;justify-content:space-between;margin:18px 0 4px}.sectionhead .title{font:700 25px/1 var(--hand)}.sectionhead .count{font-size:12px;color:var(--faint)}
    .empty{padding:18px 4px 6px;text-align:center;color:var(--faint);font:500 21px/1.2 var(--hand)}
    .item{padding:12px 0;border-bottom:1px solid var(--line)}.item:last-child{border-bottom:0}.itemtop{display:flex;gap:9px;align-items:center;margin-bottom:6px}
    .badge{flex:none;min-width:24px;height:24px;border-radius:999px;display:grid;place-items:center;background:var(--cobalt);color:white;font:700 17px/1 var(--hand)}.badge.text{background:var(--green-mark);color:var(--green);font:700 11px/1 var(--sans)}.badge.removed{background:var(--red-soft);color:var(--red);font:700 14px/1 var(--sans)}
    .itemlabel{flex:1;font-size:12px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .itemtext{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;max-height:120px;overflow:auto}.struck{text-decoration:line-through;text-decoration-color:var(--red);text-decoration-thickness:1.5px;color:var(--pencil)}
    .diff{font-size:14px;margin:2px 0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:96px;overflow:auto}.before{color:var(--faint);text-decoration:line-through;text-decoration-color:var(--red);text-decoration-thickness:1.5px}.after{color:var(--ink)}.after .mark{background:linear-gradient(transparent 58%,var(--green-mark) 58%,var(--green-mark) 92%,transparent 92%);-webkit-box-decoration-break:clone;box-decoration-break:clone}
    .warning{color:#a8322a;font-size:12px;margin:6px 0 0}.itemactions{display:flex;justify-content:flex-end;gap:2px;margin-top:4px}.link{font-size:12px;font-weight:600;background:none;border:0;color:var(--pencil);padding:3px 7px;border-radius:8px}.link:hover{color:var(--cobalt);background:var(--cobalt-soft)}
    .item.reveal{cursor:pointer;margin:0 -18px;padding:12px 18px}.item.reveal:hover{background:#fafbfc}.item.reveal:focus-visible{outline-offset:-2px}
    .item.selected{background:var(--marker-soft)}.item.selected:hover{background:var(--marker-soft)}.item.pulse{animation:pulse 1s ease-out}@keyframes pulse{from{background:var(--marker)}to{background:var(--marker-soft)}}
    .footer{border-top:1px solid var(--line);padding:14px 18px 16px}.done{width:100%;padding:12px;font-size:14px;border-radius:14px}.done+.done{margin-top:8px}.privacy{font-size:12px;color:var(--faint);text-align:center;margin:8px 0 0}
    .closebox{padding:14px;background:var(--red-soft);border-radius:16px;margin:8px 0 12px;font-size:13px}.closebox p{margin:0}
    .pill{pointer-events:auto;position:fixed;right:18px;top:18px;display:flex;align-items:center;gap:8px;border:1px solid #e3e4eb;border-radius:999px;padding:7px 9px 7px 13px;background:var(--paper);box-shadow:0 1px 0 #1f24300a,0 14px 34px -14px #1f243066;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}.pill .brand{font-size:23px;flex:none}.pill .count{min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:var(--cobalt);color:white;font:700 12px/22px var(--sans);text-align:center}
    .pin{pointer-events:auto;position:fixed;width:28px;height:28px;display:grid;place-items:center;border:2px solid white;border-radius:50% 50% 50% 5px;transform:translate(-50%,-100%) rotate(-4deg);box-shadow:0 3px 10px #1f243055;background:var(--cobalt);color:white;font:700 18px/1 var(--hand);padding:0 0 1px}.pin:hover{background:var(--cobalt-deep)}.pin.lost{background:#8d8f9a}.pin.pending{background:var(--marker);color:var(--ink)}.pin.selected{z-index:1;box-shadow:0 0 0 4px var(--marker),0 3px 12px #1f243066}
    .highlight,.hover{pointer-events:none;position:fixed;border:2px dashed var(--cobalt);border-radius:6px;background:#2f4be00a;display:none}.highlight{border-style:solid;background:#ffe36e33;border-color:#e8c534}
    .hovertag{position:absolute;left:-2px;bottom:100%;margin-bottom:4px;background:var(--cobalt);color:white;font:600 11px/1.6 var(--sans);padding:1px 7px;border-radius:999px;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis}.hover.inside .hovertag{bottom:auto;top:0;margin:4px}
    .hover.danger{border-color:var(--red);background:#d9443a12}.hover.danger .hovertag{background:var(--red)}
    @media(prefers-reduced-motion:reduce){.item.pulse{animation:none}.mode.active{transform:none}}
    @media(max-width:500px){.mode{white-space:normal;line-height:1.2}.panel{right:8px;top:8px;max-height:calc(100vh - 16px);width:310px}.pill{right:8px;top:8px}}
  `;
  const pinsLayer = document.createElement('div');
  const highlight = document.createElement('div');
  highlight.className = 'highlight';
  // Outline drawn in the overlay so hovering never changes page layout or styles.
  const hoverBox = document.createElement('div');
  hoverBox.className = 'hover';
  const hoverTag = document.createElement('span');
  hoverTag.className = 'hovertag';
  hoverBox.append(hoverTag);
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.setAttribute('aria-label', 'Page Notes review');
  // Screen-reader-only confirmation for actions that need no visible callout.
  const liveRegion = document.createElement('div');
  liveRegion.className = 'sr'; liveRegion.setAttribute('role', 'status');
  const pill = document.createElement('button');
  pill.className = 'pill';
  pill.hidden = true;
  pill.addEventListener('click', event => {
    if (!event.isTrusted) return;
    state.collapsed = false; render();
  });
  // The panel and pill float freely: drag the header (or the pill) anywhere, even
  // partly off screen. A corner dock keeps them attached to that corner on resize.
  let drag = null;
  let suppressClick = false;
  let shownCollapsed = false;
  const KEEP_VISIBLE = 48;
  function startDrag(event) {
    if (!event.isTrusted || event.button !== 0 || state.closed) return;
    const el = event.currentTarget;
    // The whole header is a handle (buttons too), so a mostly off-screen panel can still be grabbed.
    if (el === panel && !event.target.closest('.header')) return;
    const rect = el.getBoundingClientRect();
    drag = { el, id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top, x0: event.clientX, y0: event.clientY, moved: false };
    // Capturing immediately would retarget a plain button click; buttons capture once a drag starts.
    if (el === pill || !event.target.closest('button')) el.setPointerCapture(event.pointerId);
  }
  function moveDrag(event) {
    if (!event.isTrusted || !drag || event.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x0, event.clientY - drag.y0) < 4) return;
    if (!drag.moved) { drag.moved = true; drag.el.classList.add('dragging'); if (!drag.el.hasPointerCapture(drag.id)) drag.el.setPointerCapture(drag.id); }
    state.dock = null; state.pos = { x: event.clientX - drag.dx, y: event.clientY - drag.dy };
    placeFloating();
  }
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    // A drag that ends over a header button or the pill must not also activate it.
    if (drag.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
    drag.el.classList.remove('dragging');
    if (drag.el.hasPointerCapture(drag.id)) drag.el.releasePointerCapture(drag.id);
    drag = null;
  }
  for (const el of [panel, pill]) {
    el.addEventListener('pointerdown', startDrag);
    el.addEventListener('pointermove', moveDrag);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('click', event => { if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  }
  function edgeMargin() { return innerWidth <= 500 ? 8 : 18; }
  function placeFloating() {
    const el = state.collapsed ? pill : panel;
    for (const target of [panel, pill]) Object.assign(target.style, { left: 'auto', right: 'auto', top: 'auto', bottom: 'auto' });
    if (state.dock || !state.pos) {
      const m = `${edgeMargin()}px`, dock = state.dock || 'tr';
      Object.assign(el.style, { [dock[0] === 't' ? 'top' : 'bottom']: m, [dock[1] === 'l' ? 'left' : 'right']: m });
      return;
    }
    const { width, height } = el.getBoundingClientRect();
    // Keep enough of the header or pill on screen to grab it again.
    const x = Math.min(Math.max(state.pos.x, KEEP_VISIBLE - width), innerWidth - KEEP_VISIBLE);
    const y = Math.min(Math.max(state.pos.y, 0), innerHeight - Math.min(height, 44));
    Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
  }
  function snapToCorner() {
    const rect = (state.collapsed ? pill : panel).getBoundingClientRect();
    state.dock = (rect.top + rect.height / 2 > innerHeight / 2 ? 'b' : 't') + (rect.left + rect.width / 2 > innerWidth / 2 ? 'r' : 'l');
    state.pos = null; render();
  }
  function snapIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '15'); svg.setAttribute('height', '15'); svg.setAttribute('aria-hidden', 'true');
    for (const [tag, attrs] of [['rect', { x: 1.5, y: 1.5, width: 13, height: 13, rx: 2.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 }], ['rect', { x: 8.5, y: 3.5, width: 4, height: 4, rx: 1, fill: 'currentColor' }]]) {
      const child = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attrs)) child.setAttribute(key, String(value));
      svg.append(child);
    }
    return svg;
  }
  shadow.append(style, pinsLayer, hoverBox, highlight, panel, pill, liveRegion);
  document.documentElement.appendChild(host);

  async function loadHandFont() {
    try {
      if ([...document.fonts].some(face => face.family.replace(/"/g, '') === 'Page Notes Hand')) return;
      const result = await chrome.runtime.sendMessage({ type: 'PAGE_NOTES_FONT' });
      if (!result?.ok || state.closed) return;
      const bytes = Uint8Array.from(atob(result.data), ch => ch.charCodeAt(0));
      const face = new FontFace('Page Notes Hand', bytes.buffer, { weight: '400 700' });
      document.fonts.add(await face.load());
    } catch (_) { /* The fallback face is fine. */ }
  }
  loadHandFont();
  function element(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function button(text, handler, cls = 'button', title) {
    const el = element('button', cls, text);
    el.type = 'button';
    if (title) { el.title = title; el.setAttribute('aria-label', title); }
    el.disabled = state.busy;
    el.addEventListener('click', event => { if (event.isTrusted) handler(event); });
    return el;
  }
  function tell(message, error = false) { state.notice = message; state.noticeType = error ? 'error' : ''; render(); }
  function ownEvent(event) { return event.composedPath().includes(host); }
  function dirty() { return state.comments.length || state.edits.length || state.removals.length || state.pending; }
  function itemCount() { return state.comments.length + state.edits.length + state.removals.length; }
  function modeLabel() {
    if (state.mode === 'pin' && state.anchorKind === 'element') return 'Hover to choose an element, then click to pin a note to it. The note follows the element.';
    if (state.mode === 'pin') return 'Click anywhere to pin a note to that spot. It scrolls with the page.';
    if (state.mode === 'edit') return 'Click any text to edit it right on the page. Enter saves, Esc cancels.';
    if (state.mode === 'remove') return 'Hover to choose a section, then click to remove it from the page. Restore it from the list below.';
    return 'Browse and scroll normally. Pick a tool to start reviewing.';
  }
  function setMode(mode) {
    if (state.busy) return;
    cancelPending(false);
    state.mode = mode;
    state.confirmingClose = false;
    state.notice = '';
    highlight.style.display = 'none';
    render();
  }
  function render() {
    if (state.closed) return;
    // Collapsing or expanding a free-floating panel keeps the edge nearest the screen edge in place.
    const from = state.collapsed !== shownCollapsed && !state.dock && state.pos ? (shownCollapsed ? pill : panel).getBoundingClientRect() : null;
    panel.hidden = state.collapsed;
    pill.hidden = !state.collapsed;
    shownCollapsed = state.collapsed;
    pill.replaceChildren(element('span', 'logo', '📝'), element('span', 'brand', 'Page Notes'), element('span', 'count', String(itemCount())));
    pill.setAttribute('aria-label', `Open Page Notes, ${itemCount()} ${itemCount() === 1 ? 'item' : 'items'}`);
    panel.replaceChildren();
    const header = element('header', 'header');
    header.append(element('span', 'logo', '📝'), element('span', 'brand', 'Page Notes'));
    const snap = button('', snapToCorner, 'smallbutton snap', 'Snap to nearest corner');
    snap.append(snapIcon()); header.append(snap);
    header.append(button('−', () => { cancelPending(false); state.collapsed = true; state.mode = 'browse'; highlight.style.display = 'none'; render(); }, 'smallbutton', 'Minimize'));
    header.append(button('×', requestClose, 'smallbutton', 'Close review'));
    const body = element('div', 'body');
    if (state.confirmingClose) {
      const box = element('div', 'closebox');
      box.append(element('p', '', 'Close and discard this review? The page goes back to how it was. Download first to keep your notes.'));
      const actions = element('div', 'actions');
      actions.append(button('Keep reviewing', () => { state.confirmingClose = false; render(); }), button('Discard & close', close, 'button danger'));
      box.append(actions); body.append(box);
    }
    const modes = element('div', 'modes');
    for (const [key, label] of [['browse', 'Browse'], ['pin', '⊕ Pin'], ['edit', 'Aa Edit text'], ['remove', '⊖ Remove']]) {
      const b = button(label, () => setMode(key), `mode${state.mode === key ? ' active' : ''}`);
      b.setAttribute('aria-pressed', String(state.mode === key)); modes.append(b);
    }
    body.append(modes);
    if (state.mode === 'pin') {
      const row = element('div', 'anchor');
      row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Pin position');
      for (const [value, text] of [['element', 'Pin to element'], ['page', 'Pin to page']]) {
        const b = button(text, () => { state.anchorKind = value; render(); }, `anchoropt${state.anchorKind === value ? ' active' : ''}`);
        b.setAttribute('aria-pressed', String(state.anchorKind === value)); row.append(b);
      }
      body.append(row);
    }
    body.append(element('p', 'instructions', modeLabel()));
    if (state.notice) { const notice = element('div', `notice ${state.noticeType}`, state.notice); notice.setAttribute('role', 'status'); body.append(notice); }
    if (state.pending) body.append(renderEditor());
    const heading = element('div', 'sectionhead');
    const counts = [[state.comments.length, 'note', 'notes'], [state.edits.length, 'edit', 'edits'], [state.removals.length, 'removal', 'removals']].filter(([n], i) => n || i < 2).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
    heading.append(element('span', 'title', 'This review'), element('span', 'count', counts.join(', ')));
    body.append(heading);
    if (!itemCount()) body.append(element('div', 'empty', 'Nothing marked up yet. Pick a tool and click the page.'));
    state.comments.forEach((comment, index) => body.append(renderComment(comment, index)));
    state.edits.forEach(edit => body.append(renderEdit(edit)));
    state.removals.forEach(removal => body.append(renderRemoval(removal)));
    const footer = element('footer', 'footer');
    const done = button(state.busy ? 'Preparing download…' : state.sent === 'full' ? '✓ Download started' : 'Download review', () => exportReview(), 'button primary done');
    done.setAttribute('aria-label', 'Download review');
    done.disabled = state.busy || Boolean(state.pending);
    footer.append(done);
    panel.append(header, body, footer);
    if (from) {
      const to = (state.collapsed ? pill : panel).getBoundingClientRect();
      state.pos = { x: from.left + from.width / 2 > innerWidth / 2 ? from.right - to.width : from.left, y: from.top + from.height / 2 > innerHeight / 2 ? from.bottom - to.height : from.top };
    }
    placeFloating();
    if (state.revealSelected) {
      state.revealSelected = false;
      const item = body.querySelector('.item.selected');
      if (item) requestAnimationFrame(() => item.scrollIntoView({ block: 'nearest' }));
    }
    renderPins();
  }
  function renderEditor() {
    const pending = state.pending;
    const box = element('div', 'editor');
    const isText = pending.type === 'text';
    if (isText) {
      box.append(element('h3', '', 'Editing text'));
      box.append(element('p', 'muted', 'Type in the outlined text. ⌘/Ctrl+B, I, U and ⇧⌘/Ctrl+X format it. Enter saves · Shift+Enter adds a line break · Esc cancels · clicking elsewhere saves.'));
      const actions = element('div', 'actions');
      actions.append(button('Cancel', () => cancelPending()), button('Save', savePending, 'button primary'));
      box.append(actions);
      return box;
    }
    box.append(element('h3', '', pending.commentId ? 'Edit note' : 'New note'));
    const label = element('label', '', 'What should change here?');
    label.htmlFor = 'page-notes-input'; box.append(label);
    const input = element('textarea');
    input.id = 'page-notes-input';
    input.maxLength = MAX_COMMENT;
    input.value = pending.value;
    input.placeholder = 'E.g. Make this headline more specific.';
    input.addEventListener('input', event => {
      if (!event.isTrusted) return;
      pending.value = input.value;
    });
    input.addEventListener('keydown', event => {
      if (!event.isTrusted) return;
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); savePending(); }
    });
    box.append(input);
    const actions = element('div', 'actions');
    actions.append(button('Cancel', () => cancelPending()), button('Save', savePending, 'button primary'));
    box.append(actions);
    return box;
  }
  // The whole review row scrolls to its place on the page; its buttons keep their own actions.
  function revealOnClick(item, show, label) {
    item.classList.add('reveal'); item.tabIndex = 0; item.title = label;
    item.addEventListener('click', event => { if (event.isTrusted && !state.busy && !event.target.closest('button')) show(); });
    item.addEventListener('keydown', event => {
      if (event.isTrusted && event.target === item && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); show(); }
    });
  }
  function renderComment(comment, index) {
    const item = element('article', `item${state.selectedId === comment.id ? ` selected${state.revealSelected ? ' pulse' : ''}` : ''}`);
    if (state.selectedId === comment.id) item.setAttribute('aria-current', 'true');
    const top = element('div', 'itemtop');
    top.append(element('span', 'badge', String(index + 1)), element('span', 'itemlabel', comment.anchor.kind === 'element' ? 'Element note' : 'Page note'));
    revealOnClick(item, () => showComment(comment), `Show note ${index + 1} on the page`);
    item.append(top, element('p', 'itemtext', comment.text));
    const actions = element('div', 'itemactions');
    actions.append(button('Edit', () => editComment(comment), 'link'), button('Remove', () => removeComment(comment), 'link'));
    item.append(actions);
    return item;
  }
  function renderEdit(edit) {
    const item = element('article', 'item');
    const top = element('div', 'itemtop');
    top.append(element('span', 'badge text', 'Aa'), element('span', 'itemlabel', 'Text change'));
    revealOnClick(item, () => showEdit(edit), 'Show text change on the page');
    item.append(top, element('div', 'diff before', edit.before || '(empty)'), renderFormatted(core.modelFrom(edit.after, edit.formatting), 'diff after'));
    if (!core.segmentCurrent(editSegments.get(edit.id))) item.append(element('p', 'warning', 'The page changed this text. Your requested edit is still saved.'));
    const actions = element('div', 'itemactions');
    actions.append(button('Edit', () => beginTextEdit(null, edit), 'link'), button('Revert', () => revertEdit(edit), 'link'));
    item.append(actions);
    return item;
  }
  function renderRemoval(removal) {
    const item = element('article', 'item');
    const top = element('div', 'itemtop');
    top.append(element('span', 'badge removed', '⊖'), element('span', 'itemlabel', `Removed ${removal.label}`));
    revealOnClick(item, () => showRemoval(removal), 'Show where this section was');
    item.append(top, element('p', 'itemtext struck', removal.text || '(no text)'));
    if (!removedElements.get(removal.id)?.el.isConnected) item.append(element('p', 'warning', 'The page replaced this section. The removal request is still saved.'));
    const actions = element('div', 'itemactions');
    actions.append(button('Restore', () => restoreRemoval(removal), 'link'));
    item.append(actions);
    return item;
  }
  function removableTarget(el) {
    return el instanceof Element && el.isConnected && el !== document.documentElement && el !== document.body && el !== document.head && !el.contains(host) && el !== host;
  }
  // Hidden with an inline display:none so the site's own DOM and framework state stay intact.
  function removeSection(el) {
    if (!removableTarget(el)) { tell('Pick a section inside the page body.', true); return; }
    if (state.removals.length >= MAX_ITEMS) { tell('This review has reached 500 removals. Download it and start a new review.', true); return; }
    // Rendered text (with line breaks between blocks) reads better than raw textContent.
    const removal = { id: id(), createdAt: now(), label: tagLabel(el), text: String(el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500), element: core.describeElement(el), context: core.captureContext(el) };
    const style = el.getAttribute('style');
    el.style.setProperty('display', 'none', 'important');
    removedElements.set(removal.id, { el, style, applied: el.getAttribute('style') });
    state.removals.push(removal);
    state.notice = ''; render();
  }
  function unhide(removal) {
    const entry = removedElements.get(removal.id);
    if (!entry?.el.isConnected) return false;
    // Restore the exact original style unless the site changed it meanwhile.
    if (entry.el.getAttribute('style') === entry.applied) {
      if (entry.style === null) entry.el.removeAttribute('style'); else entry.el.setAttribute('style', entry.style);
    } else if (entry.el.style.getPropertyValue('display') === 'none') entry.el.style.removeProperty('display');
    return true;
  }
  function restoreRemoval(removal) {
    const restored = unhide(removal);
    state.removals = state.removals.filter(r => r.id !== removal.id); removedElements.delete(removal.id);
    state.notice = ''; render();
  }
  function showRemoval(removal) {
    const entry = removedElements.get(removal.id);
    const anchor = entry?.el.isConnected ? (entry.el.previousElementSibling || entry.el.parentElement) : null;
    if (anchor) { anchor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); flash(anchor); }
    else tell('The page replaced this section. The removal request is still in the review.', true);
  }
  function renderFormatted(model, cls) {
    const box = element('div', cls);
    if (!model.text) { box.textContent = '(empty)'; return box; }
    // Inline wrapper so the marker underline hugs the words rather than the whole row.
    const mark = element('span', 'mark'); box.append(mark);
    for (const run of core.modelRuns(model)) {
      let node = document.createTextNode(run.text);
      for (const mark of (run.marks ? run.marks.split(',') : []).reverse()) { const wrap = element({ bold: 'strong', italic: 'em', underline: 'u', strike: 's' }[mark]); wrap.append(node); node = wrap; }
      mark.append(node);
    }
    return box;
  }
  function focusEditor() { requestAnimationFrame(() => { const input = shadow.getElementById('page-notes-input'); input?.focus(); }); }
  function cancelPending(rerender = true) {
    const p = state.pending;
    if (p?.type === 'text') {
      if (core.segmentCurrent(p.seg)) core.renderSegment(p.seg, p.startModel);
      endInline(p);
    }
    state.pending = null;
    if (rerender) render();
  }
  function setEditResult(edit, model, segment) {
    const formatting = core.modelFormatting(model);
    edit.after = model.text;
    // The element's content with the change applied, keeping its inline markup (links, bold…).
    const markup = segment.parent.children.length ? core.inlineMarkup(segment.parent) : '';
    if (markup) edit.markup = markup; else delete edit.markup;
    if (formatting.length) { edit.formatting = formatting; edit.afterHtml = core.modelHtml(model); }
    else { delete edit.formatting; delete edit.afterHtml; }
  }
  function savePending() {
    const p = state.pending;
    if (!p || state.busy) return false;
    if (p.type === 'comment') {
      const text = p.value.trim();
      if (!text) { tell('Add a note before saving.', true); focusEditor(); return false; }
      if (p.commentId) {
        const comment = state.comments.find(c => c.id === p.commentId);
        if (comment && text !== comment.text) { comment.text = text; comment.updatedAt = now(); }
      } else {
        const comment = { id: id(), createdAt: now(), text, anchor: p.anchor, context: p.context };
        state.comments.push(comment); pinElements.set(comment.id, p.element); pinContainers.set(comment.id, p.container);
      }
    } else {
      if (p.conflict || !core.segmentCurrent(p.seg)) {
        // Never overwrite text changed by the page while the editor was open.
        tell('The page replaced or changed this text while you were editing. Cancel and select it again.', true); return false;
      }
      endInline(p);
      let edit = p.editId ? state.edits.find(e => e.id === p.editId) : null;
      const formatting = core.modelFormatting(p.model);
      const original = p.model.text === p.before && !formatting.length;
      if (edit) {
        if (original) { state.edits = state.edits.filter(e => e.id !== edit.id); editSegments.delete(edit.id); }
        else { setEditResult(edit, p.model, p.seg); edit.updatedAt = now(); }
      } else if (!original) {
        edit = { id: p.newId, createdAt: now(), updatedAt: now(), locator: p.locator, context: p.context, before: p.before, after: '' };
        setEditResult(edit, p.model, p.seg);
        state.edits.push(edit); editSegments.set(edit.id, p.seg);
      }
    }
    state.pending = null; state.notice = ''; render();
    return true;
  }
  function beginTextEdit(node, knownEdit, caret) {
    if (state.busy) return;
    cancelPending(false);
    const existing = knownEdit || state.edits.find(edit => core.segmentContains(editSegments.get(edit.id), node));
    const segment = existing ? editSegments.get(existing.id) : core.createSegment(node);
    if (existing && !core.segmentCurrent(segment)) {
      tell('The page changed this text after your edit. Revert the saved request, then select the current text again.', true); return;
    }
    if (!existing) {
      if (!node?.isConnected || !core.isEditableTextNode(node)) { tell('That text is no longer available. Click the current text on the page.', true); return; }
      if (state.edits.length >= MAX_ITEMS) { tell('This review has reached 500 text edits. Download it and start a new review.', true); return; }
      if (node.data.length > MAX_TEXT) { tell('This text block is too long to edit here. Leave a pin instead.', true); return; }
    }
    const model = existing ? core.modelFrom(existing.after, existing.formatting) : core.plainModel(node.data);
    const editHost = segment.parent;
    state.pending = {
      type: 'text', seg: segment, editHost, startModel: model, model, before: existing ? existing.before : node.data,
      context: existing ? existing.context : core.captureContext(node.parentElement, node),
      locator: existing?.locator || core.describeTextNode(node), editId: existing?.id, newId: id(), conflict: false,
      hadEditable: editHost.hasAttribute('contenteditable'), editableValue: editHost.getAttribute('contenteditable'),
      undo: [], redo: [], lastKind: '', lastAt: 0, typingMarks: null, typingAt: -1,
    };
    // Edit in place. Every change is applied by beforeinput to this text's own segment, so
    // neighboring markup is never touched and an emptied node is never removed.
    lockEditableLayout(state.pending);
    editHost.setAttribute('contenteditable', 'plaintext-only');
    holdEditableLayout(state.pending);
    state.mode = 'edit'; state.collapsed = false; state.notice = ''; render();
    if (knownEdit) editHost.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    editHost.focus({ preventScroll: true });
    const offset = caret ? core.segmentOffset(segment, caret.node, caret.offset) : model.text.length;
    placeCaret(state.pending, offset);
  }
  // Chrome's UA styles for editable elements change wrapping (overflow-wrap, white-space),
  // which would reflow the page while editing. Pin the computed values inline meanwhile.
  const WRAP_PROPERTIES = ['overflow-wrap', 'word-break', 'line-break', 'white-space-collapse', 'text-wrap-mode', 'white-space', '-webkit-line-break', 'tab-size'];
  function lockEditableLayout(p) {
    const computed = getComputedStyle(p.editHost);
    p.layout = Object.fromEntries(WRAP_PROPERTIES.map(name => [name, computed.getPropertyValue(name)]));
    p.style = p.editHost.getAttribute('style');
  }
  function holdEditableLayout(p) {
    const computed = getComputedStyle(p.editHost);
    for (const [name, value] of Object.entries(p.layout)) {
      if (value && computed.getPropertyValue(name) !== value) p.editHost.style.setProperty(name, value, 'important');
    }
    p.heldStyle = p.editHost.getAttribute('style');
  }
  function endInline(p) {
    if (p.hadEditable) p.editHost.setAttribute('contenteditable', p.editableValue);
    else p.editHost.removeAttribute('contenteditable');
    if (p.heldStyle !== p.style && p.editHost.getAttribute('style') === p.heldStyle) {
      if (p.style === null) p.editHost.removeAttribute('style'); else p.editHost.setAttribute('style', p.style);
    }
    const selection = getSelection();
    if (selection.rangeCount && p.editHost.contains(selection.anchorNode)) selection.removeAllRanges();
    if (p.editHost.contains(document.activeElement) || document.activeElement === p.editHost) p.editHost.blur();
  }
  function placeCaret(p, start, end = start) {
    const a = core.segmentPosition(p.seg, start), b = core.segmentPosition(p.seg, end);
    if (a && b && a.node.isConnected) getSelection().setBaseAndExtent(a.node, a.offset, b.node, b.offset);
  }
  function inlineCurrent(p) {
    if (core.segmentCurrent(p.seg)) return true;
    if (!p.conflict) { p.conflict = true; tell('The page replaced or changed this text while you were editing. Cancel and select it again.', true); }
    return false;
  }
  function setInline(p, model, caret, caretEnd = caret) {
    core.renderSegment(p.seg, model); p.model = model;
    placeCaret(p, caret, caretEnd); queuePosition();
  }
  function inlineRange(p, event) {
    const ranges = event?.getTargetRanges?.() || [];
    const selection = getSelection();
    const first = ranges[0] || (selection.rangeCount ? selection.getRangeAt(0) : null);
    const last = ranges[ranges.length - 1] || first;
    const length = p.model.text.length;
    if (!first) return [length, length, false];
    const a = core.segmentOffset(p.seg, first.startContainer, first.startOffset), b = core.segmentOffset(p.seg, last.endContainer, last.endOffset);
    return [Math.min(a, b), Math.max(a, b), ranges.length > 0];
  }
  function pushUndo(p, kind, caret) {
    const at = Date.now();
    // Consecutive typing undoes as one step, like a normal text field.
    if (!(kind === 'type' && p.lastKind === 'type' && at - p.lastAt < 1000)) {
      p.undo.push({ model: p.model, caret });
      if (p.undo.length > 200) p.undo.shift();
    }
    p.redo = []; p.lastKind = kind; p.lastAt = at;
  }
  function inlineReplace(p, start, end, text, kind) {
    if (!inlineCurrent(p)) return;
    // New text takes the formatting it replaces or follows, unless a shortcut just toggled it.
    const marks = p.typingMarks !== null && p.typingAt === start && start === end ? p.typingMarks : start < end ? p.model.marks[start] : core.marksAt(p.model, start);
    p.typingMarks = null;
    const model = core.replaceRange(p.model, start, end, text, marks);
    if (model.text.length > MAX_TEXT) { tell('Text edits are limited to 20,000 characters.', true); return; }
    pushUndo(p, kind, end);
    setInline(p, model, start + text.length);
  }
  function applyMark(p, mark) {
    const [start, end] = inlineRange(p);
    if (start === end) {
      // No selection: the shortcut applies to what is typed next at this caret.
      const current = p.typingMarks !== null && p.typingAt === start ? p.typingMarks : core.marksAt(p.model, start);
      p.typingMarks = core.toggleMark({ text: ' ', marks: [current] }, 0, 1, mark).marks[0]; p.typingAt = start;
      return;
    }
    if (!inlineCurrent(p)) return;
    pushUndo(p, 'format', end);
    setInline(p, core.toggleMark(p.model, start, end, mark), start, end);
  }
  function inlineHistory(p, redo) {
    const from = redo ? p.redo : p.undo, to = redo ? p.undo : p.redo;
    if (!from.length || !inlineCurrent(p)) return;
    const step = from.pop();
    to.push({ model: p.model, caret: inlineRange(p)[1] });
    p.lastKind = ''; p.typingMarks = null;
    setInline(p, step.model, Math.min(step.caret, step.model.text.length));
  }
  function stepBack(value, offset) { return offset - (offset > 1 && /[\udc00-\udfff]/.test(value[offset - 1]) && /[\ud800-\udbff]/.test(value[offset - 2]) ? 2 : 1); }
  function stepForward(value, offset) { return offset + (/[\ud800-\udbff]/.test(value[offset]) && /[\udc00-\udfff]/.test(value[offset + 1] || '') ? 2 : 1); }
  function onBeforeInput(event) {
    const p = state.pending;
    if (p?.type !== 'text' || !p.editHost.contains(event.target)) return;
    event.stopImmediatePropagation();
    if (!event.isTrusted) { event.preventDefault(); return; }
    // IME composition cannot be canceled; it edits the focused text node and is read back on input.
    if (!event.cancelable) return;
    event.preventDefault();
    const type = event.inputType;
    if (type === 'historyUndo' || type === 'historyRedo') { inlineHistory(p, type === 'historyRedo'); return; }
    if (type === 'insertParagraph') { savePending(); return; }
    if (!/^(insert|delete)/.test(type) || /^(insertFromDrop|deleteByDrag|insertLink|insertOrderedList|insertUnorderedList|insertHorizontalRule|insertFromYank)$/.test(type)) return;
    let [start, end, targeted] = inlineRange(p, event);
    if (type.startsWith('delete')) {
      if (start === end && !targeted) {
        if (/Backward$/.test(type)) start = Math.max(0, stepBack(p.model.text, start));
        else end = Math.min(p.model.text.length, stepForward(p.model.text, end));
      }
      if (start !== end) inlineReplace(p, start, end, '', 'delete');
      return;
    }
    const text = type === 'insertLineBreak' ? '\n' : (event.data ?? event.dataTransfer?.getData('text/plain') ?? '');
    inlineReplace(p, start, end, text.replace(/\r\n?/g, '\n'), type === 'insertText' ? 'type' : 'paste');
  }
  // Typing goes to the reviewer's edit, not to site shortcuts, editors or analytics listeners.
  let swallowKeyUp = '';
  function isolateEditing(event) {
    // The keyup of an Enter/Escape that ended an edit arrives after editing stopped.
    if (event.type === 'keyup' && event.isTrusted && swallowKeyUp && event.code === swallowKeyUp) { swallowKeyUp = ''; event.stopImmediatePropagation(); return; }
    const p = state.pending;
    if (p?.type !== 'text' || !p.editHost.contains(event.target)) return;
    event.stopImmediatePropagation();
    if (!event.isTrusted) return;
    if (event.type === 'compositionstart' && inlineCurrent(p)) pushUndo(p, 'compose', inlineRange(p)[1]);
    if (event.type === 'input' || event.type === 'compositionend') {
      if (!p.conflict && p.seg.nodes.every(node => node.isConnected)) { p.model = core.readSegment(p.seg); queuePosition(); }
      else inlineCurrent(p);
    }
  }
  function inlineKey(event, p) {
    event.stopImmediatePropagation();
    if (event.isComposing || event.keyCode === 229) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === 'Enter' && !event.shiftKey) { event.preventDefault(); swallowKeyUp = event.code; savePending(); return; }
    // Handle Space/Shift+Enter here: as native keys they could activate an edited button or link.
    if (key === 'Enter' || (key === ' ' && !mod && !event.altKey)) {
      event.preventDefault();
      const [start, end] = inlineRange(p);
      inlineReplace(p, start, end, key === 'Enter' ? '\n' : ' ', 'type');
      return;
    }
    if (!mod) return;
    if (key === 'a') { event.preventDefault(); placeCaret(p, 0, p.model.text.length); }
    else if (key === 'z' || key === 'y') { event.preventDefault(); inlineHistory(p, key === 'y' || event.shiftKey); }
    else if (key === 'x' && event.shiftKey) { event.preventDefault(); applyMark(p, 'strike'); }
    else if (key === 'b' || key === 'i' || key === 'u') { event.preventDefault(); applyMark(p, { b: 'bold', i: 'italic', u: 'underline' }[key]); }
  }
  function editComment(comment) {
    cancelPending(false);
    state.pending = { type: 'comment', commentId: comment.id, value: comment.text, anchor: comment.anchor, element: pinElements.get(comment.id), container: pinContainers.get(comment.id) };
    state.collapsed = false; render(); focusEditor();
  }
  function removeComment(comment) {
    if (state.pending?.commentId === comment.id) cancelPending(false);
    state.comments = state.comments.filter(c => c.id !== comment.id); pinElements.delete(comment.id); pinContainers.delete(comment.id);
    if (state.selectedId === comment.id) state.selectedId = null;
    render();
  }
  function revertEdit(edit) {
    if (state.pending?.editId === edit.id) cancelPending(false);
    const segment = editSegments.get(edit.id);
    const restored = core.segmentCurrent(segment);
    if (restored) core.renderSegment(segment, core.plainModel(edit.before));
    state.edits = state.edits.filter(e => e.id !== edit.id); editSegments.delete(edit.id);
    state.notice = restored ? '' : 'Removed the saved edit. The live page had changed, so its current text was left alone.';
    state.noticeType = ''; render();
  }
  function showComment(comment) {
    const target = pinElements.get(comment.id);
    const container = pinContainers.get(comment.id);
    if (comment.anchor.kind === 'element' && target?.isConnected) target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    else if (comment.anchor.container && container?.isConnected) {
      container.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      const { x, y } = comment.anchor.container.offset;
      container.scrollTo({ left: Math.max(0, x - container.clientWidth / 2), top: Math.max(0, y - container.clientHeight / 2), behavior: 'smooth' });
    } else window.scrollTo({ left: Math.max(0, comment.anchor.document.x - innerWidth / 2), top: Math.max(0, comment.anchor.document.y - innerHeight / 2), behavior: 'smooth' });
    state.selectedId = comment.id; state.collapsed = false; render();
  }
  // Clicking a pin only points at its note in the panel; editing stays an explicit choice.
  function selectComment(comment) {
    state.selectedId = comment.id; state.revealSelected = true; state.collapsed = false; render();
  }
  function showEdit(edit) {
    const segment = editSegments.get(edit.id);
    if (core.segmentCurrent(segment)) { segment.parent.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); flash(segment.parent); }
    else tell('The page replaced this element. The original locator and your change are still in the review.', true);
  }
  function flash(target) {
    const rect = target.getBoundingClientRect();
    Object.assign(highlight.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    setTimeout(() => { highlight.style.display = 'none'; }, 1200);
  }
  function renderPins() {
    pinsLayer.replaceChildren();
    state.comments.forEach((comment, index) => {
      const b = button(String(index + 1), () => selectComment(comment), `pin${state.selectedId === comment.id ? ' selected' : ''}`, comment.text);
      b.setAttribute('aria-label', `Note ${index + 1}: ${comment.text.slice(0, 100)}`);
      b.dataset.id = comment.id; pinsLayer.append(b);
    });
    if (state.pending?.type === 'comment' && !state.pending.commentId) {
      const pin = element('div', 'pin pending', '+'); pin.dataset.pending = 'true'; pinsLayer.append(pin);
    }
    positionPins();
  }
  function positionPins() {
    if (state.closed) return;
    for (const pin of pinsLayer.children) {
      const comment = pin.dataset.pending ? state.pending : state.comments.find(c => c.id === pin.dataset.id);
      if (!comment?.anchor) continue;
      const originalElement = pin.dataset.pending ? comment.element : pinElements.get(comment.id);
      const originalContainer = pin.dataset.pending ? comment.container : pinContainers.get(comment.id);
      const p = core.resolveAnchor(comment.anchor, originalElement, originalContainer);
      // Do not leave offscreen pins pinned to the viewport's edge.
      pin.style.display = p.visible === false || p.x < -20 || p.x > innerWidth + 20 || p.y < -20 || p.y > innerHeight + 35 ? 'none' : 'grid';
      pin.style.left = `${p.x}px`; pin.style.top = `${p.y}px`;
      pin.classList.toggle('lost', !p.resolved);
    }
    positionHover();
  }
  function hoverTarget() {
    const p = state.pending;
    if (p?.type === 'comment') return p.anchor.kind === 'element' ? p.element : null;
    if (p?.type === 'text') return p.editHost;
    if (!state.hoverPoint || state.collapsed || state.busy) return null;
    const { x, y } = state.hoverPoint;
    if ((state.mode === 'pin' && state.anchorKind === 'element') || state.mode === 'remove') {
      const el = document.elementFromPoint(x, y);
      return state.mode === 'remove' ? (removableTarget(el) ? el : null) : el && !host.contains(el) && el !== host ? el : null;
    }
    if (state.mode === 'edit') return core.locateTextNodeAtPoint(x, y)?.parentElement || null;
    return null;
  }
  function tagLabel(el) {
    let label = el.localName;
    if (el.id) label += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) label += '.' + el.className.trim().split(/\s+/)[0];
    return label.slice(0, 80);
  }
  function positionHover() {
    const target = hoverTarget();
    const rect = target?.isConnected ? target.getBoundingClientRect() : null;
    if (!rect || (!rect.width && !rect.height)) { hoverBox.style.display = 'none'; return; }
    const removing = state.mode === 'remove' && !state.pending;
    hoverTag.textContent = state.pending?.type === 'text' ? 'Editing text' : removing ? `Remove ${tagLabel(target)}` : tagLabel(target);
    hoverBox.classList.toggle('danger', removing);
    hoverBox.classList.toggle('inside', rect.top < 20);
    Object.assign(hoverBox.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  }
  function onHover(event) {
    if (!event.isTrusted) return;
    if (event.type === 'pointerout' && event.relatedTarget) return;
    state.hoverPoint = event.type === 'pointerout' || ownEvent(event) ? null : { x: event.clientX, y: event.clientY };
    if (state.mode !== 'browse' || state.pending) queuePosition();
  }
  function queuePosition() {
    if (state.frame) return;
    state.frame = requestAnimationFrame(() => { state.frame = 0; positionPins(); });
  }
  function onClick(event) {
    if (!event.isTrusted) return;
    if (ownEvent(event) || state.mode === 'browse' || state.busy || state.collapsed) return;
    event.preventDefault(); event.stopImmediatePropagation();
    let committed = false;
    if (state.pending?.type === 'text') {
      const p = state.pending;
      // Keyboard activation of an edited button/link, or caret placement and selection in the edited text.
      if (event.detail === 0) return;
      if (core.segmentContains(p.seg, core.caretAtPoint(event.clientX, event.clientY)?.node) || (p.editHost.contains(event.target) && !getSelection().isCollapsed)) return;
      // Clicking elsewhere commits, then continues with whatever was clicked.
      if (!savePending() || state.mode !== 'edit') return;
      committed = true;
    }
    if (state.pending) { tell('Save or cancel your current edit first.', true); focusEditor(); return; }
    if (state.mode === 'remove') {
      removeSection(event.target instanceof Element ? event.target : event.target.parentElement);
    } else if (state.mode === 'pin') {
      if (state.comments.length >= MAX_ITEMS) { tell('This review has reached 500 notes. Download it and start a new review.', true); return; }
      const target = event.target instanceof Element ? event.target : event.target.parentElement;
      const anchor = core.createAnchor(target, event.clientX, event.clientY, state.anchorKind);
      const container = anchor.container ? core.scrollContainerFor(target) : null;
      state.pending = { type: 'comment', anchor, element: target, container, context: core.captureContext(target), value: '' };
      state.notice = ''; render(); focusEditor();
    } else {
      const node = core.locateTextNodeAtPoint(event.clientX, event.clientY);
      const caret = core.caretAtPoint(event.clientX, event.clientY);
      if (node) beginTextEdit(node, undefined, caret?.node === node ? caret : undefined);
      else if (!committed) tell('Click directly on visible text. Inputs, editable fields, frames, and graphics cannot be edited here.', true);
    }
  }
  function blockPageInteraction(event) {
    if (!event.isTrusted) return;
    if (ownEvent(event) || state.mode === 'browse' || state.collapsed || state.busy) return;
    // Native caret placement and selection inside the text being edited; site handlers stay out.
    const p = state.pending;
    if (p?.type === 'text' && p.editHost.contains(event.target) && /^(pointer|mouse)(down|up)$|^dblclick$/.test(event.type)) { event.stopImmediatePropagation(); return; }
    // Scroll/wheel/touchmove stay available. No synthetic site click/input is emitted.
    event.preventDefault(); event.stopImmediatePropagation();
  }
  function onKey(event) {
    if (!event.isTrusted) return;
    if (event.key === 'Escape' && !state.busy && (state.pending || state.mode !== 'browse' || state.confirmingClose)) {
      event.preventDefault(); event.stopImmediatePropagation();
      // First Escape drops the edit in progress; the next one returns to browsing.
      if (state.pending?.type === 'text' && state.pending.editHost.contains(event.target)) swallowKeyUp = event.code;
      if (state.pending) { cancelPending(false); state.notice = ''; } else state.mode = 'browse';
      state.confirmingClose = false; state.selectedId = null; highlight.style.display = 'none'; render(); return;
    }
    const p = state.pending;
    if (p?.type === 'text' && p.editHost.contains(event.target)) { inlineKey(event, p); return; }
    if (!ownEvent(event) && state.mode !== 'browse' && !state.collapsed) {
      // Space/Enter on a previously focused site button must not activate it.
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopImmediatePropagation(); }
    }
  }
  function beforeUnload(event) {
    if (dirty()) { event.preventDefault(); event.returnValue = ''; }
  }
  function requestClose() {
    if (state.busy) return;
    if (dirty()) { state.confirmingClose = true; state.collapsed = false; render(); }
    else close();
  }
  function close() {
    cancelPending(false);
    for (const edit of state.edits) {
      const segment = editSegments.get(edit.id);
      if (core.segmentCurrent(segment)) core.renderSegment(segment, core.plainModel(edit.before));
    }
    for (const removal of state.removals) unhide(removal);
    state.closed = true;
    observer.disconnect(); resizeObserver.disconnect(); clearInterval(routeTimer);
    if (state.frame) cancelAnimationFrame(state.frame);
    window.removeEventListener('click', onClick, true);
    for (const name of blockedEvents) window.removeEventListener(name, blockPageInteraction, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('beforeinput', onBeforeInput, true);
    for (const name of isolatedEvents) window.removeEventListener(name, isolateEditing, true);
    window.removeEventListener('beforeunload', beforeUnload);
    window.removeEventListener('scroll', queuePosition, true);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointermove', onHover, true);
    window.removeEventListener('pointerout', onHover, true);
    chrome.runtime.onMessage.removeListener(runtimeMessage);
    host.remove(); delete globalThis.__pageNotesSession;
  }
  let sentTimer = 0, announceTimer = 0;
  function announce(message) {
    liveRegion.textContent = message;
    clearTimeout(announceTimer); announceTimer = setTimeout(() => { liveRegion.textContent = ''; }, 4000);
  }
  function environment() {
    const brands = navigator.userAgentData?.brands || [];
    const brand = brands.find(b => /Chrome|Edge|Brave|Opera|Vivaldi/.test(b.brand)) || brands.find(b => !/Not.?A.?Brand|Chromium/.test(b.brand)) || brands.find(b => b.brand === 'Chromium');
    const version = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1];
    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    return { browser: brand ? `${brand.brand} ${brand.version}` : version ? `Chrome ${version}` : 'Chromium', os: platform.replace(/^MacIntel$/, 'macOS') };
  }
  function cleanPageUrl(value) {
    const url = new URL(value);
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.href;
  }
  // The review model: what the reviewer asked for plus the context captured with each item.
  // export.js renders it to Markdown; nothing else from the page leaves the tab.
  function reviewModel() {
    const build = document.querySelector('meta[name="build-sha"]')?.getAttribute('content') || '';
    const comments = state.comments.map((comment, index) => {
      const position = core.resolveAnchor(comment.anchor, pinElements.get(comment.id), pinContainers.get(comment.id));
      return { ...comment, pin: index + 1, anchorState: position.resolved ? 'resolved' : 'element-missing' };
    });
    return {
      format: 'page-notes-review', version: 1, tool: { name: 'Page Notes', version: VERSION },
      session: { id: state.sessionId, startedAt: state.startedAt, exportedAt: now(), timezoneOffset: -new Date().getTimezoneOffset() },
      page: {
        url: cleanPageUrl(startUrl), title: startTitle, viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio,
        colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        ...(/^[\w.+-]{1,64}$/.test(build) ? { build } : {}),
        ...(location.href !== startUrl ? { navigatedTo: cleanPageUrl(location.href) } : {}),
      },
      environment: environment(),
      comments,
      edits: state.edits.map(edit => ({ ...edit, previewState: core.segmentCurrent(editSegments.get(edit.id)) ? 'applied' : 'page-changed' })),
      removals: state.removals.map(removal => ({ ...removal, previewState: removedElements.get(removal.id)?.el.isConnected ? 'applied' : 'page-changed' })),
    };
  }
  async function exportReview() {
    if (state.busy || state.pending) return;
    state.busy = true; state.notice = ''; render();
    try {
      const result = await chrome.runtime.sendMessage({ type: 'PAGE_NOTES_EXPORT', review: reviewModel() });
      if (!result?.ok) throw new Error(result?.error || 'The download could not be started.');
      // Confirm briefly on the button itself; the draft simply stays open.
      announce('Download started.');
      state.sent = 'full';
      clearTimeout(sentTimer); sentTimer = setTimeout(() => { state.sent = ''; render(); }, 2500);
    } catch (error) {
      state.notice = error.message || 'Download failed. Your notes are still here; try again.'; state.noticeType = 'error';
    } finally { state.busy = false; render(); }
  }
  function runtimeMessage(message, _sender, sendResponse) {
    if (message?.type === 'PAGE_NOTES_TOGGLE') {
      state.collapsed = false; render(); sendResponse({ ok: true });
    }
  }
  const blockedEvents = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'auxclick', 'contextmenu', 'dragstart'];
  window.addEventListener('click', onClick, true);
  for (const name of blockedEvents) window.addEventListener(name, blockPageInteraction, true);
  window.addEventListener('keydown', onKey, true);
  const isolatedEvents = ['keyup', 'keypress', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'paste', 'cut', 'copy'];
  window.addEventListener('beforeinput', onBeforeInput, true);
  for (const name of isolatedEvents) window.addEventListener(name, isolateEditing, true);
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('scroll', queuePosition, true);
  function onResize() { placeFloating(); queuePosition(); }
  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onHover, { capture: true, passive: true });
  window.addEventListener('pointerout', onHover, { capture: true, passive: true });
  chrome.runtime.onMessage.addListener(runtimeMessage);
  const observer = new MutationObserver(mutations => {
    if (mutations.some(m => !host.contains(m.target))) queuePosition();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
  const resizeObserver = new ResizeObserver(queuePosition);
  resizeObserver.observe(document.documentElement);
  const routeTimer = setInterval(() => {
    if (location.href !== startUrl && !state.routeChanged) {
      state.routeChanged = true; state.mode = 'browse';
      tell('The page navigated within this tab. Download this review, then close it and start a new one for the new page.', true);
    }
  }, 1000);
  globalThis.__pageNotesSession = { show() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    state.collapsed = false; render();
  } };
  render();
})();
