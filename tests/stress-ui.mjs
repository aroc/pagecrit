// Synthetic browser regression tests. The production UI remains closed-shadow.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,cp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
// Tools are toggles: turn one on only if it isn't already.
const ensure=async tool=>{if(await tool.getAttribute('aria-pressed')!=='true')await tool.click();};
// Retry a check until it passes: tests wait on the condition itself, never a fixed delay.
const eventually=async(check,timeout=15000)=>{const end=Date.now()+timeout;for(;;){try{return await check();}catch(error){if(Date.now()>end)throw error;}await new Promise(r=>setTimeout(r,25));}};
const root=path.resolve(import.meta.dirname,'..');
const temp=await mkdtemp(path.join(tmpdir(),'pagecrit-stress-ui-'));
const fixture=await readFile(path.join(root,'tests/stress-fixture.html'));
const server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end(fixture);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/`;
let context; const failures=[];let checks=0;
try {
 const ext=path.join(temp,'extension');await cp(path.join(root,'extension'),ext,{recursive:true});
 const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json'),'utf8'));assert.equal(manifest.host_permissions,undefined);
 manifest.host_permissions=['http://127.0.0.1/*'];await writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));
 const source=await readFile(path.join(ext,'content.js'),'utf8');assert.ok(source.includes("host.attachShadow({ mode: 'closed' })"));
 await writeFile(path.join(ext,'content.js'),source.replace("host.attachShadow({ mode: 'closed' })","host.attachShadow({ mode: 'open' })"));
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,viewport:{width:1280,height:1000},acceptDownloads:true,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
 context.setDefaultTimeout(15000);
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await mkdir(path.join(temp,'downloads'));
 // Keep the rendered review model alongside the downloaded Markdown so tests can check both.
 // Reinstalled before each export: an idle MV3 worker can restart mid-suite and drop it.
 const sw=()=>context.serviceWorkers().at(-1)||worker;
 const instrument=()=>sw().evaluate(()=>{if(globalThis.testInstrumented)return;globalThis.testInstrumented=true;const download=chrome.downloads.download.bind(chrome.downloads);chrome.downloads.download=opts=>download({...opts,saveAs:false});const render=PageCritExport.renderDigest;PageCritExport.renderDigest=review=>{globalThis.lastReview=review;return render(review);};});
 await instrument();
 const newDownload=before=>eventually(async()=>{const d=await sw().evaluate(async before=>(await chrome.downloads.search({})).find(d=>!before.includes(d.id)),before);assert.equal(d?.state,'complete');return d;});
 const draft=tab=>sw().evaluate(async key=>(await chrome.storage.session.get(key))[key],`draft:${tab}`);
 async function setup(){
  const page=await context.newPage();await page.goto(base+crypto.randomUUID());
  const tab=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,page.url());
  const inject=()=>worker.evaluate(async tabId=>chrome.scripting.executeScript({target:{tabId},files:['core.js','content.js']}),tab);
  await inject();const ui=page.locator('[data-pagecrit-root]');await ui.getByRole('region',{name:'PageCrit review'}).waitFor();
  const cdp=await context.newCDPSession(page);await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.join(temp,'downloads'),eventsEnabled:true});
  const button=(name)=>ui.getByRole('button',{name,exact:true});
  // Two animation frames: whatever the extension queued for the next frame has run.
  const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  // The overlay redraws on the frame after a pointer move. This page listener runs after the extension's, so its frame callback runs after the redraw.
  const moveMouse=async(x,y)=>{await page.evaluate(()=>{window.testMoved=false;addEventListener('pointermove',()=>requestAnimationFrame(()=>{window.testMoved=true;}),{capture:true,once:true});});await page.mouse.move(x,y);await page.waitForFunction(()=>window.testMoved);};
  // Run an action that scrolls the page or a container and wait until that scroll, smooth or instant, has ended.
  const scrolls=async action=>{await page.evaluate(()=>{window.testScrolled=false;addEventListener('scrollend',()=>{window.testScrolled=true;},{capture:true,once:true});});await action();await page.waitForFunction(()=>window.testScrolled);};
  // page.reload waits for load, the moment the worker restores a saved draft. Nothing signals that no restore is coming, so allow a short window for one to appear.
  const reloadClosed=async message=>{await page.reload();await page.waitForTimeout(500);assert.equal(await page.locator('[data-pagecrit-root]').count(),0,message);};
  const textPoint=async(selector,index=0)=>page.locator(selector).evaluate((el,index)=>{const n=[...el.childNodes].filter(n=>n.nodeType===3)[index];const r=document.createRange();r.selectNodeContents(n);const rect=r.getClientRects()[0];return{x:rect.x+Math.min(16,rect.width/2),y:rect.y+rect.height/2};},index);
  const clickText=async(selector,index=0)=>{await page.locator(selector).scrollIntoViewIfNeeded();const p=await textPoint(selector,index);await page.mouse.click(p.x,p.y);};
  // Replace the clicked text node in place: select-all is scoped to that node.
  const typeInline=async value=>{await page.keyboard.press('ControlOrMeta+A');if(value)await page.keyboard.insertText(value);else await page.keyboard.press('Backspace');};
  const editing=()=>page.locator('[contenteditable="plaintext-only"]').count();
  const edit=async(selector,value,index=0)=>{await ensure(button('Edit text'));await clickText(selector,index);await typeInline(value);await button('Save').click();};
  const exportBundle=async()=>{
   // An empty review offers nothing to send: no Copy/Download, just the empty state.
   if(await ui.locator('footer').isHidden()){await ui.locator('.empty').waitFor();assert.equal(await ui.getByRole('button',{name:'Download review'}).count(),0);return{empty:true,comments:[],edits:[],removals:[],markdown:''};}
   await instrument();const before=await sw().evaluate(async()=>(await chrome.downloads.search({})).map(d=>d.id));await button('Download review').click();const d=await newDownload(before);return{...await sw().evaluate(()=>globalThis.lastReview),markdown:await readFile(d.filename,'utf8')};};
  return{page,ui,button,clickText,edit,typeInline,editing,exportBundle,inject,tab,frames,moveMouse,scrolls,reloadClosed};
 }
 async function test(name,run){let env;try{env=await setup();await run(env);checks++;console.log('PASS',name);}catch(e){failures.push({name,error:e.stack});console.error('FAIL',name,e.message);}finally{if(env)await env.page.close({runBeforeUnload:false});}}
 await test('multiline Unicode HTML-looking text is literal; clipboard-like paste retains exact text',async({page,ui,button,clickText,exportBundle})=>{
  const value='Line one\n日本語 café 🦆 e\u0301\n<img src=x onerror="window.siteActions=9"> & <b>literal</b>\nمرحبا';
  await ensure(button('Edit text'));await clickText('#inline');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText(value);await page.keyboard.press('ControlOrMeta+Enter');
  assert.equal(await page.locator('#inline').textContent(),value);assert.equal(await page.locator('#inline img,#inline b').count(),0);assert.equal(await page.evaluate(()=>window.siteActions),0);
  const bundle=await exportBundle();assert.equal(bundle.edits[0].after,value);assert.ok(bundle.markdown.includes('\n  <img src=x onerror="window.siteActions=9"> & <b>literal</b>\n'),'multi-line replacement kept verbatim in a fenced block');
 });
 await test('repeated saves collapse ledger to one edit and original value removes it',async({page,ui,button,edit,exportBundle})=>{
  const original=await page.locator('#plain').textContent();for(let i=0;i<3;i++)await edit('#plain',`Version ${i}`);
  let bundle=await exportBundle();assert.equal(bundle.edits.length,1);assert.equal(bundle.edits[0].before,original);assert.equal(bundle.edits[0].after,'Version 2');
  await edit('#plain',original);bundle=await exportBundle();assert.equal(bundle.edits.length,0);
 });
 await test('comment update/remove renumbers pins without changing surviving identities',async({page,ui,button,clickText,exportBundle})=>{
  for(let i=1;i<=3;i++){await ensure(button('Pin'));await clickText(`#pin${i}`);await ui.locator('textarea').fill(`Comment ${i}`);await button('Save').click();}
  const first=await exportBundle();const secondId=first.comments[1].id,thirdId=first.comments[2].id;
  await ui.locator('article').filter({hasText:'Comment 2'}).getByRole('button',{name:'Edit',exact:true}).click();await ui.locator('textarea').fill('Second revised 🦆');await button('Save').click();
  await ui.locator('article').filter({hasText:'Comment 1'}).getByRole('button',{name:'Delete',exact:true}).click();
  assert.equal(await ui.getByRole('button',{name:'Note 1: Second revised 🦆'}).count(),1);assert.equal(await ui.getByRole('button',{name:'Note 2: Comment 3'}).count(),1);
  const bundle=await exportBundle();assert.deepEqual(bundle.comments.map(c=>c.id),[secondId,thirdId]);assert.equal(bundle.comments[0].text,'Second revised 🦆');assert.match(bundle.markdown,/Comment · pin 1 · suggested\n- Note: Second revised 🦆/);
 });
 await test('pin to element outlines the hovered element in the overlay without shifting layout',async({page,ui,button,moveMouse,scrolls,frames})=>{
  await ensure(button('Pin'));assert.equal(await button('Pin to element').getAttribute('aria-pressed'),'true');
  assert.deepEqual(await ui.getByRole('group',{name:'Pin position'}).getByRole('button').allTextContents(),['Pin to element','Pin to page']);
  const before=await page.locator('#pin1').boundingBox();const html=await page.locator('main').innerHTML();
  await moveMouse(before.x+10,before.y+before.height/2);
  const hover=()=>ui.locator('.hover').evaluate(el=>({display:getComputedStyle(el).display,x:parseFloat(el.style.left),y:parseFloat(el.style.top),w:parseFloat(el.style.width),h:parseFloat(el.style.height),tag:el.textContent}));
  const box=await hover();assert.equal(box.display,'block');assert.equal(box.tag,'p#pin1');
  assert.ok(Math.abs(box.x-before.x)<1&&Math.abs(box.y-before.y)<1&&Math.abs(box.w-before.width)<1&&Math.abs(box.h-before.height)<1,JSON.stringify({box,before}));
  assert.deepEqual(await page.locator('#pin1').boundingBox(),before);assert.equal(await page.locator('main').innerHTML(),html);
  const next=await page.locator('#pin2').boundingBox();await moveMouse(next.x+10,next.y+next.height/2);assert.equal((await hover()).tag,'p#pin2');
  await scrolls(()=>page.mouse.wheel(0,40));await frames();const scrolled=await page.locator('#pin2').boundingBox();const after=await hover();assert.ok(after.tag!=='p#pin2'||Math.abs(after.y-scrolled.y)<1,'outline tracks scroll');
  await button('Pin to page').click();assert.equal(await button('Pin to page').getAttribute('aria-pressed'),'true');await moveMouse(next.x+12,next.y+next.height/2);assert.equal((await hover()).display,'none','page pins do not outline elements');
  await button('Pin').click();assert.equal(await button('Pin').getAttribute('aria-pressed'),'false','clicking the active tool turns it off');await moveMouse(before.x+10,before.y+before.height/2);assert.equal((await hover()).display,'none');
 });
 await test('text is edited in place: caret typing keeps nested markup, undo/redo, Enter saves, Esc cancels, clicking away commits',async({page,ui,button,clickText,editing,exportBundle})=>{
  await page.evaluate(()=>{window.siteKeys=0;for(const type of ['keydown','keyup','beforeinput','input'])document.addEventListener(type,()=>window.siteKeys++);});
  const headline=()=>page.locator('#headline').textContent();
  await ensure(button('Edit text'));await clickText('#headline');
  assert.equal(await ui.locator('textarea').count(),0,'no overlay textarea');assert.equal(await page.locator('#headline').getAttribute('contenteditable'),'plaintext-only');
  assert.equal(await ui.locator('.hover').textContent(),'Editing text');
  await page.keyboard.press('ControlOrMeta+A');await page.keyboard.press('ArrowLeft');await page.keyboard.type('A ');
  assert.equal(await headline(),'A Simple nested heading');assert.equal(await page.locator('#headline em').textContent(),'nested');
  await page.keyboard.press('Backspace');assert.equal(await headline(),'ASimple nested heading');
  await page.keyboard.press('ControlOrMeta+Z');assert.equal(await headline(),'A Simple nested heading');
  await page.keyboard.press('ControlOrMeta+Z');assert.equal(await headline(),'Simple nested heading');
  await page.keyboard.press('ControlOrMeta+Shift+Z');assert.equal(await headline(),'A Simple nested heading');
  // Select-all and delete stay inside the clicked text node.
  await page.keyboard.press('ControlOrMeta+A');await page.keyboard.press('Delete');assert.equal(await headline(),'nested heading');assert.equal(await page.locator('#headline em').count(),1);
  await page.keyboard.press('ControlOrMeta+Z');await page.keyboard.press('Enter');
  assert.equal(await editing(),0);assert.equal(await page.locator('#headline').getAttribute('contenteditable'),null);assert.equal(await headline(),'A Simple nested heading');
  assert.equal(await button('Edit text').getAttribute('aria-pressed'),'true','stays in edit mode');
  await clickText('#headline em');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('deeply nested');assert.equal(await page.locator('#headline em').textContent(),'deeply nested');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#headline em').textContent(),'nested');assert.equal(await editing(),0);assert.equal(await page.locator('#headline em').getAttribute('contenteditable'),null);
  await clickText('#plain');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('Committed by clicking away');
  await clickText('#pin1');assert.equal(await page.locator('#plain').getAttribute('contenteditable'),null);assert.equal(await page.locator('#pin1').getAttribute('contenteditable'),'plaintext-only');
  await page.keyboard.press('Escape');assert.equal(await editing(),0);
  assert.equal(await page.evaluate(()=>window.siteKeys),0,'site listeners never saw review typing');
  const bundle=await exportBundle();assert.deepEqual(bundle.edits.map(e=>[e.before,e.after]),[['Simple ','A Simple '],['Original paragraph for edit cycles.','Committed by clicking away']]);
  assert.ok(!bundle.markdown.includes('contenteditable'));assert.match(bundle.markdown,/- Original: `Simple`/);
 });
 await test('keyboard formatting: bold/italic/underline/strike wrap only the selection, survive re-editing, revert and export',async({page,ui,button,clickText,editing,exportBundle})=>{
  await page.evaluate(()=>{window.siteKeys=0;document.addEventListener('keydown',()=>window.siteKeys++);});
  const original=await page.locator('#plain').innerHTML();
  await ensure(button('Edit text'));await clickText('#plain');
  // "Original paragraph for edit cycles." -> select "paragraph" (offset 9..18)
  await page.keyboard.press('ControlOrMeta+A');await page.keyboard.press('ArrowLeft');for(let i=0;i<9;i++)await page.keyboard.press('ArrowRight');
  for(let i=0;i<9;i++)await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ControlOrMeta+B');
  assert.equal(await page.locator('#plain').innerHTML(),'Original <strong>paragraph</strong> for edit cycles.');
  await page.keyboard.press('ControlOrMeta+I');assert.equal(await page.locator('#plain').innerHTML(),'Original <strong><em>paragraph</em></strong> for edit cycles.');
  await page.keyboard.press('ControlOrMeta+I');await page.keyboard.press('ArrowRight');
  // Typing right after bold text continues bold; a collapsed toggle switches it off for what follows.
  await page.keyboard.type('s');await page.keyboard.press('ControlOrMeta+B');await page.keyboard.type('!');
  assert.equal(await page.locator('#plain').innerHTML(),'Original <strong>paragraphs</strong>! for edit cycles.');
  // One undo removes the coalesced typing run "s!".
  await page.keyboard.press('ControlOrMeta+Z');assert.equal(await page.locator('#plain').innerHTML(),'Original <strong>paragraph</strong> for edit cycles.');
  await page.keyboard.press('Enter');assert.equal(await editing(),0);
  // Re-edit by clicking inside the bold run, add underline + strike to "edit".
  await clickText('#plain strong');assert.equal(await page.locator('#plain').getAttribute('contenteditable'),'plaintext-only');
  await page.keyboard.press('ControlOrMeta+A');await page.keyboard.press('ArrowRight');for(let i=0;i<12;i++)await page.keyboard.press('ArrowLeft');for(let i=0;i<4;i++)await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ControlOrMeta+U');await page.keyboard.press('ControlOrMeta+Shift+X');await page.keyboard.press('Enter');
  assert.equal(await page.locator('#plain').innerHTML(),'Original <strong>paragraph</strong> for <u><s>edit</s></u> cycles.');
  assert.equal(await ui.locator('article .after strong').textContent(),'paragraph');
  const bundle=await exportBundle();assert.equal(bundle.edits.length,1);const e=bundle.edits[0];
  assert.equal(e.before,'Original paragraph for edit cycles.');assert.equal(e.after,'Original paragraph for edit cycles.');
  assert.deepEqual(e.formatting,[{start:9,end:18,marks:['bold']},{start:23,end:27,marks:['underline','strike']}]);
  assert.equal(e.afterHtml,'Original <strong>paragraph</strong> for <u><s>edit</s></u> cycles.');assert.match(bundle.markdown,/- Replace with formatting: `Original <strong>paragraph<\/strong> for <u><s>edit<\/s><\/u> cycles\.`/);
  assert.equal(await page.evaluate(()=>window.siteKeys),0);
  await ui.locator('article').getByRole('button',{name:'Revert',exact:true}).click();assert.equal(await page.locator('#plain').innerHTML(),original);
  assert.equal(await page.locator('#plain').evaluate(el=>el.childNodes.length),1);
 });
 await test('editing a button or link label in place never activates it',async({page,ui,button,clickText,editing})=>{
  const url=page.url();await ensure(button('Edit text'));
  await clickText('#button');assert.equal(await editing(),1);await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('Go now please');await page.keyboard.press('Enter');
  await clickText('#link');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('Read more');await page.keyboard.press('Shift+Enter');await page.keyboard.press('Backspace');await page.keyboard.press('Enter');
  assert.equal(await page.locator('#button').textContent(),'Go now please');assert.equal(await page.locator('#link').textContent(),'Read more');
  assert.equal(page.url(),url);assert.equal(await page.evaluate(()=>window.siteActions),0);assert.equal(await editing(),0);
  // Leaving edit mode gives the site its normal interaction back.
  await button('Edit text').click();assert.equal(await button('Edit text').getAttribute('aria-pressed'),'false');await page.locator('#button').click();assert.equal(await page.evaluate(()=>window.siteActions),1);
 });
 await test('remove tool hides a hovered section, restores it exactly, and exports the removal',async({page,ui,button,exportBundle,moveMouse})=>{
  await page.locator('#pin2').evaluate(el=>el.setAttribute('style','color: rgb(1, 2, 3)'));
  await ensure(button('Remove section'));assert.equal(await button('Remove section').getAttribute('aria-pressed'),'true');
  const b=await page.locator('#pin2').boundingBox();const next=await page.locator('#pin3').boundingBox();
  await moveMouse(b.x+10,b.y+b.height/2);
  assert.equal(await ui.locator('.hover').textContent(),'Remove p#pin2');assert.equal(await ui.locator('.hover').evaluate(el=>el.classList.contains('danger')),true);
  await page.mouse.click(b.x+10,b.y+b.height/2);
  assert.equal(await page.locator('#pin2').isVisible(),false);assert.ok((await page.locator('#pin3').boundingBox()).y<next.y,'content below moves up');
  const row=ui.locator('article').filter({hasText:'Removed p#pin2'});assert.equal(await row.locator('.itemtext').textContent(),'Second comment target');assert.match(await row.textContent(),/Second comment target/);
  assert.equal(await ui.locator('.pill .count').textContent(),'1');
  // A site button is removed without running its click handler; html/body are never removable.
  const bt=await page.locator('#button').boundingBox();await page.mouse.click(bt.x+5,bt.y+5);assert.equal(await page.evaluate(()=>window.siteActions),0);assert.equal(await page.locator('#button').isVisible(),false);
  const bundle=await exportBundle();assert.equal(bundle.removals.length,2);assert.equal(bundle.removals[0].element.id,'pin2');assert.equal(bundle.removals[0].previewState,'applied');
  assert.match(bundle.markdown,/### 1\. Remove section · suggested\n- Remove: `p#pin2`\n[\s\S]*- Text: `Second comment target`/);assert.match(bundle.markdown,/### 2\. Remove section · suggested\n- Remove: `button#button`/);
  assert.ok(!bundle.markdown.includes('editable original')&&!bundle.markdown.includes('Form original'),'never form values');assert.ok(bundle.markdown.length<6000,'bounded context only');
  await row.getByRole('button',{name:'Restore',exact:true}).click();assert.equal(await page.locator('#pin2').isVisible(),true);assert.equal(await page.locator('#pin2').getAttribute('style'),'color: rgb(1, 2, 3)');
  assert.equal((await exportBundle()).removals.length,1);assert.equal(await page.evaluate(()=>window.siteActions),0);
  await button('Close review').click();await button('Discard & close').click();assert.equal(await page.locator('#button').isVisible(),true);assert.equal(await page.locator('#button').getAttribute('style'),null);
 });
 await test('review UI never shifts page layout: editing keeps wrapping, closing leaves no trace',async({page,ui,button,moveMouse,frames})=>{
  await page.evaluate(()=>{const p=document.createElement('p');p.id='narrow';p.style.cssText='width:120px;border:1px solid';p.textContent='Supercalifragilisticexpialidocious words   with   spaces end';document.querySelector('#plain').before(p);});
  const layout=()=>page.evaluate(()=>JSON.stringify({s:[scrollX,scrollY,document.documentElement.scrollWidth,document.documentElement.scrollHeight],r:[...document.body.querySelectorAll('*')].map(el=>{const r=el.getBoundingClientRect();return[r.x,r.y,r.width,r.height].map(v=>v.toFixed(2)).join()})}));
  const base=await layout();const style=await page.locator('#narrow').getAttribute('style');
  await ensure(button('Edit text'));await moveMouse(60,200);assert.equal(await layout(),base,'edit mode');
  const p=await page.locator('#narrow').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el.firstChild);const q=r.getClientRects()[0];return{x:q.x+5,y:q.y+q.height/2};});
  await page.mouse.click(p.x,p.y);await frames();assert.equal(await page.locator('#narrow').getAttribute('contenteditable'),'plaintext-only');assert.equal(await layout(),base,'while editing');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#narrow').getAttribute('style'),style,'style restored exactly');assert.equal(await layout(),base,'after cancel');
  await ensure(button('Pin'));await page.mouse.click(300,140);await ui.locator('textarea').waitFor();await frames();assert.equal(await layout(),base,'pending pin');await page.keyboard.press('Escape');
  await button('Close review').click();await frames();assert.equal(await layout(),base,'after close');
 });
 await test('severity is one click per row, colors the pin, and sorts the digest',async({page,ui,button,clickText,edit,exportBundle})=>{
  for(let i=1;i<=2;i++){await ensure(button('Pin'));await clickText(`#pin${i}`);await ui.locator('textarea').fill(`Note ${i}`);await button('Save').click();}
  await edit('#plain','Edited copy');
  const row=ui.locator('article').filter({hasText:'Note 2'});assert.equal(await row.getByRole('button',{name:'Suggested',exact:true}).getAttribute('aria-pressed'),'true','defaults to suggested');
  await row.getByRole('button',{name:'Must fix',exact:true}).click();assert.equal(await row.getByRole('button',{name:'Must fix',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await ui.getByRole('button',{name:'Note 2: Note 2'}).evaluate(el=>el.classList.contains('sev-must')),true,'pin turns must-fix red');
  assert.equal(await ui.locator('textarea').count(),0,'severity click does not open the editor');
  await ui.locator('article').filter({hasText:'Text change'}).getByRole('button',{name:'Nit',exact:true}).click();
  const bundle=await exportBundle();assert.deepEqual([...bundle.comments.map(c=>c.severity),bundle.edits[0].severity],['suggested','must','nit']);
  assert.match(bundle.markdown,/### 1\. Comment · pin 2 · must fix\n[\s\S]*### 2\. Comment · pin 1 · suggested\n[\s\S]*### 3\. Text edit · nit\n/);
 });
 await test('single-key tools and Copy Markdown; keys never fire while typing in the site, a note or a text edit',async({page,ui,button,clickText,exportBundle,frames})=>{
  // The pressed tool's accessible name, or 'none' while browsing.
  const active=async()=>(await ui.locator('.mode[aria-pressed="true"]').count())?ui.locator('.mode[aria-pressed="true"]').getAttribute('aria-label'):'none';
  await page.mouse.move(5,5);
  await page.keyboard.press('p');assert.equal(await active(),'Pin');await page.keyboard.press('e');assert.equal(await active(),'Edit text');
  await page.keyboard.press('r');assert.equal(await active(),'Remove section');await page.keyboard.press('Escape');assert.equal(await active(),'none');
  await page.keyboard.press('p');await page.keyboard.press('p');assert.equal(await active(),'none','pressing the active tool key turns it off');
  await page.keyboard.press('e');assert.equal(await ui.locator('.mode[aria-pressed="true"] .kbd').textContent(),'Esc','active tool shows Esc');
  assert.equal(await button('Pin').locator('.kbd').textContent(),'P');await page.keyboard.press('Escape');
  // Typing in a site field while browsing stays with the site.
  await page.locator('#input').click();await page.locator('#input').evaluate(el=>el.setSelectionRange(el.value.length,el.value.length));await page.keyboard.type('pecr');assert.equal(await page.locator('#input').inputValue(),'editable originalpecr');assert.equal(await active(),'none');
  await page.locator('#input').evaluate(el=>el.blur());
  // Typing a note keeps its letters; an open draft also blocks tool keys.
  await page.keyboard.press('p');await clickText('#pin1');await page.keyboard.type('pre');assert.equal(await ui.locator('textarea').inputValue(),'pre');
  // The editor takes focus on the next frame; let that happen before moving focus away.
  await frames();
  await ui.locator('textarea').evaluate(el=>el.blur());await page.keyboard.press('e');assert.equal(await active(),'Pin','draft open: no tool switch');assert.equal(await ui.locator('textarea').inputValue(),'pre');
  await button('Save').click();
  // Typing in an inline text edit keeps its letters.
  await page.keyboard.press('e');await clickText('#plain');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('perc');await page.keyboard.press('Enter');
  assert.equal(await page.locator('#plain').textContent(),'perc');assert.equal(await active(),'Edit text');
  await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(page.url()).origin});
  await page.keyboard.press('Escape');await page.keyboard.press('c');await ui.getByRole('button',{name:'Copy Markdown'}).filter({hasText:'✓ Copied'}).waitFor();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());assert.match(copied,/^# Review: Stress fixture\n/);assert.match(copied,/- Note: pre\n/);assert.match(copied,/- Replace: `perc`/);
  await page.evaluate(()=>navigator.clipboard.writeText(''));await ui.getByRole('button',{name:'Copy Markdown'}).click();await page.waitForFunction(()=>navigator.clipboard.readText().then(t=>t.startsWith('# Review')));
  assert.equal((await exportBundle()).comments[0].text,'pre');
 });
 await test('Done appears after copy or download, hides when the review changes, and closes without a prompt',async({page,ui,button,clickText,edit,exportBundle,reloadClosed})=>{
  await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(page.url()).origin});
  const done=ui.getByRole('button',{name:'Close the review',exact:true});
  await edit('#plain','Shipped copy');assert.equal(await done.count(),0,'nothing delivered yet');
  await button('Copy Markdown').click();await done.waitFor();
  await ensure(button('Pin'));await clickText('#pin1');assert.equal(await done.count(),0,'hidden while a draft is open');
  await ui.locator('textarea').fill('Late note');await button('Save').click();assert.equal(await done.count(),0,'hidden after a change');
  await exportBundle();await done.waitFor();
  await ui.locator('article').filter({hasText:'Late note'}).getByRole('button',{name:'Nit',exact:true}).click();assert.equal(await done.count(),0,'severity change counts');
  await button('Copy Markdown').click();await done.waitFor();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/· nit\n- Note: Late note/);
  await done.click();
  assert.equal(await page.locator('[data-pagecrit-root]').count(),0,'closed without a discard prompt');assert.equal(await page.locator('#plain').textContent(),'Original paragraph for edit cycles.','page restored');
  await reloadClosed('draft cleared');
 });
 await test('no Copy or Download until there is feedback; deleting the last item hides them again',async({page,ui,button,clickText})=>{
  assert.equal(await ui.locator('footer').isHidden(),true);assert.equal(await button('Copy Markdown').count(),0);
  // The key is handled once press resolves, but a copy would finish asynchronously and nothing signals that none started: allow a short window.
  await page.keyboard.press('c');await page.waitForTimeout(300);assert.equal(await ui.locator('.notice').count(),0,'C does nothing on an empty review');
  await ensure(button('Pin'));await clickText('#pin1');await ui.locator('textarea').fill('First thought');await button('Save').click();
  assert.equal(await button('Copy Markdown').isVisible(),true);assert.equal(await button('Download review').isVisible(),true);
  await ui.locator('article').getByRole('button',{name:'Delete',exact:true}).click();assert.equal(await ui.locator('footer').isHidden(),true);
 });
 await test('blank comment rejected, cancel does not create a phantom note',async({ui,button,clickText,exportBundle})=>{
  await ensure(button('Pin'));await clickText('#pin1');await ui.locator('textarea').fill(' \n\t ');await button('Save').click();assert.match(await ui.locator('.notice').textContent(),/Add a note/);await button('Cancel').click();assert.equal((await exportBundle()).comments.length,0);
 });
 await test('Escape, switching mode, minimize all restore pending preview and keep saved edit',async({page,ui,button,clickText,edit,typeInline,editing,exportBundle})=>{
  await edit('#plain','Saved value');
  for(const action of ['escape','mode','minimize']){await ensure(button('Edit text'));await clickText('#plain');await typeInline(`Pending ${action}`);assert.equal(await page.locator('#plain').textContent(),`Pending ${action}`);assert.equal(await button('Download review').isEnabled(),false);
   if(action==='escape')await page.keyboard.press('Escape');if(action==='mode')await ensure(button('Pin'));if(action==='minimize'){await button('Minimize').click();await ui.getByRole('button',{name:/Open PageCrit/}).click();}
   assert.equal(await page.locator('#plain').textContent(),'Saved value');assert.equal(await editing(),0);assert.equal(await page.locator('#plain').getAttribute('contenteditable'),null);
  }assert.equal((await exportBundle()).edits[0].after,'Saved value');
 });
 await test('framework replacement while typing prevents save and cancel does not overwrite replacement',async({page,ui,button,clickText,typeInline,exportBundle})=>{
  await ensure(button('Edit text'));await clickText('#framework');await typeInline('User preview');await page.locator('#framework').evaluate(el=>el.textContent='New server content');await page.keyboard.insertText('Final proposed text');assert.equal(await page.locator('#framework').textContent(),'New server content');await button('Save').click();assert.match(await ui.locator('.notice').textContent(),/replaced or changed/);assert.equal(await page.locator('#framework').textContent(),'New server content');await button('Cancel').click();assert.equal((await exportBundle()).edits.length,0);
 });
 await test('form controls and site contenteditable cannot be rewritten',async({page,ui,button,editing})=>{
  await ensure(button('Edit text'));for(const selector of ['#disabled','#input','#textarea','#editable']){await page.locator(selector).scrollIntoViewIfNeeded();const b=await page.locator(selector).boundingBox();await page.mouse.click(b.x+10,b.y+b.height/2);assert.equal(await editing(),0,selector);await page.keyboard.insertText('typed');}
  assert.equal(await page.locator('#input').inputValue(),'editable original');assert.equal(await page.locator('#textarea').inputValue(),'Form original');assert.equal(await page.locator('#editable').textContent(),'Site editor original');
 });
 await test('review survives reload and same-tab navigation: pins, edits, removals and severity come back; discard clears the draft',async({page,ui,button,clickText,edit,exportBundle,tab,reloadClosed})=>{
  const first=page.url();
  await edit('#plain','Persisted edit');
  await ensure(button('Pin'));await clickText('#pin1');await ui.locator('textarea').fill('Persisted note');await button('Save').click();
  await ui.locator('article').filter({hasText:'Persisted note'}).getByRole('button',{name:'Must fix',exact:true}).click();
  await ensure(button('Remove section'));const r=await page.locator('#pin3').boundingBox();await page.mouse.click(r.x+5,r.y+5);
  // Each change saves the draft shortly after; reload once the last one (the removal) is in it.
  await eventually(async()=>assert.equal((await draft(tab))?.removals?.length,1));
  await page.reload();
  await ui.getByRole('status').filter({hasText:'Continuing your review on P1'}).waitFor();
  assert.equal(await page.locator('#plain').textContent(),'Persisted edit','edit re-applied');assert.equal(await page.locator('#pin3').isVisible(),false,'removal re-applied');
  const pin=ui.getByRole('button',{name:'Note 1: Persisted note'});await pin.waitFor();assert.equal(await pin.evaluate(el=>el.classList.contains('sev-must')),true);
  const p1=await page.locator('#pin1').boundingBox(),pinBox=await pin.boundingBox();assert.ok(Math.abs(pinBox.y+pinBox.height-(p1.y+p1.height*0.5))<30,'pin re-anchored to its element');
  assert.equal(await ui.locator('article').count(),3);
  await page.goto(new URL('/second-page',first).href);
  await ui.getByRole('status').filter({hasText:'Continuing your review on P2'}).waitFor();
  assert.equal(await ui.getByRole('button',{name:/^Note 1:/}).count(),0,'P1 pins hidden on P2');assert.equal(await page.locator('#plain').textContent(),'Original paragraph for edit cycles.','P1 edit not applied to P2');
  await ensure(button('Pin'));await clickText('#pin2');await ui.locator('textarea').fill('Second page note');await button('Save').click();
  const bundle=await exportBundle();
  assert.deepEqual(bundle.pages.map(p=>p.id),['P1','P2']);assert.equal(bundle.comments.length,2);assert.equal(bundle.edits.length,1);assert.equal(bundle.removals.length,1);
  assert.match(bundle.markdown,/Summary: 2 comments, 1 text edit, 1 removal across 2 pages/);assert.match(bundle.markdown,/### 1\. Comment · pin 1 · must fix\n- Note: Persisted note/);assert.match(bundle.markdown,/## P2 — \/second-page\n\n### 4\. Comment · pin 2 · suggested\n- Note: Second page note/);
  // Back to P1: its items reattach again.
  await page.goto(first);await ui.getByRole('status').filter({hasText:'Continuing your review on P1'}).waitFor();assert.equal(await page.locator('#plain').textContent(),'Persisted edit');
  await button('Close review').click();await button('Discard & close').click();
  assert.equal(await page.locator('#plain').textContent(),'Original paragraph for edit cycles.');
  await reloadClosed('discarded review does not come back');
 });

 await test('distinct text nodes within the same element retain separate before/after locators',async({page,ui,button,edit,exportBundle})=>{
  await edit('#headline','Leading replacement ');await edit('#headline',' final words',1);await edit('#headline em','emphasized');
  const bundle=await exportBundle();assert.equal(bundle.edits.length,3);assert.deepEqual(bundle.edits.slice(0,2).map(e=>e.locator.nodePath),[[0],[2]]);assert.equal(await page.locator('#headline').textContent(),'Leading replacement emphasized final words');
  await ui.locator('article').filter({hasText:'Leading replacement'}).getByRole('button',{name:'Revert',exact:true}).click();assert.equal(await page.locator('#headline').textContent(),'Simple emphasized final words');
 });
 await test('page-script clicks, input events and export actions cannot drive review UI',async({page,ui,button,clickText,typeInline,editing,exportBundle})=>{
  await button('Edit text').evaluate(el=>el.click());assert.equal(await button('Edit text').getAttribute('aria-pressed'),'false');
  await ensure(button('Edit text'));await clickText('#plain');await typeInline('Actual trusted edit');await page.locator('#plain').evaluate(el=>{for(const type of ['beforeinput','input'])el.dispatchEvent(new InputEvent(type,{bubbles:true,cancelable:true,composed:true,inputType:'insertText',data:'Forged'}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});assert.equal(await page.locator('#plain').textContent(),'Actual trusted edit');await button('Save').evaluate(el=>el.click());assert.equal(await editing(),1);await button('Save').click();assert.equal(await page.locator('#plain').textContent(),'Actual trusted edit');
  const before=await worker.evaluate(async()=>(await chrome.downloads.search({})).length);await button('Download review').evaluate(el=>el.click());
  // The forged click is handled synchronously; a download it started would appear asynchronously and nothing signals that none did: allow a short window.
  await page.waitForTimeout(300);assert.equal(await worker.evaluate(async()=>(await chrome.downloads.search({})).length),before);assert.equal((await exportBundle()).edits[0].after,'Actual trusted edit');
 });
 await test('actual clipboard paste remains plain text and preserves literal HTML',async({page,ui,button,clickText,exportBundle})=>{
  const pasted='Clipboard 🦆\n<strong>not markup</strong>\n"quotes" & apostrophe\'s';await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});await page.evaluate(text=>navigator.clipboard.writeText(text),pasted);await ensure(button('Edit text'));await clickText('#inline');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.press('ControlOrMeta+V');assert.equal(await page.locator('#inline').textContent(),pasted);await button('Save').click();assert.equal(await page.locator('#inline').textContent(),pasted);assert.equal(await page.locator('#inline strong').count(),0);assert.equal((await exportBundle()).edits[0].after,pasted);
 });

 await test('moving panel and canceling close preserves unsaved draft text',async({page,ui,button,clickText,typeInline,editing,exportBundle})=>{
  // Docked is the default; float the panel so its header can be dragged.
  if(await button('Dock as a sidebar').getAttribute('aria-pressed')==='true')await button('Dock as a sidebar').click();
  await ensure(button('Edit text'));await clickText('#plain');await typeInline('Keep this pending text');const h=await ui.locator('.header').boundingBox();await page.mouse.move(h.x+40,h.y+15);await page.mouse.down();await page.mouse.move(h.x-300,h.y+200,{steps:5});await page.mouse.up();assert.equal(await page.locator('#plain').textContent(),'Keep this pending text');await button('Snap to nearest corner').click();assert.equal(await editing(),1);await button('Close review').click();await button('Keep reviewing').click();assert.equal(await editing(),1);assert.equal(await page.locator('#plain').textContent(),'Keep this pending text');await button('Save').click();assert.equal((await exportBundle()).edits[0].after,'Keep this pending text');
 });

 await test('site removes overlay host; reinjection restores UI and preserves saved review',async({page,ui,button,clickText,edit,exportBundle,inject})=>{
  await edit('#plain','Saved before host removal');await ensure(button('Pin'));await clickText('#pin1');await ui.locator('textarea').fill('Keep this saved note');await button('Save').click();
  const prior=await exportBundle();await page.locator('[data-pagecrit-root]').evaluate(el=>el.remove());assert.equal(await page.locator('[data-pagecrit-root]').count(),0);await inject();await ui.getByRole('region',{name:'PageCrit review'}).waitFor();assert.equal(await page.locator('[data-pagecrit-root]').count(),1);const after=await exportBundle();assert.equal(after.session.id,prior.session.id);assert.equal(after.comments[0].id,prior.comments[0].id);assert.equal(after.comments[0].text,'Keep this saved note');assert.equal(after.edits[0].after,'Saved before host removal');assert.equal(await page.locator('#plain').textContent(),'Saved before host removal');
 });

 await test('real browser zoom at 125% and 200% preserves element pin geometry and text targeting',async({page,ui,button,clickText,edit,exportBundle,tab})=>{
  await worker.evaluate(async tab=>chrome.tabs.setZoomSettings(tab,{mode:'automatic',scope:'per-tab'}),tab);
  await ensure(button('Pin'));await clickText('#pin1');await ui.locator('textarea').fill('Zoom anchor');await button('Save').click();
  const initial=await exportBundle();const anchor=initial.comments[0].anchor;const startingDpr=await page.evaluate(()=>devicePixelRatio);
  const assertGeometry=async()=>{
   await page.locator('#pin1').scrollIntoViewIfNeeded();
   await eventually(async()=>{
    const expected=await page.locator('#pin1').evaluate((el,offset)=>{const r=el.getBoundingClientRect();return{x:r.left+r.width*offset.xRatio,y:r.top+r.height*offset.yRatio};},anchor.offset);
    const actual=await ui.getByRole('button',{name:'Note 1: Zoom anchor',includeHidden:true}).evaluate(el=>({x:parseFloat(el.style.left),y:parseFloat(el.style.top)}));
    assert.ok(Math.abs(expected.x-actual.x)<1,`zoom x ${JSON.stringify({expected,actual})}`);assert.ok(Math.abs(expected.y-actual.y)<1,`zoom y ${JSON.stringify({expected,actual})}`);
   });
   const bundle=await exportBundle();assert.equal(bundle.comments[0].anchorState,'resolved');assert.deepEqual(bundle.comments[0].anchor.document,anchor.document);
  };
  try {
   for(const zoom of [1.25,2]){
    await worker.evaluate(async({tab,zoom})=>chrome.tabs.setZoom(tab,zoom),{tab,zoom});assert.equal(await worker.evaluate(tab=>chrome.tabs.getZoom(tab),tab),zoom);await eventually(async()=>assert.ok(Math.abs((await page.evaluate(()=>devicePixelRatio))/startingDpr-zoom)<0.01,'Actual browser zoom changes devicePixelRatio'));
    await edit('#plain',`Zoom ${zoom} text`);assert.equal(await page.locator('#plain').textContent(),`Zoom ${zoom} text`);await assertGeometry();
    await page.setViewportSize({width:1160,height:940});await assertGeometry();await page.setViewportSize({width:1280,height:1000});
   }
  } finally {await worker.evaluate(async tab=>chrome.tabs.setZoom(tab,1),tab);}
  assert.equal(await worker.evaluate(tab=>chrome.tabs.getZoom(tab),tab),1);await assertGeometry();
 });
 await test('recent reviews: a link opens the list, a review opens in full, and reviews can be deleted or cleared',async({page,ui,button,edit,inject})=>{
  await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(page.url()).origin});
  await sw().evaluate(()=>chrome.storage.local.clear());
  const done=()=>ui.getByRole('button',{name:'Close the review',exact:true}).click();
  // Done shows only once the clipboard write has finished.
  const copyAndDone=async()=>{await button('Copy Markdown').click();await ui.getByRole('button',{name:'Close the review',exact:true}).waitFor();const text=await page.evaluate(()=>navigator.clipboard.readText());await done();return text;};
  await edit('#plain','Remember me <img src=x onerror="window.__pwned=1"> **not bold**');const copied=await copyAndDone();
  assert.match(copied,/^# Review: Stress fixture[\s\S]*Remember me/);
  await inject();await edit('#plain','Second review');await copyAndDone();
  await page.evaluate(()=>navigator.clipboard.writeText('something else'));
  await inject();const link=button('Recent reviews (2)');await link.waitFor();
  assert.equal(await ui.getByRole('region',{name:'Recent reviews'}).count(),0,'the list stays closed until asked for');
  await link.click();const list=ui.getByRole('region',{name:'Recent reviews'});await list.waitFor();
  const rows=list.locator('.recentitem');assert.equal(await rows.count(),2);
  assert.match(await rows.nth(1).textContent(),/Stress fixture127\.0\.0\.1 · 1\u00a0item · just now/);
  // Open the older review: rendered from its Markdown, page text staying text, with Copy and Download.
  await rows.nth(1).click();const open=ui.getByRole('region',{name:'Recent review'});const rendered=open.locator('.markdown');await rendered.filter({hasText:'Remember me'}).waitFor();
  assert.equal(await rendered.locator('img').count(),0,'quoted HTML is never markup');assert.equal(await page.evaluate(()=>window.__pwned),undefined);
  assert.match(await rendered.locator('code').filter({hasText:'Remember me'}).first().textContent(),/^Remember me <img src=x onerror="window\.__pwned=1"> \*\*not bold\*\*$/);
  assert.equal(await rendered.locator('h6').first().textContent(),'1. Text edit · suggested');assert.ok(!(await rendered.textContent()).includes('###'),'no Markdown syntax showing');
  await button('Copy this review').click();await open.getByText('✓ Copied').waitFor();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),copied);
  const before=await sw().evaluate(async()=>(await chrome.downloads.search({})).map(d=>d.id));
  await instrument();await button('Download this review').click();
  const d=await newDownload(before);
  assert.equal(await readFile(d.filename,'utf8'),copied);
  // Esc steps back to the list, then Delete removes one review.
  await page.keyboard.press('Escape');await list.waitFor();
  await list.getByRole('button',{name:'Delete Stress fixture'}).first().click();assert.equal(await list.locator('.recentitem').count(),2,'asks first');
  await list.getByRole('button',{name:'Confirm deleting Stress fixture'}).click();
  await list.locator('.recentitem').nth(1).waitFor({state:'detached'});
  assert.equal((await sw().evaluate(()=>chrome.storage.local.get('recent'))).recent.length,1);
  // Delete from an open review also asks in place.
  await list.locator('.recentitem').click();await button('Delete this review').click();await button('Confirm deleting this review').click();await list.waitFor();
  assert.equal((await sw().evaluate(()=>chrome.storage.local.get('recent'))).recent.length,0);
  await sw().evaluate(()=>chrome.storage.local.set({recent:[{id:'x',title:'Seeded',url:'https://example.com/',pages:1,items:1,savedAt:new Date().toISOString(),filename:'x.md',markdown:'# Review: Seeded'}]}));
  // Reopening the panel picks up reviews saved meanwhile (e.g. in another tab).
  await button('← Back').click();await inject();await button('Recent reviews (1)').click();
  await button('Clear recent reviews').click();await button('Confirm clearing recent reviews').click();
  await list.getByText('No recent reviews.').waitFor();assert.equal((await sw().evaluate(()=>chrome.storage.local.get(null))).recent,undefined);
  // Back returns to the empty review; tools still work from the list.
  await button('← Back').click();await ui.locator('.empty').filter({hasText:'Nothing marked up yet'}).waitFor();
  assert.equal(await ui.getByRole('button',{name:/^Recent reviews/}).count(),0,'no link once nothing is saved');
 });
 await test('two simultaneous tabs keep session IDs, comments, edits and closing independent',async(first)=>{
  let second;
  try {
   await first.edit('#plain','First tab draft');await ensure(first.button('Pin'));await first.clickText('#pin1');await first.ui.locator('textarea').fill('Only tab one');await first.button('Save').click();
   second=await setup();await second.edit('#plain','Second tab draft');await ensure(second.button('Pin'));await second.clickText('#pin2');await second.ui.locator('textarea').fill('Only tab two');await second.button('Save').click();
   const a=await first.exportBundle(),b=await second.exportBundle();assert.notEqual(a.session.id,b.session.id);assert.notEqual(a.comments[0].id,b.comments[0].id);assert.equal(a.comments.length,1);assert.equal(b.comments.length,1);assert.equal(a.comments[0].text,'Only tab one');assert.equal(b.comments[0].text,'Only tab two');assert.equal(a.edits[0].after,'First tab draft');assert.equal(b.edits[0].after,'Second tab draft');
   await first.button('Close review').click();await first.button('Discard & close').click();assert.equal(await first.page.locator('#plain').textContent(),'Original paragraph for edit cycles.');assert.equal(await second.page.locator('#plain').textContent(),'Second tab draft');const still=await second.exportBundle();assert.equal(still.session.id,b.session.id);assert.equal(still.comments[0].text,'Only tab two');
  } finally {if(second)await second.page.close({runBeforeUnload:false});}
 });
 console.log(`UI STRESS RESULT: ${checks} passed, ${failures.length} failed`);
 if(failures.length)throw new AggregateError(failures.map(f=>new Error(`${f.name}\n${f.error}`)),'UI stress regressions');
} finally {if(context)await context.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
