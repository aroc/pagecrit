import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,cp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
// Tools are toggles: turn one on only if it isn't already.
const ensure=async tool=>{if(await tool.getAttribute('aria-pressed')!=='true')await tool.click();};
const root=path.resolve(import.meta.dirname,'..');
const temp=await mkdtemp(path.join(tmpdir(),'pagecrit-test-'));
const fixture=await readFile(path.join(root,'tests/fixture.html'));
const server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end(fixture);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
let context;
try {
 // Synthetic-only localhost permission lets an automated test inject without clicking browser chrome.
 // The shipped manifest is unchanged and has no host permissions.
 const ext=path.join(temp,'extension'); await cp(path.join(root,'extension'),ext,{recursive:true});
 const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json'),'utf8'));
 assert.equal(manifest.host_permissions,undefined);
 manifest.host_permissions=['http://127.0.0.1/*'];
 await writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));
 const contentSource=await readFile(path.join(ext,'content.js'),'utf8');
 assert.ok(contentSource.includes("host.attachShadow({ mode: 'closed' })"));
 // Open only the synthetic test copy so Playwright can locate controls. Production is closed.
 await writeFile(path.join(ext,'content.js'),contentSource.replace("host.attachShadow({ mode: 'closed' })","host.attachShadow({ mode: 'open' })"));
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,viewport:{width:1280,height:900},acceptDownloads:true,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const page=await context.newPage(); await page.goto(url);
 const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,url);
 const inject=()=>worker.evaluate(async tabId=>chrome.scripting.executeScript({target:{tabId},files:['core.js','content.js']}),tabId);
 await inject();
 const ui=page.locator('[data-pagecrit-root]');
 await ui.getByRole('region',{name:'PageCrit review'}).waitFor();
 await inject(); assert.equal(await page.locator('[data-pagecrit-root]').count(),1);
 await ui.getByRole('button',{name:'Edit text',exact:true}).evaluate(el=>el.click());
 assert.equal(await ui.getByRole('button',{name:'Edit text',exact:true}).getAttribute('aria-pressed'),'false');
 console.log('PASS actual MV3 worker and isolated scripts; activation idempotent; synthetic clicks rejected');
 const textPoint=async(selector,index=0)=>page.locator(selector).evaluate((el,index)=>{
   const node=[...el.childNodes].filter(n=>n.nodeType===3)[index];const r=document.createRange();r.selectNodeContents(node);const rect=r.getClientRects()[0];return{x:rect.x+Math.min(25,rect.width/2),y:rect.y+rect.height/2};
 },index);
 const clickText=async selector=>{const p=await textPoint(selector);await page.mouse.click(p.x,p.y);};
 // Text is edited in place on the page; select-all is scoped to the clicked text node.
 const typeInline=async value=>{await page.keyboard.press('ControlOrMeta+A');if(value)await page.keyboard.insertText(value);else await page.keyboard.press('Backspace');};
 await ensure(ui.getByRole('button',{name:'Edit text',exact:true}));
 await clickText('#headline');
 await typeInline('Make room for ');
 assert.equal(await page.locator('#headline em').textContent(),'better work.');
 await ui.getByRole('button',{name:'Save',exact:true}).click();
 assert.equal(await page.locator('#headline').textContent(),'Make room for better work.');
 await clickText('#headline');await typeInline('Find space for ');await ui.getByRole('button',{name:'Save',exact:true}).click();
 await clickText('#headline');await typeInline('Discard this preview');await ui.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(await page.locator('#headline').textContent(),'Find space for better work.');
 console.log('PASS text edits preserve inline markup, repeated edits preserve original, cancel restores preview');
 // Clicking a page button in edit mode must not activate the site.
 await clickText('#cta');await typeInline('Try a calmer day');await ui.getByRole('button',{name:'Save',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.accidentalClicks),0);
 // Test empty text can still be edited/reverted from tracked review row.
 await clickText('#copy');await typeInline('');await ui.getByRole('button',{name:'Save',exact:true}).click();
 const emptyRow=ui.locator('article').filter({hasText:'A calmer place for your projects'});
 await emptyRow.getByRole('button',{name:'Edit',exact:true}).click();await typeInline('A calm workspace.');await ui.getByRole('button',{name:'Save',exact:true}).click();
 await emptyRow.getByRole('button',{name:'Revert',exact:true}).click();
 assert.match(await page.locator('#copy').textContent(),/^A calmer place/);
 console.log('PASS normal site button action blocked; empty text edit/revert works');
 // Page pin after scrolling: document coordinate stays constant.
 await page.locator('#lower').scrollIntoViewIfNeeded();
 await ensure(ui.getByRole('button',{name:'Pin',exact:true}));
 await ui.getByRole('button',{name:'Pin to page',exact:true}).click();
 const point=await textPoint('#lower');const offset=await page.evaluate(()=>scrollY);
 await page.mouse.click(point.x,point.y);await ui.locator('textarea').fill('Clarify this lower section.');await ui.getByRole('button',{name:'Save',exact:true}).click();
 const pagePin=ui.getByRole('button',{name:/^Note 1:/});
 const initialTop=await pagePin.evaluate(el=>parseFloat(el.style.top));
 await page.evaluate(()=>window.scrollBy(0,100));await page.waitForTimeout(80);
 assert.ok(Math.abs(await pagePin.evaluate(el=>parseFloat(el.style.top))-(initialTop-100))<2);
 // Element pin follows nested scrolling, then hides when clipped by its scroller.
 await page.locator('#scroller').scrollIntoViewIfNeeded();
 await ui.getByRole('button',{name:'Pin to element',exact:true}).click();
 const nestedPoint=await textPoint('#nested');await page.mouse.click(nestedPoint.x,nestedPoint.y);
 await ui.locator('textarea').fill('Make this section more useful.');await ui.getByRole('button',{name:'Save',exact:true}).click();
 const nestedPin=ui.getByRole('button',{name:/^Note 2:/,includeHidden:true});
 const nestedTop=await nestedPin.evaluate(el=>parseFloat(el.style.top));
 await page.locator('#scroller').evaluate(el=>el.scrollTop=30);await page.waitForTimeout(80);
 assert.ok(Math.abs(await nestedPin.evaluate(el=>parseFloat(el.style.top))-(nestedTop-30))<2);
 await page.locator('#scroller').evaluate(el=>el.scrollTop=180);await page.waitForTimeout(80);
 assert.equal(await nestedPin.evaluate(el=>getComputedStyle(el).display),'none');
 await page.locator('#scroller').evaluate(el=>el.scrollTop=0);
 console.log('PASS page-scroll coordinates, nested element-scroll tracking and clipping');
 // Actual worker delivery via chrome.downloads; test chooses temp location instead of OS Save As dialog.
 await mkdir(path.join(temp,'downloads'));
 const cdp=await context.newCDPSession(page);
 await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.join(temp,'downloads'),eventsEnabled:true});
 await worker.evaluate(()=>{const original=chrome.downloads.download.bind(chrome.downloads);globalThis.testDownloadOriginal=original;chrome.downloads.download=opts=>{globalThis.testRequestedFilename=opts.filename;return original({...opts,saveAs:false});};const render=PageCritExport.renderDigest;PageCritExport.renderDigest=review=>{globalThis.lastReview=review;return render(review);};});
 await ui.getByRole('button',{name:'Download review',exact:true}).click();
 await ui.getByRole('status').filter({hasText:'Download started'}).waitFor();
 let downloaded;
 for(let i=0;i<30;i++){
   downloaded=await worker.evaluate(async()=>(await chrome.downloads.search({}))[0]);
   if(downloaded?.state==='complete')break;await page.waitForTimeout(100);
 }
 assert.equal(downloaded?.state,'complete', JSON.stringify(downloaded));
 // CDP download behavior renames saved files; check the name Chrome accepted from the extension.
 assert.match(await worker.evaluate(()=>globalThis.testRequestedFilename),/^\d{4}-\d{2}-\d{2} \d{2}-\d{2} Fieldwork — synthetic test page\.md$/);
 const bundle=await worker.evaluate(()=>globalThis.lastReview);const markdown=await readFile(downloaded.filename,'utf8');
 assert.equal(bundle.comments.length,2);assert.deepEqual(bundle.comments.map(c=>c.anchor.kind),['page','element']);assert.equal(bundle.edits.length,2);
 assert.equal(bundle.edits[0].before,'Make space for ');assert.equal(bundle.edits[0].after,'Find space for ');
 assert.ok(Math.abs(bundle.comments[0].anchor.document.y-(point.y+offset))<2);
 assert.match(markdown,/^# Review: Fieldwork — synthetic test page\n/);
 assert.match(markdown,/### 1\. Text edit · suggested\n- Original: `Make space for`\n- Replace: `Find space for`\n- Element after the change \(keep its inline markup\): `Find space for <em>better work\.<\/em>`\n- Section: main\n/);
 assert.match(markdown,/- Locator: `#headline` · role: heading · name: `Make space for better work\.`/);
 assert.match(markdown,/### \d\. Comment · pin 1 · suggested\n- Note: Clarify this lower section\.\n[\s\S]*- Text: `Lower-page content for coordinate tests\.`/);
 assert.match(markdown,/### \d\. Comment · pin 2 · suggested\n- Note: Make this section more useful\.\n[\s\S]*- Locator: `#nested`/);
 assert.ok(markdown.length<8000,`digest stays small: ${markdown.length}`);
 for(const forbidden of ['SYNTHETIC_SECRET','SYNTHETIC_PASSWORD','SYNTHETIC_HIDDEN','SYNTHETIC_FORM','SYNTHETIC_TOKEN','data-pagecrit-root','<script','onclick=','accidentalClicks'])assert.ok(!markdown.includes(forbidden),forbidden);
 console.log('PASS complete local Markdown digest: exact edits with inline markup, anchored context, no page secrets or scripts');
 // Dynamic replacement remains a request with conflict flag, never silently matched to replacement.
 await page.locator('#headline').evaluate(el=>{el.innerHTML='Server replaced this heading';});
 await worker.evaluate(()=>{chrome.downloads.download=async()=>{throw new Error('User canceled the save dialog');};});
 await ui.getByRole('button',{name:'Download review',exact:true}).click();
 await ui.getByRole('status').filter({hasText:'User canceled'}).waitFor();
 assert.equal(await ui.locator('.after').count(),2);
 assert.ok(await ui.getByText('The page changed this text. Your requested edit is still saved.').count());
 // Keep a visual artifact from a synthetic page only.
 await page.evaluate(()=>window.scrollTo(0,0));
 await mkdir(path.join(root,'test-results'),{recursive:true});
 await page.screenshot({path:path.join(root,'test-results/review.png')});
 await ui.getByRole('button',{name:'Close review',exact:true}).click();
 await ui.getByRole('button',{name:'Discard & close',exact:true}).click();
 assert.equal(await page.locator('[data-pagecrit-root]').count(),0);
 assert.equal(await page.locator('#cta').textContent(),'Start your next chapter');
 assert.equal(await page.locator('#headline').textContent(),'Server replaced this heading');
 console.log('PASS failed download retains draft; conflicting site change not overwritten by discard; UI cleanup');
 // Separate untouched production content script: closed shadow DOM and genuine mouse/keyboard.
 await context.close(); context=null;
 const prodExt=path.join(temp,'production-extension');await cp(path.join(root,'extension'),prodExt,{recursive:true});
 await writeFile(path.join(prodExt,'manifest.json'),JSON.stringify(manifest));
 context=await chromium.launchPersistentContext(path.join(temp,'production-profile'),{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${prodExt}`,`--load-extension=${prodExt}`]});
 const prodWorker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const prodPage=await context.newPage();await prodPage.goto(url);
 const prodTab=await prodWorker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,url);
 await prodWorker.evaluate(async tabId=>chrome.scripting.executeScript({target:{tabId},files:['core.js','content.js']}),prodTab);
 assert.equal(await prodPage.locator('[data-pagecrit-root]').evaluate(el=>el.shadowRoot),null);
 const prodCDP=await context.newCDPSession(prodPage);
 async function clickAccessible(name) {
   const {nodes}=await prodCDP.send('Accessibility.getFullAXTree');
   const node=nodes.find(n=>n.role?.value==='button'&&n.name?.value===name);
   assert.ok(node,`Production control accessible: ${name}`);
   const {model}=await prodCDP.send('DOM.getBoxModel',{backendNodeId:node.backendDOMNodeId});
   const q=model.border;await prodPage.mouse.click((q[0]+q[4])/2,(q[1]+q[5])/2);
 }
 await clickAccessible('Edit text');
 const hp=await prodPage.locator('#headline').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el.firstChild);const r=range.getClientRects()[0];return{x:r.x+20,y:r.y+r.height/2};});
 await prodPage.mouse.click(hp.x,hp.y);await prodPage.waitForTimeout(100);
 await prodPage.keyboard.press('ControlOrMeta+A');await prodPage.keyboard.insertText('Make time for ');await clickAccessible('Save');
 assert.equal(await prodPage.locator('#headline').textContent(),'Make time for better work.');
 await clickAccessible('Pin');await prodPage.mouse.click(260,390);await prodPage.waitForTimeout(100);
 await prodPage.keyboard.insertText('Can we make the benefit more specific?');await clickAccessible('Save');
 await prodPage.screenshot({path:path.join(root,'test-results/production-review.png')});
 console.log('PASS untouched production closed-shadow UI with real mouse/keyboard: edit, pin, save');

} finally {
 if(context)await context.close();
 await new Promise(resolve=>server.close(resolve));
 await rm(temp,{recursive:true,force:true});
}
