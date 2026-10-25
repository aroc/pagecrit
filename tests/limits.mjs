// The Markdown digest stays small and bounded however large or hostile the page is.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,cp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
// Tools are toggles: turn one on only if it isn't already.
const ensure=async tool=>{if(await tool.getAttribute('aria-pressed')!=='true')await tool.click();};
const root=path.resolve(import.meta.dirname,'..'), temp=await mkdtemp(path.join(tmpdir(),'page-notes-limits-'));
const huge='<div hidden>'+'x'.repeat(11*1024*1024)+'</div><p id="wall">'+'word '.repeat(300000)+'</p>'+'<div class="css-1x9f3k">'.repeat(300)+'<span id="deep" aria-label="'+'L'.repeat(100000)+'">Deep target</span>'+'</div>'.repeat(300);
const server=http.createServer((_req,res)=>res.end('<!doctype html><title>'+'T'.repeat(5000)+'</title><h1>Review this page</h1><p id="keep">Keep this feedback</p>'+huge));
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/`;
let context;
try {
 const ext=path.join(temp,'extension');await cp(path.join(root,'extension'),ext,{recursive:true});
 const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*'];await writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));
 const source=await readFile(path.join(ext,'content.js'),'utf8');
 await writeFile(path.join(ext,'content.js'),source.replace("host.attachShadow({ mode: 'closed' })","host.attachShadow({ mode: 'open' })"));
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,viewport:{width:1200,height:900},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
 context.setDefaultTimeout(10000);const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker.evaluate(()=>{const original=chrome.downloads.download.bind(chrome.downloads);chrome.downloads.download=opts=>original({...opts,saveAs:false});});
 const page=await context.newPage();await page.goto(base);
 const tab=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,page.url());
 await worker.evaluate(async tabId=>chrome.scripting.executeScript({target:{tabId},files:['core.js','content.js']}),tab);
 const ui=page.locator('[data-page-notes-root]');const button=name=>ui.getByRole('button',{name,exact:true});
 await mkdir(path.join(temp,'downloads'));const cdp=await context.newCDPSession(page);await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.join(temp,'downloads')});
 const started=Date.now();
 for(const selector of ['#keep','#wall','#deep']){await ensure(button('Pin'));await page.locator(selector).scrollIntoViewIfNeeded();const b=await page.locator(selector).boundingBox();await page.mouse.click(b.x+5,b.y+5);await ui.locator('textarea').fill(`Note on ${selector}`);await button('Save').click();}
 // The 1.5 MB paragraph is over the edit limit; edit a normal paragraph on the same hostile page.
 await ensure(button('Edit text'));await page.locator('#keep').scrollIntoViewIfNeeded();const w=await page.locator('#keep').boundingBox();await page.mouse.click(w.x+5,w.y+w.height/2);await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('Short replacement');await page.keyboard.press('Enter');
 await button('Download review').click();await ui.getByRole('status').filter({hasText:'Download started'}).waitFor();
 let d;for(let i=0;i<50;i++){d=await worker.evaluate(async()=>(await chrome.downloads.search({}))[0]);if(d?.state==='complete')break;await page.waitForTimeout(100);}
 assert.equal(d?.state,'complete');const markdown=await readFile(d.filename,'utf8');
 assert.ok(markdown.length<40000,`digest is ${markdown.length} characters`);assert.ok(!/x{100}/.test(markdown),'hidden text never exported');
 assert.ok(!/L{100}/.test(markdown),'attribute values capped');assert.ok(!/(word ){60}/.test(markdown.replace(/- Original:[^\n]*\n/,'')),'context capped');assert.ok(!/T{120}/.test(markdown),'title capped at 120 characters');
 for(const note of ['#keep','#wall','#deep'])assert.match(markdown,new RegExp(`- Note: Note on ${note}`));assert.match(markdown,/- Locator: `#deep` · role: (null|.*)|- Locator: `#deep`/);
 assert.match(markdown,/- Replace: `Short replacement`/);assert.ok(Date.now()-started<60000);
 console.log(`PASS hostile 11 MB page with huge text, giant attributes and deep nesting yields a ${markdown.length}-character digest`);
}finally{if(context)await context.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
