import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('../extension/core.js');

function fixture(rect = { left: 20, top: 30, width: 100, height: 50 }) {
  const win = { scrollX: 12, scrollY: 400, innerWidth: 1000, innerHeight: 600 };
  const doc = { defaultView: win, querySelectorAll: () => [el] };
  const el = {
    nodeType: 1, localName: 'p', id: 'greeting', ownerDocument: doc,
    textContent: 'Hello world', parentElement: null, isConnected: true,
    getAttribute: () => null, closest: () => null,
    getBoundingClientRect: () => rect, getRootNode: () => doc,
    childNodes: []
  };
  return { el, win, doc, rect };
}

test('page anchors retain document position and account for scroll', () => {
  const { el, win } = fixture();
  const anchor = core.createAnchor(el, 70, 55, 'page');
  assert.deepEqual(anchor.document, { x: 82, y: 455 });
  win.scrollY = 450;
  assert.deepEqual(core.resolveAnchor(anchor, el), { x: 70, y: 5, resolved: true, visible: true });
});

test('element anchors follow nested scroll and proportional resizing', () => {
  const { el, rect } = fixture();
  const anchor = core.createAnchor(el, 70, 55, 'element');
  assert.deepEqual(anchor.offset, { x: 50, y: 25, xRatio: 0.5, yRatio: 0.5 });
  rect.left = 40; rect.top = -20; rect.width = 200; rect.height = 100;
  assert.deepEqual(core.resolveAnchor(anchor, el), { x: 140, y: 30, resolved: true, visible: true });
});

test('disconnected element reports unresolved with document fallback', () => {
  const { el } = fixture();
  const anchor = core.createAnchor(el, 70, 55, 'element');
  el.isConnected = false;
  assert.deepEqual(core.resolveAnchor(anchor, el), { x: 70, y: 55, resolved: false, visible: true });
});

test('rejects invalid coordinates and anchor kinds', () => {
  const { el } = fixture();
  assert.throws(() => core.createAnchor(el, NaN, 0), /finite/);
  assert.throws(() => core.createAnchor(el, 0, Infinity), /finite/);
  assert.throws(() => core.createAnchor(el, 0, 0, 'unknown'), /kind/);
});

test('text editing only changes selected text node and preserves sibling nodes', () => {
  const { el, doc } = fixture();
  const node = { nodeType: 3, nodeValue: 'Hello ', parentElement: el, ownerDocument: doc, isConnected: true };
  const strong = { nodeType: 1, localName: 'strong', textContent: 'world' };
  el.childNodes = [node, strong];
  const change = core.applyTextEdit(node, 'Goodbye ');
  assert.equal(change.originalText, 'Hello ');
  assert.equal(change.newText, 'Goodbye ');
  assert.deepEqual(change.nodePath, [0]);
  assert.equal(node.nodeValue, 'Goodbye ');
  assert.equal(el.childNodes[1], strong);
  assert.equal(strong.textContent, 'world');
});

test('form/editable nodes and detached text cannot be edited', () => {
  const { el, doc } = fixture();
  const node = { nodeType: 3, nodeValue: 'example', parentElement: el, ownerDocument: doc, isConnected: true };
  el.closest = () => el;
  assert.equal(core.isEditableTextNode(node), false);
  assert.throws(() => core.applyTextEdit(node, 'replacement'), /cannot be edited/);
  el.closest = () => null;
  node.isConnected = false;
  assert.equal(core.isEditableTextNode(node), false);
});

test('descriptors capture both original text and DOM evidence', () => {
  const { el, doc } = fixture();
  const node = { nodeType: 3, nodeValue: 'Hello', parentElement: el, ownerDocument: doc, isConnected: true };
  el.childNodes = [node];
  const descriptor = core.describeTextNode(node);
  assert.equal(descriptor.element.selector, '#greeting');
  assert.equal(descriptor.originalText, 'Hello');
  assert.deepEqual(descriptor.element.rect, { x: 32, y: 430, width: 100, height: 50 });
});


test('element anchor is hidden behind bordered scroll-container clipping', () => {
  const { el, win, rect } = fixture();
  const anchor = core.createAnchor(el, 70, 55, 'element');
  const container = {
    parentElement: null, offsetWidth: 220, offsetHeight: 120,
    clientLeft: 10, clientTop: 10, clientWidth: 200, clientHeight: 100,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 220, height: 120 })
  };
  el.parentElement = container;
  win.getComputedStyle = node => ({ overflowX: node === container ? 'hidden' : 'visible', overflowY: node === container ? 'auto' : 'visible', display: 'block', visibility: 'visible' });
  assert.equal(core.resolveAnchor(anchor, el).visible, true);
  // Simulate nested scrolling: the anchor is within the border, outside the content viewport.
  rect.top = -20;
  assert.equal(core.resolveAnchor(anchor, el).y, 5);
  assert.equal(core.resolveAnchor(anchor, el).visible, false);
  rect.top = 30;
  rect.left = 170;
  assert.equal(core.resolveAnchor(anchor, el).visible, false);
});

test('clipping is axis-specific, accounts for scaling, and checks viewport', () => {
  const { el, win, rect } = fixture();
  const anchor = core.createAnchor(el, 70, 55, 'element');
  const container = {
    parentElement: null, offsetWidth: 110, offsetHeight: 60,
    clientLeft: 5, clientTop: 5, clientWidth: 100, clientHeight: 50,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 220, height: 120 })
  };
  el.parentElement = container;
  win.getComputedStyle = () => ({ overflowX: 'visible', overflowY: 'clip', display: 'block', visibility: 'visible' });
  rect.left = 220;
  assert.equal(core.resolveAnchor(anchor, el).visible, true);
  rect.top = -20;
  assert.equal(core.resolveAnchor(anchor, el).visible, false);
  rect.top = 30;
  rect.left = 1200;
  assert.equal(core.resolveAnchor(anchor, el).visible, false);
});

test('an existing edit can be emptied and filled again', () => {
  const { el, doc } = fixture();
  const node = { nodeType: 3, nodeValue: 'Hello', parentElement: el, ownerDocument: doc, isConnected: true };
  el.childNodes = [node];
  core.applyTextEdit(node, '');
  assert.equal(node.nodeValue, '');
  const change = core.applyTextEdit(node, 'Restored');
  assert.equal(change.originalText, '');
  assert.equal(node.nodeValue, 'Restored');
});

test('text limit is enforced without mutating the original node on rejection', () => {
  const { el, doc } = fixture();
  const node = { nodeType: 3, nodeValue: 'Original', parentElement: el, ownerDocument: doc, isConnected: true };
  el.childNodes = [node];
  for (const invalid of [null, 42, {}, 'x'.repeat(20001)]) {
    assert.throws(() => core.applyTextEdit(node, invalid), /20,000/);
    assert.equal(node.nodeValue, 'Original');
  }
  const maximum = 'x'.repeat(20000);
  assert.equal(core.applyTextEdit(node, maximum).newText, maximum);
});

test('detached original anchor never silently attaches to a same-selector replacement', () => {
  const { el, doc } = fixture();
  const anchor = core.createAnchor(el, 70, 55, 'element');
  const replacement = { ...el };
  doc.querySelectorAll = () => [replacement];
  el.isConnected = false;
  assert.equal(core.resolveAnchor(anchor, el).resolved, false);
  assert.equal(core.findElement(anchor.element, doc), replacement);
});

test('page anchors inside a scrolling container follow that container, not the window', () => {
  const { el, win, doc } = fixture({ left: 20, top: 130, width: 100, height: 50 });
  const scroller = {
    nodeType: 1, localName: 'main', id: 'shell', ownerDocument: doc, textContent: '', parentElement: null, isConnected: true,
    getAttribute: () => null, closest: () => null, getRootNode: () => doc, childNodes: [],
    offsetWidth: 800, offsetHeight: 500, clientLeft: 0, clientTop: 0, clientWidth: 800, clientHeight: 500,
    scrollWidth: 800, scrollHeight: 3000, scrollLeft: 0, scrollTop: 200,
    getBoundingClientRect: () => ({ left: 0, top: 100, width: 800, height: 500 })
  };
  el.parentElement = scroller;
  doc.scrollingElement = {};
  win.getComputedStyle = node => node === scroller ? { overflowX: 'hidden', overflowY: 'auto', position: 'static' } : { overflowX: 'visible', overflowY: 'visible', position: 'static', display: 'block', visibility: 'visible', opacity: '1' };
  assert.equal(core.scrollContainerFor(el), scroller);
  const anchor = core.createAnchor(el, 70, 155, 'page');
  assert.deepEqual(anchor.container.offset, { x: 70, y: 255 });
  assert.equal(anchor.container.element.id, 'shell');
  scroller.scrollTop = 250;
  assert.deepEqual(core.resolveAnchor(anchor, el, scroller), { x: 70, y: 105, resolved: true, visible: true });
  scroller.scrollTop = 1000;
  assert.equal(core.resolveAnchor(anchor, el, scroller).visible, false);
  scroller.isConnected = false;
  assert.equal(core.resolveAnchor(anchor, el, scroller).resolved, false);
  assert.equal(core.createAnchor(el, 70, 155, 'element').container, undefined);
});
