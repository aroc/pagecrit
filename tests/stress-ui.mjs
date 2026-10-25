// Synthetic browser regression tests. The production UI remains closed-shadow.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,cp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
const root=path.resolve(import.meta.dirname,'..');
const temp=await mkdtemp(path.join(tmpdir(),'page-notes-stress-ui-'));
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
 context.setDefaultTimeout(5000);
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await mkdir(path.join(temp,'downloads'));
 await worker.evaluate(()=>{const download=chrome.downloads.download.bind(chrome.downloads);chrome.downloads.download=opts=>download({...opts,saveAs:false});});
 async function setup(){
  const page=await context.newPage();await page.goto(base+crypto.randomUUID());
  const tab=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,page.url());
  const inject=()=>worker.evaluate(async tabId=>chrome.scripting.executeScript({target:{tabId},files:['core.js','content.js']}),tab);
  await inject();const ui=page.locator('[data-page-notes-root]');await ui.getByRole('region',{name:'Page Notes review'}).waitFor();
  const cdp=await context.newCDPSession(page);await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.join(temp,'downloads'),eventsEnabled:true});
  const button=(name)=>ui.getByRole('button',{name,exact:true});
  const textPoint=async(selector,index=0)=>page.locator(selector).evaluate((el,index)=>{const n=[...el.childNodes].filter(n=>n.nodeType===3)[index];const r=document.createRange();r.selectNodeContents(n);const rect=r.getClientRects()[0];return{x:rect.x+Math.min(16,rect.width/2),y:rect.y+rect.height/2};},index);
  const clickText=async(selector,index=0)=>{await page.locator(selector).scrollIntoViewIfNeeded();const p=await textPoint(selector,index);await page.mouse.click(p.x,p.y);};
  // Replace the clicked text node in place: select-all is scoped to that node.
  const typeInline=async value=>{await page.keyboard.press('ControlOrMeta+A');if(value)await page.keyboard.insertText(value);else await page.keyboard.press('Backspace');};
  const editing=()=>page.locator('[contenteditable="plaintext-only"]').count();
  const edit=async(selector,value,index=0)=>{await button('Aa Edit text').click();await clickText(selector,index);await typeInline(value);await button('Save').click();};
  const exportBundle=async()=>{const before=await worker.evaluate(async()=>(await chrome.downloads.search({})).map(d=>d.id));await button('Done · Download review').click();await ui.getByRole('status').filter({hasText:'Download started'}).waitFor();let d;for(let i=0;i<40;i++){d=await worker.evaluate(async before=>(await chrome.downloads.search({})).find(d=>!before.includes(d.id)),before);if(d?.state==='complete')break;await page.waitForTimeout(75);}assert.equal(d?.state,'complete');return JSON.parse(await readFile(d.filename,'utf8'));};
  return{page,ui,button,clickText,edit,typeInline,editing,exportBundle,inject,tab};
 }
 async function test(name,run){let env;try{env=await setup();await run(env);checks++;console.log('PASS',name);}catch(e){failures.push({name,error:e.stack});console.error('FAIL',name,e.message);}finally{if(env)await env.page.close({runBeforeUnload:false});}}
 await test('12 edit/revert cycles restore exact baseline and original inline DOM',async({page,ui,button,edit,exportBundle})=>{
  const before=await page.locator('#headline').innerHTML();
  for(let i=0;i<12;i++){await edit('#headline',`Round ${i} `);assert.equal(await page.locator('#headline em').textContent(),'nested');await ui.locator('article').getByRole('button',{name:'Revert',exact:true}).click();assert.equal(await page.locator('#headline').innerHTML(),before);}
  const bundle=await exportBundle();assert.equal(bundle.edits.length,0);assert.equal(bundle.history.filter(x=>x.type==='text_edited').length,12);assert.equal(bundle.history.filter(x=>x.type==='text_reverted').length,12);
 });
 await test('multiline Unicode HTML-looking text is literal; clipboard-like paste retains exact text',async({page,ui,button,clickText,exportBundle})=>{
  const value='Line one\n日本語 café 🦆 e\u0301\n<img src=x onerror="window.siteActions=9"> & <b>literal</b>\nمرحبا';
  await button('Aa Edit text').click();await clickText('#inline');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText(value);await page.keyboard.press('ControlOrMeta+Enter');
  assert.equal(await page.locator('#inline').textContent(),value);assert.equal(await page.locator('#inline img,#inline b').count(),0);assert.equal(await page.evaluate(()=>window.siteActions),0);
  const bundle=await exportBundle();assert.equal(bundle.edits[0].after,value);assert.match(bundle.snapshots.editedHtml,/&lt;img/);
 });
 await test('repeated saves collapse ledger to one edit and original value removes it',async({page,ui,button,edit,exportBundle})=>{
  const original=await page.locator('#plain').textContent();for(let i=0;i<8;i++)await edit('#plain',`Version ${i}`);
  let bundle=await exportBundle();assert.equal(bundle.edits.length,1);assert.equal(bundle.edits[0].before,original);assert.equal(bundle.edits[0].after,'Version 7');
  await edit('#plain',original);bundle=await exportBundle();assert.equal(bundle.edits.length,0);assert.equal(bundle.history.filter(h=>h.type==='text_edited').length,9);
 });
 await test('comment update/remove renumbers pins without changing surviving identities',async({page,ui,button,clickText,exportBundle})=>{
  for(let i=1;i<=3;i++){await button('⊕ Pin').click();await clickText(`#pin${i}`);await ui.locator('textarea').fill(`Comment ${i}`);await button('Save').click();}
  const first=await exportBundle();const secondId=first.comments[1].id,thirdId=first.comments[2].id;
  await ui.locator('article').filter({hasText:'Comment 2'}).getByRole('button',{name:'Edit',exact:true}).click();await ui.locator('textarea').fill('Second revised 🦆');await button('Save').click();
  await ui.locator('article').filter({hasText:'Comment 1'}).getByRole('button',{name:'Remove',exact:true}).click();
  assert.equal(await ui.getByRole('button',{name:'Note 1: Second revised 🦆'}).count(),1);assert.equal(await ui.getByRole('button',{name:'Note 2: Comment 3'}).count(),1);
  const bundle=await exportBundle();assert.deepEqual(bundle.comments.map(c=>c.id),[secondId,thirdId]);assert.equal(bundle.comments[0].text,'Second revised 🦆');assert.equal(bundle.history.filter(h=>h.type==='comment_removed').length,1);
 });
 await test('pin to element outlines the hovered element in the overlay without shifting layout',async({page,ui,button})=>{
  await button('⊕ Pin').click();assert.equal(await button('Pin to element').getAttribute('aria-pressed'),'true');
  assert.deepEqual(await ui.getByRole('group',{name:'Pin position'}).getByRole('button').allTextContents(),['Pin to element','Pin to page']);
  const before=await page.locator('#pin1').boundingBox();const html=await page.locator('main').innerHTML();
  await page.mouse.move(before.x+10,before.y+before.height/2);await page.waitForTimeout(50);
  const hover=()=>ui.locator('.hover').evaluate(el=>({display:getComputedStyle(el).display,x:parseFloat(el.style.left),y:parseFloat(el.style.top),w:parseFloat(el.style.width),h:parseFloat(el.style.height),tag:el.textContent}));
  const box=await hover();assert.equal(box.display,'block');assert.equal(box.tag,'p#pin1');
  assert.ok(Math.abs(box.x-before.x)<1&&Math.abs(box.y-before.y)<1&&Math.abs(box.w-before.width)<1&&Math.abs(box.h-before.height)<1,JSON.stringify({box,before}));
  assert.deepEqual(await page.locator('#pin1').boundingBox(),before);assert.equal(await page.locator('main').innerHTML(),html);
  const next=await page.locator('#pin2').boundingBox();await page.mouse.move(next.x+10,next.y+next.height/2);await page.waitForTimeout(50);assert.equal((await hover()).tag,'p#pin2');
  await page.mouse.wheel(0,40);await page.waitForTimeout(80);const scrolled=await page.locator('#pin2').boundingBox();const after=await hover();assert.ok(after.tag!=='p#pin2'||Math.abs(after.y-scrolled.y)<1,'outline tracks scroll');
  await button('Pin to page').click();assert.equal(await button('Pin to page').getAttribute('aria-pressed'),'true');await page.mouse.move(next.x+12,next.y+next.height/2);await page.waitForTimeout(50);assert.equal((await hover()).display,'none','page pins do not outline elements');
  await button('Browse').click();await page.mouse.move(before.x+10,before.y+before.height/2);await page.waitForTimeout(50);assert.equal((await hover()).display,'none');
 });
 await test('pin to page follows the page content when the site scrolls a container instead of the window',async({page,ui,button,clickText,exportBundle})=>{
  // App-shell layout: the window never scrolls; body does.
  await page.evaluate(()=>{document.documentElement.style.cssText='height:100%;overflow:hidden';document.body.style.cssText='height:100%;overflow:auto';});
  await button('⊕ Pin').click();await button('Pin to page').click();await clickText('#pin2');await ui.locator('textarea').fill('Shell page pin');await button('Save').click();
  const pin=ui.getByRole('button',{name:'Note 1: Shell page pin',includeHidden:true});const top=()=>pin.evaluate(el=>parseFloat(el.style.top));
  const start=await top();assert.equal(await page.evaluate(()=>scrollY),0);
  await page.evaluate(()=>document.body.scrollTop+=120);await page.waitForTimeout(80);
  assert.ok(Math.abs(await top()-(start-120))<1.5,`moved with body scroll: ${start} -> ${await top()}`);
  await page.mouse.move(400,300);await page.mouse.wheel(0,60);await page.waitForTimeout(150);
  const scrolled=await page.evaluate(()=>document.body.scrollTop);assert.ok(Math.abs(await top()-(start-scrolled))<1.5,'moved with wheel scroll');
  await page.evaluate(()=>document.body.scrollTop=5000);await page.waitForTimeout(80);assert.equal(await pin.evaluate(el=>getComputedStyle(el).display),'none','hidden once scrolled out of the container');
  const bundle=await exportBundle();const anchor=bundle.comments[0].anchor;assert.equal(anchor.kind,'page');assert.equal(anchor.container.element.tag,'body');assert.equal(bundle.comments[0].anchorState,'resolved');
  const expected=await page.locator('#pin2').evaluate(el=>el.getBoundingClientRect().top+document.body.scrollTop);assert.ok(Math.abs(anchor.container.offset.y-expected)<30,JSON.stringify(anchor.container));
 });
 await test('clicking a placed pin highlights its note in the panel without opening the editor',async({page,ui,button,clickText})=>{
  for(let i=1;i<=3;i++){await button('⊕ Pin').click();await clickText(`#pin${i}`);await ui.locator('textarea').fill(`Comment ${i}`);await button('Save').click();}
  await button('Browse').click();await button('Minimize').click();
  await ui.getByRole('button',{name:'Note 2: Comment 2'}).click();
  assert.equal(await ui.locator('textarea').count(),0,'no editor opened');assert.equal(await ui.getByRole('region',{name:'Page Notes review'}).isVisible(),true,'panel expands');
  const selected=ui.locator('article[aria-current="true"]');assert.equal(await selected.count(),1);assert.match(await selected.textContent(),/Comment 2/);
  assert.equal(await ui.getByRole('button',{name:'Note 2: Comment 2'}).evaluate(el=>el.classList.contains('selected')),true);
  await ui.getByRole('button',{name:'Note 3: Comment 3'}).click();assert.match(await ui.locator('article[aria-current="true"]').textContent(),/Comment 3/);
  await selected.getByRole('button',{name:'Edit',exact:true}).click();assert.equal(await ui.locator('textarea').inputValue(),'Comment 3');
 });
 await test('panel and collapsed pill drag anywhere, may sit partly off screen, and snap to the nearest corner',async({page,ui,button})=>{
  const panel=ui.getByRole('region',{name:'Page Notes review'});const vw=1280,vh=1000;
  const dragBy=async(locator,dx,dy)=>{const b=await locator.boundingBox();const left=Math.max(b.x,0),right=Math.min(b.x+b.width,vw);const x=left+Math.min(20,(right-left)/2),y=b.y+Math.min(15,b.height/2);await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+3,y+3);await page.mouse.move(x+dx/2,y+dy/2,{steps:3});await page.mouse.move(x+dx,y+dy,{steps:3});await page.mouse.up();};
  const start=await panel.boundingBox();assert.ok(Math.abs(start.x+start.width-(vw-18))<1&&Math.abs(start.y-18)<1,'starts docked top-right');
  await dragBy(ui.locator('.header'),-500,240);let b=await panel.boundingBox();assert.ok(Math.abs(b.x-(start.x-500))<1&&Math.abs(b.y-(start.y+240))<1,JSON.stringify(b));
  // Partly off the right edge is allowed.
  await dragBy(ui.locator('.header'),600,0);b=await panel.boundingBox();assert.ok(b.x+b.width>vw+50&&b.x<vw-40,`clipped right ${JSON.stringify(b)}`);
  // Never lost entirely: enough remains to grab.
  await dragBy(ui.locator('.header'),2000,0);b=await panel.boundingBox();assert.ok(b.x<=vw-48+1,`still grabbable ${JSON.stringify(b)}`);
  await dragBy(ui.locator('.header'),-2000,-2000);b=await panel.boundingBox();assert.ok(b.y>=0&&b.x+b.width>=47,`top-left clamp ${JSON.stringify(b)}`);
  // Only the header buttons remain visible here; they still work as a drag handle without being clicked.
  await dragBy(ui.locator('.header'),300,600);await button('Snap to nearest corner').click();b=await panel.boundingBox();assert.ok(Math.abs(b.x-18)<1&&Math.abs(b.y+b.height-(vh-18))<1,`bottom-left ${JSON.stringify(b)}`);
  await button('Minimize').click();const pill=ui.getByRole('button',{name:/Page Notes ·/});let p=await pill.boundingBox();assert.ok(Math.abs(p.x-18)<1&&Math.abs(p.y+p.height-(vh-18))<1,'pill docked bottom-left');
  await dragBy(pill,400,-500);p=await pill.boundingBox();assert.ok(Math.abs(p.x-418)<1.5,`pill dragged ${JSON.stringify(p)}`);assert.equal(await panel.isVisible(),false,'dragging the pill does not expand it');
  await pill.click();assert.equal(await panel.isVisible(),true,'plain click expands');b=await panel.boundingBox();assert.ok(Math.abs(b.x-p.x)<1.5&&Math.abs(b.y-p.y)<1.5,'expands where the pill was');
  await dragBy(ui.locator('.header'),20,-400);await button('Snap to nearest corner').click();b=await panel.boundingBox();assert.ok(Math.abs(b.x-18)<1&&Math.abs(b.y-18)<1,`top-left ${JSON.stringify(b)}`);
  await dragBy(ui.locator('.header'),900,10);await button('Snap to nearest corner').click();b=await panel.boundingBox();assert.ok(Math.abs(b.x+b.width-(vw-18))<1&&Math.abs(b.y-18)<1,`top-right ${JSON.stringify(b)}`);
  assert.equal(await page.evaluate(()=>window.siteActions),0);assert.equal(await page.evaluate(()=>getSelection().toString()),'');
 });
 await test('text is edited in place: caret typing keeps nested markup, undo/redo, Enter saves, Esc cancels, clicking away commits',async({page,ui,button,clickText,editing,exportBundle})=>{
  await page.evaluate(()=>{window.siteKeys=0;for(const type of ['keydown','keyup','beforeinput','input'])document.addEventListener(type,()=>window.siteKeys++);});
  const headline=()=>page.locator('#headline').textContent();
  await button('Aa Edit text').click();await clickText('#headline');
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
  assert.equal(await button('Aa Edit text').getAttribute('aria-pressed'),'true','stays in edit mode');
  await clickText('#headline em');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('deeply nested');assert.equal(await page.locator('#headline em').textContent(),'deeply nested');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#headline em').textContent(),'nested');assert.equal(await editing(),0);assert.equal(await page.locator('#headline em').getAttribute('contenteditable'),null);
  await clickText('#plain');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('Committed by clicking away');
  await clickText('#pin1');assert.equal(await page.locator('#plain').getAttribute('contenteditable'),null);assert.equal(await page.locator('#pin1').getAttribute('contenteditable'),'plaintext-only');
  await page.keyboard.press('Escape');assert.equal(await editing(),0);
  assert.equal(await page.evaluate(()=>window.siteKeys),0,'site listeners never saw review typing');
  const bundle=await exportBundle();assert.deepEqual(bundle.edits.map(e=>[e.before,e.after]),[['Simple ','A Simple '],['Original paragraph for edit cycles.','Committed by clicking away']]);
  assert.ok(!bundle.snapshots.editedHtml.includes('contenteditable'));
 });
 await test('keyboard formatting: bold/italic/underline/strike wrap only the selection, survive re-editing, revert and export',async({page,ui,button,clickText,editing,exportBundle})=>{
  await page.evaluate(()=>{window.siteKeys=0;document.addEventListener('keydown',()=>window.siteKeys++);});
  const original=await page.locator('#plain').innerHTML();
  await button('Aa Edit text').click();await clickText('#plain');
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
  assert.equal(e.afterHtml,'Original <strong>paragraph</strong> for <u><s>edit</s></u> cycles.');assert.match(bundle.reviewMarkdown,/<strong>paragraph<\/strong>/);
  assert.match(bundle.snapshots.editedHtml,/<strong>paragraph<\/strong>/);assert.equal(await page.evaluate(()=>window.siteKeys),0);
  await ui.locator('article').getByRole('button',{name:'Revert',exact:true}).click();assert.equal(await page.locator('#plain').innerHTML(),original);
  assert.equal(await page.locator('#plain').evaluate(el=>el.childNodes.length),1);
 });
 await test('removing all formatting from an edit restores the original text node and drops the edit',async({page,ui,button,clickText,editing,exportBundle})=>{
  const node=await page.locator('#pin1').evaluateHandle(el=>el.firstChild);
  await button('Aa Edit text').click();await clickText('#pin1');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.press('ControlOrMeta+B');await page.keyboard.press('Enter');
  assert.equal(await page.locator('#pin1').innerHTML(),'<strong>First comment target</strong>');assert.equal((await exportBundle()).edits.length,1);
  await clickText('#pin1 strong');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.press('ControlOrMeta+B');await page.keyboard.press('Enter');
  assert.equal(await page.locator('#pin1').innerHTML(),'First comment target');assert.equal(await node.evaluate(n=>n.isConnected&&n.parentElement.id),'pin1','same text node is back');
  assert.equal((await exportBundle()).edits.length,0);
 });
 await test('editing a button or link label in place never activates it',async({page,ui,button,clickText,editing})=>{
  const url=page.url();await button('Aa Edit text').click();
  await clickText('#button');assert.equal(await editing(),1);await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('Go now please');await page.keyboard.press('Enter');
  await clickText('#link');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('Read more');await page.keyboard.press('Shift+Enter');await page.keyboard.press('Backspace');await page.keyboard.press('Enter');
  assert.equal(await page.locator('#button').textContent(),'Go now please');assert.equal(await page.locator('#link').textContent(),'Read more');
  assert.equal(page.url(),url);assert.equal(await page.evaluate(()=>window.siteActions),0);assert.equal(await editing(),0);
 });
 await test('download confirms on the button only, and clicking a review row scrolls to it',async({page,ui,button,clickText,edit,exportBundle})=>{
  await edit('#plain','Changed copy');await button('⊕ Pin').click();await clickText('#pin3');await ui.locator('textarea').fill('Far note');await button('Save').click();
  await exportBundle();assert.equal(await ui.locator('.notice').count(),0,'no lingering callout');assert.match(await ui.locator('.done').first().textContent(),/✓ Download started/);
  await page.waitForTimeout(2700);assert.equal(await ui.locator('.done').first().textContent(),'Done · Download review');
  assert.equal(await ui.getByRole('button',{name:'Show',exact:true}).count(),0,'no Show buttons');
  assert.equal(await ui.locator('.logo').textContent(),'📝');
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(100);
  await ui.locator('article').filter({hasText:'Far note'}).locator('.itemtext').click();await page.waitForTimeout(700);
  const r=await page.locator('#pin3').boundingBox();assert.ok(r.y>0&&r.y<1000,`scrolled to note ${JSON.stringify(r)}`);
  assert.equal(await ui.locator('article[aria-current="true"]').count(),1);assert.equal(await ui.locator('textarea').count(),0);
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(100);
  await ui.locator('article').filter({hasText:'Changed copy'}).focus();await page.keyboard.press('Enter');await page.waitForTimeout(700);
  const t=await page.locator('#plain').boundingBox();assert.ok(t.y>0&&t.y<1000,`scrolled to edit ${JSON.stringify(t)}`);assert.equal(await page.locator('[contenteditable]').count(),1,'only the site editor; no edit started');
 });
 await test('remove tool hides a hovered section, restores it exactly, and exports the removal',async({page,ui,button,exportBundle})=>{
  await page.locator('#pin2').evaluate(el=>el.setAttribute('style','color: rgb(1, 2, 3)'));
  await button('⊖ Remove').click();assert.equal(await button('⊖ Remove').getAttribute('aria-pressed'),'true');
  const b=await page.locator('#pin2').boundingBox();const next=await page.locator('#pin3').boundingBox();
  await page.mouse.move(b.x+10,b.y+b.height/2);await page.waitForTimeout(50);
  assert.equal(await ui.locator('.hover').textContent(),'Remove p#pin2');assert.equal(await ui.locator('.hover').evaluate(el=>el.classList.contains('danger')),true);
  await page.mouse.click(b.x+10,b.y+b.height/2);
  assert.equal(await page.locator('#pin2').isVisible(),false);assert.ok((await page.locator('#pin3').boundingBox()).y<next.y,'content below moves up');
  const row=ui.locator('article').filter({hasText:'Removed p#pin2'});assert.equal(await row.locator('.itemtext').textContent(),'Second comment target');assert.match(await row.textContent(),/Second comment target/);
  assert.match(await ui.getByRole('button',{name:/Page Notes ·/,includeHidden:true}).textContent(),/· 1/);
  // A site button is removed without running its click handler; html/body are never removable.
  const bt=await page.locator('#button').boundingBox();await page.mouse.click(bt.x+5,bt.y+5);assert.equal(await page.evaluate(()=>window.siteActions),0);assert.equal(await page.locator('#button').isVisible(),false);
  const bundle=await exportBundle();assert.equal(bundle.removals.length,2);assert.equal(bundle.removals[0].element.id,'pin2');assert.equal(bundle.removals[0].previewState,'applied');
  assert.match(bundle.snapshots.originalHtml,/Second comment target/);assert.ok(!bundle.snapshots.editedHtml.includes('Second comment target'),'edited snapshot omits removed section');assert.ok(!bundle.snapshots.editedHtml.includes('Do not submit this button'));
  assert.match(bundle.snapshots.editedHtml,/Third comment target/);assert.match(bundle.reviewMarkdown,/## Remove section 1/);
  await row.getByRole('button',{name:'Restore',exact:true}).click();assert.equal(await page.locator('#pin2').isVisible(),true);assert.equal(await page.locator('#pin2').getAttribute('style'),'color: rgb(1, 2, 3)');
  assert.equal((await exportBundle()).removals.length,1);assert.equal(await page.evaluate(()=>window.siteActions),0);
  await button('Close review').click();await button('Discard & close').click();assert.equal(await page.locator('#button').isVisible(),true);assert.equal(await page.locator('#button').getAttribute('style'),null);
 });
 await test('review UI never shifts page layout: editing keeps wrapping, closing leaves no trace',async({page,ui,button})=>{
  await page.evaluate(()=>{const p=document.createElement('p');p.id='narrow';p.style.cssText='width:120px;border:1px solid';p.textContent='Supercalifragilisticexpialidocious words   with   spaces end';document.querySelector('#plain').before(p);});
  const layout=()=>page.evaluate(()=>JSON.stringify({s:[scrollX,scrollY,document.documentElement.scrollWidth,document.documentElement.scrollHeight],r:[...document.body.querySelectorAll('*')].map(el=>{const r=el.getBoundingClientRect();return[r.x,r.y,r.width,r.height].map(v=>v.toFixed(2)).join()})}));
  const base=await layout();const style=await page.locator('#narrow').getAttribute('style');
  await button('Aa Edit text').click();await page.mouse.move(60,200);await page.waitForTimeout(80);assert.equal(await layout(),base,'edit mode');
  const p=await page.locator('#narrow').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el.firstChild);const q=r.getClientRects()[0];return{x:q.x+5,y:q.y+q.height/2};});
  await page.mouse.click(p.x,p.y);await page.waitForTimeout(80);assert.equal(await page.locator('#narrow').getAttribute('contenteditable'),'plaintext-only');assert.equal(await layout(),base,'while editing');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#narrow').getAttribute('style'),style,'style restored exactly');assert.equal(await layout(),base,'after cancel');
  await button('⊕ Pin').click();await page.mouse.click(300,140);await page.waitForTimeout(80);assert.equal(await layout(),base,'pending pin');await page.keyboard.press('Escape');
  await button('Close review').click();await page.waitForTimeout(80);assert.equal(await layout(),base,'after close');
 });
 await test('blank comment rejected, cancel does not create a phantom note',async({ui,button,clickText,exportBundle})=>{
  await button('⊕ Pin').click();await clickText('#pin1');await ui.locator('textarea').fill(' \n\t ');await button('Save').click();assert.match(await ui.locator('.notice').textContent(),/Add a note/);await button('Cancel').click();assert.equal((await exportBundle()).comments.length,0);
 });
 await test('Escape, switching mode, minimize all restore pending preview and keep saved edit',async({page,ui,button,clickText,edit,typeInline,editing,exportBundle})=>{
  await edit('#plain','Saved value');
  for(const action of ['escape','mode','minimize']){await button('Aa Edit text').click();await clickText('#plain');await typeInline(`Pending ${action}`);assert.equal(await page.locator('#plain').textContent(),`Pending ${action}`);assert.equal(await button('Done · Download review').isEnabled(),false);
   if(action==='escape')await page.keyboard.press('Escape');if(action==='mode')await button('⊕ Pin').click();if(action==='minimize'){await button('Minimize').click();await ui.getByRole('button',{name:/Page Notes ·/}).click();}
   assert.equal(await page.locator('#plain').textContent(),'Saved value');assert.equal(await editing(),0);assert.equal(await page.locator('#plain').getAttribute('contenteditable'),null);
  }assert.equal((await exportBundle()).edits[0].after,'Saved value');
 });
 await test('framework replacement while typing prevents save and cancel does not overwrite replacement',async({page,ui,button,clickText,typeInline,exportBundle})=>{
  await button('Aa Edit text').click();await clickText('#framework');await typeInline('User preview');await page.locator('#framework').evaluate(el=>el.textContent='New server content');await page.keyboard.insertText('Final proposed text');assert.equal(await page.locator('#framework').textContent(),'New server content');await button('Save').click();assert.match(await ui.locator('.notice').textContent(),/replaced or changed/);assert.equal(await page.locator('#framework').textContent(),'New server content');await button('Cancel').click();assert.equal((await exportBundle()).edits.length,0);
 });
 await test('framework replacement after save retains requested edit; revert leaves new live content',async({page,ui,edit,exportBundle})=>{
  await edit('#framework','Desired change');await page.locator('#framework').evaluate(el=>el.outerHTML='<p id="framework">Replacement element</p>');const bundle=await exportBundle();assert.equal(bundle.edits[0].previewState,'page-changed');assert.equal(bundle.edits[0].before,'Framework initial value');assert.equal(bundle.edits[0].after,'Desired change');await ui.locator('article').getByRole('button',{name:'Revert',exact:true}).click();assert.equal(await page.locator('#framework').textContent(),'Replacement element');assert.equal((await exportBundle()).edits.length,0);
 });
 await test('edit mode blocks links and button actions, browse restores normal interaction',async({page,ui,button,clickText,edit})=>{
  const url=page.url();await edit('#link','Changed link label');await edit('#button','Changed action label');assert.equal(page.url(),url);assert.equal(await page.evaluate(()=>window.siteActions),0);await button('Browse').click();await page.locator('#button').click();assert.equal(await page.evaluate(()=>window.siteActions),1);
 });
 await test('form controls and site contenteditable cannot be rewritten',async({page,ui,button,editing})=>{
  await button('Aa Edit text').click();for(const selector of ['#disabled','#input','#textarea','#editable']){await page.locator(selector).scrollIntoViewIfNeeded();const b=await page.locator(selector).boundingBox();await page.mouse.click(b.x+10,b.y+b.height/2);assert.equal(await editing(),0,selector);await page.keyboard.insertText('typed');}
  assert.equal(await page.locator('#input').inputValue(),'editable original');assert.equal(await page.locator('#textarea').inputValue(),'Form original');assert.equal(await page.locator('#editable').textContent(),'Site editor original');
 });
 await test('SPA route change warns; discard and restart captures new route as baseline',async({page,ui,button,edit,exportBundle,inject})=>{
  const initial=page.url();await edit('#plain','Old route requested value');await page.evaluate(()=>{history.pushState({},'','/new-route');document.title='New route title';document.querySelector('#plain').textContent='New route paragraph';});await ui.getByRole('status').filter({hasText:'navigated within'}).waitFor();const bundle=await exportBundle();assert.equal(bundle.page.url,initial);assert.ok(bundle.warnings.some(w=>w.includes('URL changed')));assert.equal(bundle.edits[0].previewState,'page-changed');await button('Close review').click();await button('Discard & close').click();await inject();const fresh=await exportBundle();assert.equal(fresh.page.url,new URL('/new-route',initial).href);assert.equal(fresh.page.title,'New route title');assert.equal(fresh.edits.length,0);assert.match(fresh.snapshots.originalHtml,/New route paragraph/);
 });
 await test('small viewport controls remain reachable when the note editor and review list are tall',async({page,ui,button,clickText})=>{
  await page.setViewportSize({width:390,height:500});const h=await ui.locator('.header').boundingBox();await page.mouse.move(h.x+40,h.y+15);await page.mouse.down();await page.mouse.move(h.x-60,h.y+120,{steps:5});await page.mouse.up();await button('Snap to nearest corner').click();await button('Minimize').click();await page.locator('#deep').scrollIntoViewIfNeeded();await ui.getByRole('button',{name:/Page Notes ·/}).click();
  for(const name of ['Aa Edit text','⊕ Pin','Browse','Done · Download review','Close review']){assert.equal(await button(name).isVisible(),true,name);const b=await button(name).boundingBox();assert.ok(b.x>=0&&b.x+b.width<=391&&b.y>=0&&b.y+b.height<=501,`${name}: ${JSON.stringify(b)}`);}
  await button('⊕ Pin').click();await page.mouse.click(370,300);await ui.locator('textarea').fill('Long note\n'.repeat(80));await button('Save').click();assert.match(await ui.locator('article').textContent(),/Long note/);const footer=await button('Done · Download review').boundingBox();assert.ok(footer.y+footer.height<=501);
 });

 await test('distinct text nodes within the same element retain separate before/after locators',async({page,ui,button,edit,exportBundle})=>{
  await edit('#headline','Leading replacement ');await edit('#headline',' final words',1);await edit('#headline em','emphasized');
  const bundle=await exportBundle();assert.equal(bundle.edits.length,3);assert.deepEqual(bundle.edits.slice(0,2).map(e=>e.locator.nodePath),[[0],[2]]);assert.equal(await page.locator('#headline').textContent(),'Leading replacement emphasized final words');
  await ui.locator('article').filter({hasText:'Leading replacement'}).getByRole('button',{name:'Revert',exact:true}).click();assert.equal(await page.locator('#headline').textContent(),'Simple emphasized final words');
 });
 await test('empty replacement remains editable through review and cancel restores it as empty',async({page,ui,button,edit,exportBundle})=>{
  await edit('#plain','');assert.equal(await page.locator('#plain').evaluate(el=>el.childNodes.length),1,'emptied text node is kept');const row=ui.locator('article').filter({hasText:'Original paragraph for edit cycles.'});await row.getByRole('button',{name:'Edit',exact:true}).click();await page.keyboard.insertText('Uncommitted restoration');assert.equal(await page.locator('#plain').textContent(),'Uncommitted restoration');await button('Cancel').click();assert.equal(await page.locator('#plain').textContent(),'');assert.equal((await exportBundle()).edits[0].after,'');await row.getByRole('button',{name:'Revert',exact:true}).click();assert.equal(await page.locator('#plain').textContent(),'Original paragraph for edit cycles.');
 });
 await test('page-script clicks, input events and export actions cannot drive review UI',async({page,ui,button,clickText,typeInline,editing,exportBundle})=>{
  await button('Aa Edit text').evaluate(el=>el.click());assert.equal(await button('Browse').getAttribute('aria-pressed'),'true');
  await button('Aa Edit text').click();await clickText('#plain');await typeInline('Actual trusted edit');await page.locator('#plain').evaluate(el=>{for(const type of ['beforeinput','input'])el.dispatchEvent(new InputEvent(type,{bubbles:true,cancelable:true,composed:true,inputType:'insertText',data:'Forged'}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});assert.equal(await page.locator('#plain').textContent(),'Actual trusted edit');await button('Save').evaluate(el=>el.click());assert.equal(await editing(),1);await button('Save').click();assert.equal(await page.locator('#plain').textContent(),'Actual trusted edit');
  const before=await worker.evaluate(async()=>(await chrome.downloads.search({})).length);await button('Done · Download review').evaluate(el=>el.click());await page.waitForTimeout(100);assert.equal(await worker.evaluate(async()=>(await chrome.downloads.search({})).length),before);assert.equal((await exportBundle()).edits[0].after,'Actual trusted edit');
 });
 await test('actual clipboard paste remains plain text and preserves literal HTML',async({page,ui,button,clickText,exportBundle})=>{
  const pasted='Clipboard 🦆\n<strong>not markup</strong>\n"quotes" & apostrophe\'s';await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});await page.evaluate(text=>navigator.clipboard.writeText(text),pasted);await button('Aa Edit text').click();await clickText('#inline');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.press('ControlOrMeta+V');assert.equal(await page.locator('#inline').textContent(),pasted);await button('Save').click();assert.equal(await page.locator('#inline').textContent(),pasted);assert.equal(await page.locator('#inline strong').count(),0);assert.equal((await exportBundle()).edits[0].after,pasted);
 });

 await test('moving panel and canceling close preserves unsaved draft text',async({page,ui,button,clickText,typeInline,editing,exportBundle})=>{
  await button('Aa Edit text').click();await clickText('#plain');await typeInline('Keep this pending text');const h=await ui.locator('.header').boundingBox();await page.mouse.move(h.x+40,h.y+15);await page.mouse.down();await page.mouse.move(h.x-300,h.y+200,{steps:5});await page.mouse.up();assert.equal(await page.locator('#plain').textContent(),'Keep this pending text');await button('Snap to nearest corner').click();assert.equal(await editing(),1);await button('Close review').click();await button('Keep reviewing').click();assert.equal(await editing(),1);assert.equal(await page.locator('#plain').textContent(),'Keep this pending text');await button('Save').click();assert.equal((await exportBundle()).edits[0].after,'Keep this pending text');
 });

 await test('site removes overlay host; reinjection restores UI and preserves saved review',async({page,ui,button,clickText,edit,exportBundle,inject})=>{
  await edit('#plain','Saved before host removal');await button('⊕ Pin').click();await clickText('#pin1');await ui.locator('textarea').fill('Keep this saved note');await button('Save').click();
  const prior=await exportBundle();await page.locator('[data-page-notes-root]').evaluate(el=>el.remove());assert.equal(await page.locator('[data-page-notes-root]').count(),0);await inject();await ui.getByRole('region',{name:'Page Notes review'}).waitFor();assert.equal(await page.locator('[data-page-notes-root]').count(),1);const after=await exportBundle();assert.equal(after.session.id,prior.session.id);assert.equal(after.comments[0].id,prior.comments[0].id);assert.equal(after.comments[0].text,'Keep this saved note');assert.equal(after.edits[0].after,'Saved before host removal');assert.equal(await page.locator('#plain').textContent(),'Saved before host removal');
 });

 await test('real browser zoom at 125%, 150%, 200% preserves element pin geometry and text targeting',async({page,ui,button,clickText,edit,exportBundle,tab})=>{
  await worker.evaluate(async tab=>chrome.tabs.setZoomSettings(tab,{mode:'automatic',scope:'per-tab'}),tab);
  await button('⊕ Pin').click();await clickText('#pin1');await ui.locator('textarea').fill('Zoom anchor');await button('Save').click();
  const initial=await exportBundle();const anchor=initial.comments[0].anchor;const startingDpr=await page.evaluate(()=>devicePixelRatio);
  const assertGeometry=async()=>{
   await page.locator('#pin1').scrollIntoViewIfNeeded();await page.waitForTimeout(100);
   const expected=await page.locator('#pin1').evaluate((el,offset)=>{const r=el.getBoundingClientRect();return{x:r.left+r.width*offset.xRatio,y:r.top+r.height*offset.yRatio};},anchor.offset);
   const actual=await ui.getByRole('button',{name:'Note 1: Zoom anchor',includeHidden:true}).evaluate(el=>({x:parseFloat(el.style.left),y:parseFloat(el.style.top)}));
   assert.ok(Math.abs(expected.x-actual.x)<1,`zoom x ${JSON.stringify({expected,actual})}`);assert.ok(Math.abs(expected.y-actual.y)<1,`zoom y ${JSON.stringify({expected,actual})}`);
   const bundle=await exportBundle();assert.ok(Math.abs(bundle.comments[0].exportPosition.x-expected.x)<1);assert.ok(Math.abs(bundle.comments[0].exportPosition.y-expected.y)<1);assert.deepEqual(bundle.comments[0].anchor.document,anchor.document);
  };
  try {
   for(const zoom of [1.25,1.5,2]){
    await worker.evaluate(async({tab,zoom})=>chrome.tabs.setZoom(tab,zoom),{tab,zoom});assert.equal(await worker.evaluate(tab=>chrome.tabs.getZoom(tab),tab),zoom);await page.waitForTimeout(100);assert.ok(Math.abs((await page.evaluate(()=>devicePixelRatio))/startingDpr-zoom)<0.01,'Actual browser zoom changes devicePixelRatio');
    await edit('#plain',`Zoom ${zoom} text`);assert.equal(await page.locator('#plain').textContent(),`Zoom ${zoom} text`);await assertGeometry();
    await page.setViewportSize({width:1160,height:940});await assertGeometry();await page.setViewportSize({width:1280,height:1000});
   }
  } finally {await worker.evaluate(async tab=>chrome.tabs.setZoom(tab,1),tab);}
  assert.equal(await worker.evaluate(tab=>chrome.tabs.getZoom(tab),tab),1);await assertGeometry();
 });
 await test('two simultaneous tabs keep session IDs, comments, edits and closing independent',async(first)=>{
  let second;
  try {
   await first.edit('#plain','First tab draft');await first.button('⊕ Pin').click();await first.clickText('#pin1');await first.ui.locator('textarea').fill('Only tab one');await first.button('Save').click();
   second=await setup();await second.edit('#plain','Second tab draft');await second.button('⊕ Pin').click();await second.clickText('#pin2');await second.ui.locator('textarea').fill('Only tab two');await second.button('Save').click();
   const a=await first.exportBundle(),b=await second.exportBundle();assert.notEqual(a.session.id,b.session.id);assert.notEqual(a.comments[0].id,b.comments[0].id);assert.equal(a.comments.length,1);assert.equal(b.comments.length,1);assert.equal(a.comments[0].text,'Only tab one');assert.equal(b.comments[0].text,'Only tab two');assert.equal(a.edits[0].after,'First tab draft');assert.equal(b.edits[0].after,'Second tab draft');
   await first.button('Close review').click();await first.button('Discard & close').click();assert.equal(await first.page.locator('#plain').textContent(),'Original paragraph for edit cycles.');assert.equal(await second.page.locator('#plain').textContent(),'Second tab draft');const still=await second.exportBundle();assert.equal(still.session.id,b.session.id);assert.equal(still.comments[0].text,'Only tab two');
  } finally {if(second)await second.page.close({runBeforeUnload:false});}
 });
 console.log(`UI STRESS RESULT: ${checks} passed, ${failures.length} failed`);
 if(failures.length)throw new AggregateError(failures.map(f=>new Error(`${f.name}\n${f.error}`)),'UI stress regressions');
} finally {if(context)await context.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
