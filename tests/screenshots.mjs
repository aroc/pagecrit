// Opt-in screenshots in a real MV3 worker: the Settings switch, one marked screenshot per new pin,
// edit and removal (taken with the overlay hidden), and Download as a .zip folder.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,cp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
const ensure=async tool=>{if(await tool.getAttribute('aria-pressed')!=='true')await tool.click();};
const eventually=async(check,timeout=10000)=>{const end=Date.now()+timeout;for(;;){try{return await check();}catch(error){if(Date.now()>end)throw error;}await new Promise(r=>setTimeout(r,25));}};
const root=path.resolve(import.meta.dirname,'..');
const temp=await mkdtemp(path.join(tmpdir(),'pagecrit-shots-test-'));
const fixture=await readFile(path.join(root,'tests/fixture.html'));
const server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end(fixture);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
let context;
try {
 // Test copy only: <all_urls> stands in for the activeTab grant a real toolbar click gives,
 // which captureVisibleTab needs. The open shadow root lets Playwright find controls.
 const ext=path.join(temp,'extension');await cp(path.join(root,'extension'),ext,{recursive:true});
 const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions=['<all_urls>'];
 await writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));
 const source=await readFile(path.join(ext,'content.js'),'utf8');
 await writeFile(path.join(ext,'content.js'),source.replace("host.attachShadow({ mode: 'closed' })","host.attachShadow({ mode: 'open' })"));
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const page=await context.newPage();await page.goto(url);
 const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,url);
 await worker.evaluate(async tabId=>chrome.scripting.executeScript({target:{tabId},files:['core.js','content.js']}),tabId);
 const ui=page.locator('[data-pagecrit-root]');const button=name=>ui.getByRole('button',{name,exact:true});
 await ui.getByRole('region',{name:'PageCrit review'}).waitFor();

 // Off by default; the switch is remembered for later reviews.
 await button('Settings').click();
 const toggle=ui.getByRole('switch',{name:'Screenshots'});
 assert.equal(await toggle.getAttribute('aria-checked'),'false');
 await toggle.click();assert.equal(await toggle.getAttribute('aria-checked'),'true');
 await eventually(async()=>assert.equal((await worker.evaluate(()=>chrome.storage.local.get('settings'))).settings?.screenshots,true));
 await ui.getByRole('button',{name:'← Back'}).click();
 console.log('PASS settings: screenshots are off by default and the switch is saved');

 const card=await page.locator('.card').boundingBox();
 await ensure(button('Pin'));await page.mouse.click(card.x+12,card.y+12); // In the padding, so the card itself is pinned.
 await ui.locator('textarea').fill('More room around this card.');await button('Save').click();
 await ensure(button('Edit text'));
 const copy=await page.locator('#copy').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el.firstChild);const b=r.getClientRects()[0];return{x:b.x+20,y:b.y+b.height/2};});
 await page.mouse.click(copy.x,copy.y);await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('A calm place for your work.');await button('Save').click();
 await ensure(button('Remove section'));await page.locator('#cta').click();
 // The removed section disappears once its screenshot is taken.
 await eventually(async()=>assert.equal(await page.locator('#cta').isVisible(),false));
 await eventually(async()=>assert.equal((await worker.evaluate(async()=>(await chrome.storage.session.getKeys()).filter(key=>key.startsWith('clip:')))).length,3));

 // Download: a zip holding the review and three screenshots it links to.
 await mkdir(path.join(temp,'downloads'));
 const cdp=await context.newCDPSession(page);
 await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.join(temp,'downloads'),eventsEnabled:true});
 await worker.evaluate(()=>{const original=chrome.downloads.download.bind(chrome.downloads);chrome.downloads.download=opts=>{globalThis.requested=opts.filename;return original({...opts,saveAs:false});};});
 await button('Download review').click();
 const done=await eventually(async()=>{const d=await worker.evaluate(async()=>(await chrome.downloads.search({}))[0]);assert.equal(d?.state,'complete');return d;});
 const folder=(await worker.evaluate(()=>globalThis.requested)).replace(/\.zip$/,'');
 assert.match(folder,/^\d{4}-\d{2}-\d{2} \d{2}-\d{2} Fieldwork — synthetic test page$/);
 const out=path.join(temp,'unzipped');
 execFileSync('python3',['-c','import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',done.filename,out]);
 const markdown=await readFile(path.join(out,folder,'review.md'),'utf8');
 const shots=[...markdown.matchAll(/- Screenshot: (screenshots\/item-\d\.png)/g)].map(m=>m[1]);
 assert.deepEqual(shots.sort(),['screenshots/item-1.png','screenshots/item-2.png','screenshots/item-3.png']);
 assert.match(markdown,/### \d\. Comment · pin 1 · suggested\n- Note: More room around this card\.[\s\S]*?- Screenshot: screenshots\/item-\d\.png/);
 assert.match(markdown,/Screenshots show how an item looked when it was marked/);
 console.log('PASS download is a zip folder: review.md links one screenshot per item');

 // The pin's screenshot shows the page, not PageCrit: the card's own color right inside it (no
 // hover tint), and the blue outline just outside it.
 const pinShot=markdown.match(/### \d\. Comment[\s\S]*?- Screenshot: (screenshots\/item-\d\.png)/)[1];
 const png=(await readFile(path.join(out,folder,pinShot))).toString('base64');
 const viewer=await context.newPage();
 const pixels=await viewer.evaluate(async({png,card})=>{
   const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();
   const canvas=new OffscreenCanvas(img.width,img.height);const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
   // Same crop as the worker: 32px margin, at least 480×280, clipped to the 1280×900 viewport.
   const grow=(a,b,min)=>{const extra=Math.max(0,min-(b-a))/2;return[a-extra,b+extra];};
   let [left,right]=grow(card.x-32,card.x+card.width+32,480),[top]=grow(card.y-32,card.y+card.height+32,280);
   left=Math.max(0,left);top=Math.max(0,top);
   const at=(x,y)=>[...ctx.getImageData(Math.round(x-left),Math.round(y-top),1,1).data].slice(0,3);
   return {size:[img.width,img.height],inside:at(card.x+8,card.y+8),outline:at(card.x+card.width/2,card.y-4)};
 },{png,card});
 const near=(a,b,tolerance)=>a.every((v,i)=>Math.abs(v-b[i])<=tolerance);
 assert.ok(pixels.size[0]>=480&&pixels.size[1]>=280,`size ${pixels.size}`);
 assert.ok(near(pixels.inside,[229,234,219],6),`card color, no overlay: ${pixels.inside}`);
 assert.ok(near(pixels.outline,[47,75,224],60),`blue outline: ${pixels.outline}`);
 console.log('PASS screenshot shows the page without the overlay, outlined around the pinned element');

 // Closing the review drops its screenshots.
 await ui.getByRole('button',{name:'Close the review'}).click();
 await eventually(async()=>assert.equal((await worker.evaluate(async()=>(await chrome.storage.session.getKeys()).filter(key=>key.startsWith('clip:')))).length,0));
 console.log('PASS closing the review removes its screenshots');
} finally {
 if(context)await context.close();
 await new Promise(resolve=>server.close(resolve));
 await rm(temp,{recursive:true,force:true});
}
