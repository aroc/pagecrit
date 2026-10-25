/* DOM evidence and geometry helpers. No network access; never evaluates page content. */
(function (root) {
  'use strict';
  const ROOT = '[data-pagecrit-root]';
  const BLOCKED = 'script,style,noscript,template,input,textarea,select,option,iframe,object,embed,svg,canvas,[contenteditable]:not([contenteditable="false"])';
  const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  const truncate = (text, max = 240) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const docFor = el => el?.ownerDocument || root.document;
  const winFor = el => docFor(el)?.defaultView || root;
  const escapeIdentifier = value => root.CSS?.escape ? root.CSS.escape(value) : Array.from(String(value)).map((ch, i) => /[a-zA-Z_-]/.test(ch) || (i > 0 && /[0-9]/.test(ch)) ? ch : `\\${ch.codePointAt(0).toString(16)} `).join('');

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return null;
    const document = docFor(el);
    if (el.id) {
      const candidate = '#' + escapeIdentifier(el.id);
      try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch (_) { /* Build structural selector. */ }
    }
    const parts = [];
    let current = el;
    while (current && current.nodeType === 1) {
      const tag = current.localName || current.tagName.toLowerCase();
      let part = escapeIdentifier(tag);
      const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(child => child.localName === current.localName) : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function describeElement(el) {
    if (!el || el.nodeType !== 1) return null;
    const rect = el.getBoundingClientRect();
    const win = winFor(el);
    return {
      selector: selectorFor(el),
      tag: (el.localName || el.tagName).toLowerCase(),
      id: el.id || null,
      text: truncate(el.textContent),
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      parent: el.parentElement ? { tag: el.parentElement.localName, selector: selectorFor(el.parentElement) } : null,
      rect: { x: finite(rect.left) + finite(win.scrollX), y: finite(rect.top) + finite(win.scrollY), width: finite(rect.width), height: finite(rect.height) }
    };
  }

  // Many apps scroll a container (or body) instead of the window. A page position
  // belongs to whichever scroller moves the content under the click.
  function scrollContainerFor(el) {
    const win = winFor(el);
    if (!win.getComputedStyle) return null;
    const scrolling = docFor(el).scrollingElement;
    for (let current = el; current && current.nodeType === 1; current = current.parentElement) {
      if (current === scrolling) return null;
      const style = win.getComputedStyle(current);
      const scrollsX = /^(auto|scroll|overlay)$/.test(style.overflowX) && current.scrollWidth > current.clientWidth;
      const scrollsY = /^(auto|scroll|overlay)$/.test(style.overflowY) && current.scrollHeight > current.clientHeight;
      if (scrollsX || scrollsY) return current;
      // Fixed content does not move with any scrolling ancestor.
      if (style.position === 'fixed') return null;
    }
    return null;
  }

  function contentBox(container) {
    const rect = container.getBoundingClientRect();
    const scaleX = container.offsetWidth ? rect.width / container.offsetWidth : 1;
    const scaleY = container.offsetHeight ? rect.height / container.offsetHeight : 1;
    const left = rect.left + finite(container.clientLeft) * scaleX;
    const top = rect.top + finite(container.clientTop) * scaleY;
    return { left, top, right: left + finite(container.clientWidth, rect.width) * scaleX, bottom: top + finite(container.clientHeight, rect.height) * scaleY, scaleX, scaleY };
  }

  function createAnchor(el, clientX, clientY, kind = 'page') {
    if (!['page', 'element'].includes(kind)) throw new TypeError('Unknown anchor kind');
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) throw new TypeError('Anchor coordinates must be finite');
    const win = winFor(el);
    const rect = el?.getBoundingClientRect();
    const x = clientX - finite(rect?.left);
    const y = clientY - finite(rect?.top);
    const scroller = kind === 'page' && el ? scrollContainerFor(el) : null;
    let container = null;
    if (scroller) {
      const box = contentBox(scroller);
      // Unscaled CSS pixels from the scroller's content origin, including its scroll offset.
      container = { element: describeElement(scroller), offset: { x: (clientX - box.left) / box.scaleX + finite(scroller.scrollLeft), y: (clientY - box.top) / box.scaleY + finite(scroller.scrollTop) } };
    }
    return {
      kind,
      document: { x: clientX + finite(win.scrollX), y: clientY + finite(win.scrollY) },
      element: describeElement(el),
      offset: rect ? { x, y, xRatio: rect.width ? x / rect.width : 0, yRatio: rect.height ? y / rect.height : 0 } : null,
      ...(container ? { container } : {}),
      viewport: { width: finite(win.innerWidth), height: finite(win.innerHeight) },
      scroll: { x: finite(win.scrollX), y: finite(win.scrollY) }
    };
  }

  function findElement(locator, document = root.document) {
    if (!locator?.selector || !document) return null;
    try {
      const matches = document.querySelectorAll(locator.selector);
      if (matches.length !== 1) return null;
      const el = matches[0];
      return el.localName === locator.tag && !el.closest(ROOT) ? el : null;
    } catch (_) { return null; }
  }

  function positionedContainingBlock(el, style, win) {
    if (!['absolute', 'fixed'].includes(style.position)) return undefined;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const value = win.getComputedStyle(parent);
      const transformed = ['transform', 'perspective', 'filter', 'backdropFilter'].some(key => value[key] && value[key] !== 'none');
      const contains = /(?:layout|paint|strict|content)/.test(value.contain || '');
      const willContain = /(?:transform|perspective|filter)/.test(value.willChange || '');
      if (transformed || contains || willContain || value.contentVisibility === 'auto' ||
          style.position === 'absolute' && value.position && value.position !== 'static') return parent;
    }
    return null; // The viewport/initial containing block, outside overflow ancestors.
  }

  function pointVisible(x, y, win, el) {
    if (x < 0 || y < 0 || x > finite(win.innerWidth, Infinity) || y > finite(win.innerHeight, Infinity)) return false;
    if (!el || !win.getComputedStyle) return true;
    const ownStyle = win.getComputedStyle(el);
    let clipBoundary = positionedContainingBlock(el, ownStyle, win);
    if (ownStyle.display === 'none' || ownStyle.visibility === 'hidden' || ownStyle.visibility === 'collapse' || Number(ownStyle.opacity) === 0 && ownStyle.opacity !== '') return false;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const style = win.getComputedStyle(parent);
      // Visibility is inherited, but a descendant can explicitly restore it. Its
      // computed value above is authoritative; ancestor opacity still hides the subtree.
      if (style.display === 'none' || style.contentVisibility === 'hidden' || Number(style.opacity) === 0 && style.opacity !== '') return false;
      if (parent === clipBoundary) clipBoundary = undefined;
      const escapedClipping = clipBoundary !== undefined;
      // A fixed/absolute descendant can escape overflow ancestors until its
      // containing block. Still account for invisibility of every ancestor.
      const nextBoundary = positionedContainingBlock(parent, style, win);
      if (nextBoundary !== undefined && clipBoundary === undefined) clipBoundary = nextBoundary;
      if (escapedClipping) continue;
      const clipsX = /^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowX);
      const clipsY = /^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowY);
      if (!clipsX && !clipsY) continue;
      const rect = parent.getBoundingClientRect();
      // clientLeft/clientTop include the border (and a left-side scrollbar).
      // Scale local CSS dimensions when a container has an axis-aligned transform.
      const scaleX = parent.offsetWidth ? rect.width / parent.offsetWidth : 1;
      const scaleY = parent.offsetHeight ? rect.height / parent.offsetHeight : 1;
      const left = rect.left + finite(parent.clientLeft) * scaleX;
      const top = rect.top + finite(parent.clientTop) * scaleY;
      const right = left + finite(parent.clientWidth, rect.width) * scaleX;
      const bottom = top + finite(parent.clientHeight, rect.height) * scaleY;
      if (clipsX && (x < left || x > right)) return false;
      if (clipsY && (y < top || y > bottom)) return false;
    }
    return true;
  }

  function resolveAnchor(anchor, originalElement, originalContainer) {
    const win = originalElement ? winFor(originalElement) : root;
    const fallback = { x: finite(anchor?.document?.x) - finite(win.scrollX), y: finite(anchor?.document?.y) - finite(win.scrollY), resolved: anchor?.kind === 'page' };
    fallback.visible = pointVisible(fallback.x, fallback.y, win);
    if (anchor?.kind === 'page' && anchor.container) {
      const container = originalContainer !== undefined ? (originalContainer?.isConnected ? originalContainer : null) : findElement(anchor.container.element);
      if (!container) return { ...fallback, resolved: false };
      const box = contentBox(container);
      const x = box.left + (finite(anchor.container.offset?.x) - finite(container.scrollLeft)) * box.scaleX;
      const y = box.top + (finite(anchor.container.offset?.y) - finite(container.scrollTop)) * box.scaleY;
      const inside = x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
      return { x, y, resolved: true, visible: inside && pointVisible(x, y, win, container) };
    }
    if (anchor?.kind !== 'element') return fallback;
    // When an original DOM reference was provided, never silently attach to a replacement.
    const el = originalElement ? (originalElement.isConnected ? originalElement : null) : findElement(anchor.element);
    if (!el) return { ...fallback, resolved: false };
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) return { ...fallback, resolved: false, visible: false };
    const x = finite(rect.left) + (Number.isFinite(anchor.offset?.xRatio) ? anchor.offset.xRatio * finite(rect.width) : finite(anchor.offset?.x));
    const y = finite(rect.top) + (Number.isFinite(anchor.offset?.yRatio) ? anchor.offset.yRatio * finite(rect.height) : finite(anchor.offset?.y));
    return { x, y, resolved: true, visible: pointVisible(x, y, win, el) };
  }

  function isEditableTextNode(node) {
    if (!node || node.nodeType !== 3 || !node.parentElement || !node.isConnected) return false;
    const parent = node.parentElement;
    if (parent.closest(ROOT) || parent.closest(BLOCKED) || parent.getRootNode() !== node.ownerDocument) return false;
    return true;
  }

  function caretAtPoint(x, y) {
    const document = root.document;
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(x, y);
      return position ? { node: position.offsetNode, offset: position.offset } : null;
    }
    const range = document.caretRangeFromPoint?.(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }

  function locateTextNodeAtPoint(x, y) {
    const document = root.document;
    const node = caretAtPoint(x, y)?.node;
    if (!isEditableTextNode(node) || !node.nodeValue?.trim()) return null;
    // Caret APIs may return the nearest text even when clicking a blank part of the page.
    const range = document.createRange();
    range.selectNodeContents(node);
    const hit = Array.from(range.getClientRects()).some(rect => x >= rect.left - 3 && x <= rect.right + 3 && y >= rect.top - 3 && y <= rect.bottom + 3);
    return hit ? node : null;
  }

  function describeTextNode(node) {
    if (!node || node.nodeType !== 3 || !node.parentElement) return null;
    const index = Array.from(node.parentElement.childNodes).indexOf(node);
    return { element: describeElement(node.parentElement), nodePath: [index], index, originalText: node.nodeValue };
  }

  function resolveTextNode(description) {
    let node = findElement(description?.element);
    for (const index of description?.nodePath || []) node = node?.childNodes[index];
    return node?.nodeType === 3 ? node : null;
  }

  function applyTextEdit(node, text) {
    if (!isEditableTextNode(node)) throw new Error('This text cannot be edited. Use a feedback pin instead.');
    if (typeof text !== 'string' || text.length > 20000) throw new Error('Text must be a string of at most 20,000 characters.');
    const description = describeTextNode(node);
    node.nodeValue = text;
    return { ...description, newText: text };
  }

  // Formatted replacement text: `marks[i]` lists the styles of UTF-16 unit i, e.g. "bold,italic".
  // A text edit owns one "segment": the original text node, or the nodes rendered in its place.
  const MARK_TAGS = { bold: 'strong', italic: 'em', underline: 'u', strike: 's' };
  const MARKS = Object.keys(MARK_TAGS);
  const TAG_MARKS = Object.fromEntries(MARKS.map(mark => [MARK_TAGS[mark], mark]));
  const normalizeMarks = list => MARKS.filter(mark => list.includes(mark)).join(',');
  function plainModel(text) { return { text: String(text), marks: Array(String(text).length).fill('') }; }
  function modelFrom(text, formatting = []) {
    const model = plainModel(text);
    for (const run of formatting || []) {
      const start = Math.max(0, Math.min(model.text.length, run.start | 0)), end = Math.max(start, Math.min(model.text.length, run.end | 0));
      const marks = normalizeMarks((run.marks || []).filter(mark => MARKS.includes(mark)));
      for (let i = start; i < end; i++) model.marks[i] = marks;
    }
    return model;
  }
  function marksAt(model, offset) { return offset > 0 ? model.marks[offset - 1] : (model.marks[0] || ''); }
  function replaceRange(model, start, end, text, marks = marksAt(model, start)) {
    return { text: model.text.slice(0, start) + text + model.text.slice(end), marks: [...model.marks.slice(0, start), ...Array(text.length).fill(marks), ...model.marks.slice(end)] };
  }
  function toggleMarkSet(marks, mark, on) {
    const list = marks ? marks.split(',') : [];
    return normalizeMarks(on ? [...list, mark] : list.filter(item => item !== mark));
  }
  function rangeHasMark(model, start, end, mark) {
    if (start === end) return marksAt(model, start).split(',').includes(mark);
    for (let i = start; i < end; i++) if (!model.marks[i].split(',').includes(mark)) return false;
    return true;
  }
  function toggleMark(model, start, end, mark) {
    if (!MARKS.includes(mark)) throw new TypeError('Unknown mark');
    const on = !rangeHasMark(model, start, end, mark);
    const marks = model.marks.slice();
    for (let i = start; i < end; i++) marks[i] = toggleMarkSet(marks[i], mark, on);
    return { text: model.text, marks };
  }
  function modelRuns(model) {
    const runs = [];
    for (let i = 0; i < model.text.length; i++) {
      const last = runs[runs.length - 1];
      if (last && last.marks === model.marks[i]) last.text += model.text[i];
      else runs.push({ text: model.text[i], marks: model.marks[i], start: i });
    }
    return runs;
  }
  function modelFormatting(model) {
    return modelRuns(model).filter(run => run.marks).map(run => ({ start: run.start, end: run.start + run.text.length, marks: run.marks.split(',') }));
  }
  function modelsEqual(a, b) { return a.text === b.text && a.marks.join('|') === b.marks.join('|'); }
  function escapeHtml(text) { return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
  function modelHtml(model) {
    return modelRuns(model).map(run => {
      const tags = run.marks ? run.marks.split(',').map(mark => MARK_TAGS[mark]) : [];
      return tags.map(tag => `<${tag}>`).join('') + escapeHtml(run.text) + tags.reverse().map(tag => `</${tag}>`).join('');
    }).join('');
  }

  const segmentSignature = nodes => nodes.map(node => node.nodeType === 3 ? '#' + node.data : node.outerHTML).join('\u0000');
  function createSegment(node) {
    return { original: node, nodes: [node], parent: node.parentElement, signature: segmentSignature([node]) };
  }
  // False once the page replaced, moved or changed any node the segment rendered.
  function segmentCurrent(segment) {
    const nodes = segment?.nodes || [];
    if (!nodes.length) return false;
    for (let i = 0; i < nodes.length; i++) {
      if (!nodes[i].isConnected || nodes[i].parentNode !== segment.parent) return false;
      if (i && nodes[i - 1].nextSibling !== nodes[i]) return false;
    }
    return segmentSignature(nodes) === segment.signature;
  }
  function segmentContains(segment, node) { return Boolean(node && segment?.nodes.some(item => item === node || item.contains(node))); }
  function segmentTextNodes(segment) {
    const texts = [];
    const walk = node => { if (node.nodeType === 3) texts.push(node); else node.childNodes.forEach(walk); };
    segment.nodes.forEach(walk);
    return texts;
  }
  // Unformatted text stays the original node, so sites keep their own node in the common case.
  function renderSegment(segment, model) {
    const document = docFor(segment.parent);
    const plain = model.marks.every(marks => !marks);
    if (plain && segment.nodes.length === 1 && segment.nodes[0] === segment.original) {
      segment.original.data = model.text;
    } else {
      let nodes;
      if (plain) { segment.original.data = model.text; nodes = [segment.original]; }
      else nodes = modelRuns(model).map(run => {
        let node = document.createTextNode(run.text);
        for (const mark of (run.marks ? run.marks.split(',') : []).reverse()) {
          const wrapper = document.createElement(MARK_TAGS[mark]);
          wrapper.append(node); node = wrapper;
        }
        return node;
      });
      const after = segment.nodes[segment.nodes.length - 1].nextSibling;
      segment.nodes.forEach(node => node.remove());
      const fragment = document.createDocumentFragment();
      fragment.append(...nodes);
      segment.parent.insertBefore(fragment, after);
      segment.nodes = nodes;
    }
    segment.signature = segmentSignature(segment.nodes);
  }
  // Reads the segment back after native changes (IME composition) and accepts them.
  function readSegment(segment) {
    const model = { text: '', marks: [] };
    for (const text of segmentTextNodes(segment)) {
      const marks = [];
      for (let el = text.parentElement; el && el !== segment.parent; el = el.parentElement) if (TAG_MARKS[el.localName]) marks.push(TAG_MARKS[el.localName]);
      model.text += text.data;
      model.marks.push(...Array(text.data.length).fill(normalizeMarks(marks)));
    }
    segment.signature = segmentSignature(segment.nodes);
    return model;
  }
  // Maps a DOM boundary point to a text offset, clamped to the segment.
  function segmentOffset(segment, container, offset) {
    let total = 0;
    for (const text of segmentTextNodes(segment)) {
      if (container === text) return total + Math.min(offset, text.length);
      const range = docFor(text).createRange();
      range.selectNodeContents(text);
      try { if (range.comparePoint(container, offset) < 0) return total; } catch (_) { return total; }
      total += text.length;
    }
    return total;
  }
  // Prefers the end of the earlier node, where text typed next inherits its formatting.
  function segmentPosition(segment, offset) {
    const texts = segmentTextNodes(segment);
    let total = 0;
    for (const text of texts) {
      if (offset <= total + text.length) return { node: text, offset: Math.max(0, offset - total) };
      total += text.length;
    }
    const last = texts[texts.length - 1];
    return last ? { node: last, offset: last.length } : null;
  }

  // ---- Review context: just enough for an agent to locate, understand and verify one item.
  // Captured when the item is created (before any preview change). Every field is capped.
  const TEST_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa'];
  const SKIP_TEXT = 'script,style,noscript,template,textarea,select,option,' + ROOT;
  const clip = (text, max) => {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return value.length > max ? value.slice(0, max - 1).trimEnd() + '…' : value;
  };
  // Build-tool hashes (css-1x9f3k, Card_card__ab12c, sc-bdVaJa) can't be found in source.
  function isHashedToken(token) {
    if (!token || /[[\]:/.]/.test(token)) return false;
    if (/^(css|sc|jsx|svelte|emotion|chakra)-/i.test(token) && token.length > 6) return true;
    if (token.split(/[-_]+/).some(part => part.length >= 4 && /\d/.test(part) && /[a-z]/i.test(part))) return true;
    return /^[a-z]+[A-Z][a-zA-Z]*$/.test(token) && token.length <= 8 && (token.match(/[A-Z]/g) || []).length >= 2;
  }
  const cssString = value => String(value).replace(/["\\]/g, '\\$&').replace(/\n/g, ' ');
  function stableAttribute(el) {
    for (const name of TEST_ATTRS) { const value = el.getAttribute(name); if (value) return `[${name}="${cssString(clip(value, 80))}"]`; }
    if (el.id && !isHashedToken(el.id) && el.id.length <= 80) return '#' + escapeIdentifier(el.id);
    return null;
  }
  const IMPLICIT_ROLES = { button: 'button', nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo', aside: 'complementary', dialog: 'dialog', ul: 'list', ol: 'list', li: 'listitem', p: 'paragraph', img: 'img', table: 'table', textarea: 'textbox', select: 'combobox', article: 'article', form: 'form', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading' };
  function roleOf(el) {
    const explicit = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
    if (explicit) return explicit;
    if (el.localName === 'a') return el.hasAttribute('href') ? 'link' : null;
    if (el.localName === 'input') return ({ checkbox: 'checkbox', radio: 'radio', range: 'slider', button: 'button', submit: 'button', reset: 'button', search: 'searchbox' })[el.type] || 'textbox';
    if (el.localName === 'section') return accessibleName(el, false) ? 'region' : null;
    return IMPLICIT_ROLES[el.localName] || null;
  }
  // Never reads form values; only labels and visible text of named-by-content roles.
  function accessibleName(el, fromContent = true) {
    const label = el.getAttribute('aria-label');
    if (label) return clip(label, 80);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map(id => docFor(el).getElementById(id)?.textContent || '').join(' ');
      if (text.trim()) return clip(text, 80);
    }
    if (el.localName === 'img' && el.getAttribute('alt')) return clip(el.getAttribute('alt'), 80);
    if (fromContent && /^(a|button|h[1-6]|summary|label|legend|th|td|li|option)$/.test(el.localName)) {
      const text = clip(el.textContent, 80);
      if (text) return text;
    }
    return el.getAttribute('title') ? clip(el.getAttribute('title'), 80) : '';
  }
  function nthPart(el) {
    const tag = escapeIdentifier(el.localName);
    const siblings = el.parentElement ? Array.from(el.parentElement.children).filter(child => child.localName === el.localName) : [];
    return siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(el) + 1})` : tag;
  }
  function stableLabel(el) {
    const stable = stableAttribute(el);
    if (stable) return stable.startsWith('#') ? el.localName + stable : el.localName + stable;
    const role = el.getAttribute('role');
    if (role) return `${el.localName}[role="${cssString(clip(role, 40))}"]`;
    const label = el.getAttribute('aria-label');
    return label ? `${el.localName}[aria-label="${cssString(clip(label, 40))}"]` : el.localName;
  }
  // Ranked: test id › id › role + accessible name › short tag path from a stable ancestor.
  function stableLocator(el) {
    const document = docFor(el);
    const unique = selector => { try { return document.querySelectorAll(selector).length === 1; } catch (_) { return false; } };
    const own = stableAttribute(el);
    if (own) {
      const selector = own.startsWith('#') ? own : el.localName + own;
      if (unique(selector)) return { selector, strategy: own.startsWith('#') ? 'id' : 'test id' };
    }
    const role = roleOf(el), name = accessibleName(el);
    if (role && name) {
      const same = Array.from(document.getElementsByTagName(el.localName)).filter(other => roleOf(other) === role && accessibleName(other) === name);
      if (same.length === 1) return { selector: `role=${role}[name="${cssString(name)}"]`, strategy: 'role and name' };
    }
    const parts = [];
    for (let current = el; current && current.nodeType === 1 && current !== document.documentElement; current = current.parentElement) {
      const stable = current !== el && stableAttribute(current);
      if (stable) { parts.unshift(stable.startsWith('#') ? stable : current.localName + stable); break; }
      parts.unshift(nthPart(current));
      if (parts.length >= 6) break;
    }
    const short = parts.join(' > ');
    if (short.length <= 200 && unique(short)) return { selector: short, strategy: 'path' };
    return { selector: clip(selectorFor(el), 300), strategy: 'full path' };
  }
  // Page-level landmarks only; named sections are already covered by the heading path.
  const LANDMARKS = { banner: 'header', navigation: 'nav', main: 'main', contentinfo: 'footer', complementary: 'aside', dialog: 'dialog', alertdialog: 'dialog' };
  function landmarkOf(el) {
    for (let current = el; current && current.nodeType === 1; current = current.parentElement) {
      const role = roleOf(current);
      if (!LANDMARKS[role]) continue;
      // header/footer are page landmarks only outside article/section/main.
      if ((role === 'banner' || role === 'contentinfo') && !current.getAttribute('role') && current.parentElement?.closest('article,aside,main,nav,section')) continue;
      const name = accessibleName(current, false);
      return { element: current, label: LANDMARKS[role] + (name ? ` "${clip(name, 40)}"` : '') };
    }
    return null;
  }
  function headingLevel(heading) { return /^h[1-6]$/.test(heading.localName) ? Number(heading.localName[1]) : Number(heading.getAttribute('aria-level')) || 2; }
  // A heading names what follows it inside its own container. It reaches past that container
  // only when the container just wraps the heading (header, hgroup, or a heading plus a subtitle),
  // so a card's heading never names the content after the card.
  const HEADING_COMPANIONS = new Set(['p', 'span', 'small', 'time', 'img', 'svg', 'a', 'br']);
  function headingWrapper(container, heading) {
    if (container.localName === 'header' || container.localName === 'hgroup') return true;
    return Array.from(container.children).every(child => child.contains(heading) || HEADING_COMPANIONS.has(child.localName));
  }
  function headingCovers(heading, el) {
    for (let scope = heading.parentElement; scope; scope = scope.parentElement) {
      if (scope.contains(el)) return true;
      if (!headingWrapper(scope, heading)) return false;
    }
    return false;
  }
  // The outline above an element: nearest preceding heading that covers it, then each shallower one.
  function sectionPath(el, landmark) {
    const scope = landmark || docFor(el).body || docFor(el).documentElement;
    const headings = Array.from(scope.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'));
    const chain = [];
    let limit = 7;
    // An element that holds its own heading (a card, a section) is that section, not the one before it.
    const own = headings.find(heading => heading !== el && el.contains(heading));
    if (own) {
      const text = clip(own.textContent, 60);
      if (text) chain.push(text);
      limit = headingLevel(own);
      if (limit === 1) return chain;
    }
    for (let i = headings.length - 1; i >= 0 && chain.length < 4; i--) {
      const heading = headings[i];
      if (heading === el || heading.contains(el) || el.contains(heading)) continue;
      if (!(heading.compareDocumentPosition(el) & 4 /* FOLLOWING */)) continue;
      const level = headingLevel(heading);
      if (level >= limit || !headingCovers(heading, el)) continue;
      const text = clip(heading.textContent, 60);
      if (text) chain.unshift(text);
      limit = level;
      if (level === 1) break;
    }
    return chain;
  }
  function blockOf(node) {
    const win = winFor(node.parentElement);
    for (let el = node.parentElement; el; el = el.parentElement) {
      const display = win.getComputedStyle ? win.getComputedStyle(el).display : 'block';
      if (!display.startsWith('inline') && display !== 'contents') return el;
    }
    return null;
  }
  // W3C text-quote selector: exact text plus ~80 characters either side, skipping hidden/script text.
  function textQuote(subject) {
    const document = docFor(subject.nodeType === 3 ? subject.parentElement : subject);
    const exact = clip(subject.nodeType === 3 ? subject.data : (subject.innerText ?? subject.textContent), 200);
    const scope = (subject.nodeType === 3 ? subject.parentElement : subject).closest('section,article,main,li,tr,form,aside,nav,header,footer,dialog') || document.body;
    if (!scope) return { exact, prefix: '', suffix: '' };
    const walker = document.createTreeWalker(scope, 4 /* SHOW_TEXT */, { acceptNode: node => node.parentElement?.closest(SKIP_TEXT) || !node.data.trim() ? 2 : 1 });
    const collect = (step, start) => {
      const parts = [];
      let length = 0, previous = start, node;
      walker.currentNode = start;
      while (length < 120 && (node = step())) {
        if (subject.nodeType === 1 && subject.contains(node)) continue;
        // Separate words across block boundaries ("day." + "Keep" -> "day. Keep").
        const gap = blockOf(node) !== blockOf(previous) ? ' ' : '';
        parts.push([node.data, gap]);
        length += node.data.length; previous = node;
      }
      return parts;
    };
    const firstText = subject.nodeType === 3 ? subject : (document.createTreeWalker(subject, 4).nextNode() || subject);
    const before = collect(() => walker.previousNode(), firstText).reverse().map(([text, gap]) => text + gap).join('');
    let lastText = subject;
    if (subject.nodeType === 1) { const all = document.createTreeWalker(subject, 4); for (let n = all.nextNode(); n; n = all.nextNode()) lastText = n; }
    const after = collect(() => walker.nextNode(), lastText).map(([text, gap]) => gap + text).join('');
    const prefix = String(before).replace(/\s+/g, ' ').trimStart().slice(-80);
    const suffix = String(after).replace(/\s+/g, ' ').trimEnd().slice(0, 80);
    return { exact, prefix: prefix.length === 80 ? prefix.replace(/^\S*\s/, '') : prefix, suffix: suffix.length === 80 ? suffix.replace(/\s\S*$/, '') : suffix };
  }
  function countOccurrences(text, document) {
    const needle = clip(text, 200).replace(/…$/, '');
    if (needle.length < 3 || !document.body) return null;
    const haystack = String(document.body.innerText || '').replace(/\s+/g, ' ');
    let count = 0;
    for (let at = haystack.indexOf(needle); at !== -1 && count < 99; at = haystack.indexOf(needle, at + needle.length)) count++;
    return count;
  }
  function cleanUrl(value, base) {
    try {
      const url = new URL(value, base);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      url.username = ''; url.password = ''; url.search = ''; url.hash = '';
      return url.origin === new URL(base).origin ? url.pathname : url.href;
    } catch (_) { return null; }
  }
  const escapeAttribute = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  function openTag(el) {
    const attrs = [];
    const keep = (name, value) => { if (value) attrs.push(`${name}="${escapeAttribute(clip(value, 60))}"`); };
    if (el.id && !isHashedToken(el.id)) keep('id', el.id);
    for (const name of TEST_ATTRS) keep(name, el.getAttribute(name));
    const classes = classList(el);
    if (classes) keep('class', classes);
    for (const name of ['role', 'aria-label', 'alt', 'type', 'name', 'for', 'title']) keep(name, el.getAttribute(name));
    if (el.hasAttribute('href')) keep('href', cleanUrl(el.getAttribute('href'), docFor(el).baseURI) || '…');
    return `<${el.localName}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
  }
  const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/;
  // One level of children; anything deeper is elided. Attribute values and text are capped.
  function elementExcerpt(el, max = 300) {
    const escapeText = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let inner = '';
    for (const child of el.childNodes) {
      if (inner.length > max) break;
      if (child.nodeType === 3) {
        const text = clip(child.data, 60);
        if (text) inner += escapeText((/^\s/.test(child.data) ? ' ' : '') + text + (/\s$/.test(child.data) ? ' ' : ''));
      }
      else if (child.nodeType === 1 && !child.matches(SKIP_TEXT)) {
        const onlyText = Array.from(child.childNodes).every(node => node.nodeType === 3);
        inner += openTag(child) + (VOID.test(child.localName) ? '' : (onlyText ? escapeText(clip(child.textContent, 40)) : '…') + `</${child.localName}>`);
      }
    }
    const html = openTag(el) + (VOID.test(el.localName) ? '' : inner + `</${el.localName}>`);
    return html.length > max ? html.slice(0, max - 1) + '…' : html;
  }
  function classList(el) {
    const value = typeof el.className === 'string' ? el.className : el.getAttribute('class') || '';
    return clip(value.split(/\s+/).filter(token => token && !isHashedToken(token)).join(' '), 200);
  }
  // Inline markup of an element's content (tags only, no attributes), e.g. "Save <strong>20%</strong> yearly".
  function inlineMarkup(el, max = 400) {
    const INLINE = /^(a|strong|b|em|i|u|s|del|ins|code|mark|small|sub|sup|br)$/;
    const walk = node => {
      if (node.nodeType === 3) return node.data.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      if (node.nodeType !== 1 || node.matches(SKIP_TEXT)) return '';
      const inner = Array.from(node.childNodes).map(walk).join('');
      if (node.localName === 'br') return '<br>';
      return INLINE.test(node.localName) ? `<${node.localName}>${inner}</${node.localName}>` : inner;
    };
    const html = Array.from(el.childNodes).map(walk).join('').replace(/\s+/g, ' ').trim();
    return html.length > max ? html.slice(0, max - 1) + '…' : html;
  }
  function captureContext(el, textNode) {
    const landmark = landmarkOf(el);
    const quote = textQuote(textNode || el);
    const ancestors = [];
    for (let current = el.parentElement; current && ancestors.length < 4 && current !== docFor(el).body && current !== docFor(el).documentElement; current = current.parentElement) ancestors.unshift(stableLabel(current));
    return {
      tag: el.localName,
      locator: stableLocator(el),
      role: roleOf(el) || null,
      name: accessibleName(el) || null,
      landmark: landmark?.label || null,
      section: sectionPath(el, landmark?.element),
      ancestors,
      classes: classList(el),
      excerpt: elementExcerpt(el),
      quote,
      occurrences: quote.exact ? countOccurrences(quote.exact, docFor(el)) : null,
    };
  }


  function snapshotDocument({ omit = [] } = {}) {
    const document = root.document;
    if (!document?.documentElement) throw new Error('No page document available');
    const pathTo = el => {
      const path = [];
      for (let node = el; node && node !== document.documentElement; node = node.parentNode) {
        if (!node.parentNode) return null;
        path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node));
      }
      return path;
    };
    const omitted = omit.filter(el => el?.isConnected && el !== document.documentElement).map(pathTo).filter(Boolean);
    // Import into an inert document: cloning in the live document upgrades custom
    // elements and can run site constructors/attribute callbacks during export.
    const inertDocument = document.implementation.createHTMLDocument('');
    const clone = inertDocument.importNode(document.documentElement, true);
    // Remove later document positions first so earlier paths stay valid.
    omitted.sort((a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return b[i] - a[i]; return b.length - a.length; });
    for (const path of omitted) {
      let node = clone;
      for (const index of path) node = node?.childNodes[index];
      node?.remove();
    }
    clone.querySelectorAll(ROOT + ',script,style,noscript,iframe,object,embed,template,input[type="hidden"],meta,base').forEach(el => el.remove());
    const comments = inertDocument.createTreeWalker(clone, 128 /* SHOW_COMMENT */);
    const remove = [];
    while (comments.nextNode()) remove.push(comments.currentNode);
    remove.forEach(node => node.remove());
    for (const el of [clone, ...clone.querySelectorAll('*')]) {
      for (const attribute of Array.from(el.attributes)) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on') || name.startsWith('data-') || /(?:token|secret|password|nonce|authorization|credential|csrf)/i.test(name) || ['value', 'checked', 'selected', 'srcdoc', 'integrity', 'autofocus', 'contenteditable', 'style', 'srcset', 'imagesrcset', 'ping', 'archive', 'attributionsrc', 'manifest'].includes(name)) {
          el.removeAttribute(attribute.name);
        } else if (['href', 'src', 'action', 'formaction', 'poster', 'xlink:href', 'cite', 'background', 'longdesc', 'usemap', 'profile', 'codebase', 'data'].includes(name)) {
          const value = attribute.value.trim();
          if (/^(?:javascript|vbscript|data):/i.test(value.replace(/[\u0000-\u0020]/g, ''))) el.removeAttribute(attribute.name);
          else {
            try {
              const url = new URL(value, document.baseURI);
              // Strip query strings/fragments and embedded basic-auth credentials.
              // Restrict references to inert HTTP(S) evidence; mailto/tel/blob and
              // custom schemes may carry private payloads outside query strings.
              if (!['http:', 'https:'].includes(url.protocol)) { el.removeAttribute(attribute.name); continue; }
              url.username = ''; url.password = ''; url.search = ''; url.hash = '';
              el.setAttribute(attribute.name, url.href);
            } catch (_) { el.removeAttribute(attribute.name); }
          }
        }
      }
      if (el.localName === 'textarea') el.textContent = '';
      if (el.localName === 'option') el.textContent = '[option omitted]';
    }
    // This is evidence, not a standalone archived site. The CSP prevents accidental active use.
    let head = Array.from(clone.children).find(el => el.localName === 'head');
    if (!head) { head = inertDocument.createElement('head'); clone.prepend(head); }
    {
      const csp = inertDocument.createElement('meta');
      csp.setAttribute('http-equiv', 'Content-Security-Policy');
      csp.setAttribute('content', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'");
      head.prepend(csp);
    }
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  const api = {
    MARKS, plainModel, modelFrom, marksAt, replaceRange, toggleMark, modelRuns, modelFormatting, modelsEqual, modelHtml,
    captureContext, inlineMarkup, isHashedToken, cleanUrl,
    createSegment, segmentCurrent, segmentContains, segmentTextNodes, renderSegment, readSegment, segmentOffset, segmentPosition,
    describeElement, scrollContainerFor, createAnchor, resolveAnchor, findElement, snapshotDocument, caretAtPoint, locateTextNodeAtPoint, describeTextNode, resolveTextNode, isEditableTextNode, applyTextEdit };
  root.PageCritCore = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
