/* DOM evidence and geometry helpers. No network access; never evaluates page content. */
(function (root) {
  'use strict';
  const ROOT = '[data-page-notes-root]';
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

  function locateTextNodeAtPoint(x, y) {
    const document = root.document;
    let node = null;
    if (document.caretPositionFromPoint) node = document.caretPositionFromPoint(x, y)?.offsetNode;
    else if (document.caretRangeFromPoint) node = document.caretRangeFromPoint(x, y)?.startContainer;
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

  function snapshotDocument() {
    const document = root.document;
    if (!document?.documentElement) throw new Error('No page document available');
    // Import into an inert document: cloning in the live document upgrades custom
    // elements and can run site constructors/attribute callbacks during export.
    const inertDocument = document.implementation.createHTMLDocument('');
    const clone = inertDocument.importNode(document.documentElement, true);
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

  const api = { describeElement, scrollContainerFor, createAnchor, resolveAnchor, findElement, snapshotDocument, locateTextNodeAtPoint, describeTextNode, resolveTextNode, isEditableTextNode, applyTextEdit };
  root.PageNotesCore = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
