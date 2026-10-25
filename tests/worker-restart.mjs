// Genuine MV3 worker cold-start + local download through the unmodified closed-shadow UI.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

const root = path.resolve(import.meta.dirname, '..');
const temp = await mkdtemp(path.join(tmpdir(), 'pagecrit-worker-'));
let context;
let server;
async function eventually(check, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(message);
}
try {
  const ext = path.join(temp, 'extension');
  await cp(path.join(root, 'extension'), ext, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(ext, 'manifest.json'), 'utf8'));
  assert.equal(manifest.host_permissions, undefined);
  // Sole test change: permission to inject into the synthetic localhost fixture.
  // The actual activeTab toolbar activation is covered separately.
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(path.join(ext, 'manifest.json'), JSON.stringify(manifest));
  server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head><title>Worker restart fixture</title></head><body><h1>Cold start review</h1></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
    timeout: 15000,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  context.setDefaultTimeout(5000);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 5000 });
  const page = await context.newPage();
  await page.goto(url);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
  await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, files: ['core.js', 'content.js'] }), tabId);
  assert.equal(await page.locator('[data-pagecrit-root]').evaluate(host => host.shadowRoot), null);
  // Real keyboard and mouse only (closed shadow root): P for the pin tool, click the heading, type, save.
  await page.waitForTimeout(300);
  await page.keyboard.press('p');
  const heading = await page.locator('h1').boundingBox();
  await page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
  await page.waitForTimeout(100);
  await page.keyboard.insertText('Cold start note');
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.keyboard.press('Escape');
  const cdp = await context.newCDPSession(page);
  const downloads = path.join(temp, 'downloads');
  await mkdir(downloads);
  // CDP selects a synthetic-only output directory. downloads.download and its saveAs option
  // are untouched; this test never mocks the service worker or export delivery.
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  let lastWorkerState;
  const observedStates = [];
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    for (const version of versions) if (version.scriptURL === worker.url()) {
      lastWorkerState = version.runningStatus;
      observedStates.push(version.runningStatus);
    }
  });
  await cdp.send('ServiceWorker.enable');
  await eventually(() => lastWorkerState === 'running', 'Worker was not observed running before restart');
  // Let the review finish loading/saving its draft so nothing but the export wakes the worker.
  await page.waitForTimeout(800);
  await cdp.send('ServiceWorker.stopAllWorkers');
  await eventually(() => lastWorkerState === 'stopped', 'Worker did not stop');

  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const done = nodes.find(node => node.role?.value === 'button' && node.name?.value === 'Download review');
  assert.ok(done, 'Done is accessible in the production closed shadow root');
  const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: done.backendDOMNodeId });
  const quad = model.border;
  await page.mouse.click((quad[0] + quad[4]) / 2, (quad[1] + quad[5]) / 2);
  await eventually(() => lastWorkerState === 'running', 'Export did not wake the stopped MV3 worker');
  await eventually(async () => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    return nodes.some(node => node.role?.value === 'StaticText' && node.name?.value?.includes('Download started'));
  }, 'Cold-start export did not report success');
  // Playwright may retain the destroyed Worker handle after a Chrome cold restart, so read the
  // finished file from the synthetic download folder instead of asking the worker.
  const downloaded = await eventually(async () => {
    const names = (await readdir(downloads)).filter(name => !name.endsWith('.crdownload'));
    return names.length ? { filename: path.join(downloads, names[0]) } : null;
  }, 'Cold-start export did not complete its local download');
  assert.ok(path.resolve(downloaded.filename).startsWith(downloads + path.sep), 'Download stays inside synthetic test directory');
  const markdown = await readFile(downloaded.filename, 'utf8');
  assert.match(markdown, /^# Review: /);
  assert.ok(markdown.includes(`- Page: ${url}\n`), 'page URL in the header');
  assert.match(markdown, /- Summary: 1 comment, 0 text edits, 0 removals/);
  assert.match(markdown, /- Note: Cold start note\n/);
  assert.ok(observedStates.includes('stopped'));
  console.log('PASS genuine MV3 worker stop/restart, unmodified closed-shadow UI and complete local Markdown download');
} finally {
  if (context) await context.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
