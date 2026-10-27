// The pagecrit.dev demo build (site/embed/pagecrit.js) on a synthetic page, with no extension:
// edit, pin, copy, download, a draft that survives reload, and closing the review clearing it.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {bundle} from '../scripts/embed.mjs';
// Retry a check until it passes: wait on the condition itself, never a fixed delay.
const eventually=async(check,timeout=10000)=>{const end=Date.now()+timeout;for(;;){try{return await check();}catch(error){if(Date.now()>end)throw error;}await new Promise(r=>setTimeout(r,25));}};
const ensure=async tool=>{if(await tool.getAttribute('aria-pressed')!=='true')await tool.click();};
const root=path.resolve(import.meta.dirname,'..');
const fixture=(await readFile(path.join(root,'tests/fixture.html'),'utf8')).replace('</body>','<script src="/embed/pagecrit.js"></script></body>');
// Open only this test copy's shadow root so Playwright can find controls. Production is closed.
const script=bundle().replace("host.attachShadow({ mode: 'closed' })","host.attachShadow({ mode: 'open' })");
const font=await readFile(path.join(root,'site/fonts/caveat-latin.woff2'));
const server=http.createServer((req,res)=>{
 if(req.url==='/embed/pagecrit.js'){res.setHeader('content-type','text/javascript');res.end(script);}
 else if(req.url==='/fonts/caveat-latin.woff2'){res.setHeader('content-type','font/woff2');res.end(font);}
 else {res.setHeader('content-type','text/html');res.end(fixture);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({channel:'chromium'});
try {
 const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(url).origin});
 const page=await context.newPage();await page.goto(url);
 assert.equal(await page.evaluate(()=>PageCrit.open()),true);
 const ui=page.locator('[data-pagecrit-root]');await ui.getByRole('region',{name:'PageCrit review'}).waitFor();
 assert.equal(await page.evaluate(()=>PageCrit.open()),true);assert.equal(await ui.count(),1);
 const button=name=>ui.getByRole('button',{name,exact:true});
 await ensure(button('Edit text'));
 const start=await page.locator('#headline').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el.firstChild);const rect=r.getClientRects()[0];return{x:rect.x+20,y:rect.y+rect.height/2};});
 await page.mouse.click(start.x,start.y);
 await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('Make room for ');await button('Save').click();
 await ensure(button('Pin'));await page.locator('#cta').click();
 await ui.locator('textarea').fill('Say what happens next.');await button('Save').click();
 assert.equal(await page.evaluate(()=>window.accidentalClicks),0);
 await button('Copy Markdown').click();
 await button('Copy Markdown').filter({hasText:'Copied'}).waitFor().catch(()=>{});
 const markdown=await page.evaluate(()=>navigator.clipboard.readText());
 assert.match(markdown,/^# Review: Fieldwork — synthetic test page\n/);
 assert.match(markdown,/- Replace: `Make room for`/);assert.match(markdown,/- Note: Say what happens next\./);
 const [download]=await Promise.all([page.waitForEvent('download'),button('Download review').click()]);
 assert.match(download.suggestedFilename(),/^\d{4}-\d{2}-\d{2} \d{2}-\d{2} Fieldwork — synthetic test page\.md$/);
 // The same review; only its export time moves on.
 const sameReview=text=>text.replace(/ · Exported: [^\n]*/,'');
 assert.equal(sameReview(await readFile(await download.path(),'utf8')),sameReview(markdown));
 console.log('PASS demo build: edit, pin, copy and download with no extension; page clicks blocked');
 // The draft is in this tab's sessionStorage: reopening after a reload continues the review.
 // Drafts save just after the last change, so wait for that before reloading.
 await eventually(async()=>assert.match(await page.evaluate(()=>sessionStorage.getItem('pagecrit:draft'))||'',/Say what happens next/));
 await page.reload();await page.evaluate(()=>PageCrit.open());
 await ui.getByText('Continuing your review').waitFor();
 assert.equal(await page.locator('#headline').textContent(),'Make room for better work.');
 assert.ok(await ui.getByText('Say what happens next.').count());
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pagecrit:recent')).length),1);
 await button('Close review').click();await button('Discard & close').click();await ui.waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('pagecrit:draft')),null);
 assert.equal(await page.locator('#headline').textContent(),'Make space for better work.');
 console.log('PASS demo build: draft survives reload, recent review kept, closing restores the page and clears the draft');
 // Docked as a sidebar: the page moves over by the sidebar's width and gets it back when minimized
 // or closed; the width (dragged or by keyboard) is kept for the next review.
 await page.evaluate(()=>{document.documentElement.style.setProperty('margin-right','3px');PageCrit.open();});
 await button('Dock as a sidebar').click();
 const margin=()=>page.evaluate(()=>document.documentElement.style.marginRight);
 assert.equal(await margin(),'360px');
 const panelBox=async()=>ui.getByRole('region',{name:'PageCrit review'}).boundingBox();
 assert.deepEqual(await panelBox().then(b=>[b.x+b.width,b.y,b.height,b.width]),[1280,0,900,360]);
 const edge=ui.getByRole('separator',{name:'Resize sidebar'});const at=await edge.boundingBox();
 await page.mouse.move(at.x+3,400);await page.mouse.down();await page.mouse.move(at.x-60,400,{steps:4});await page.mouse.up();
 const dragged=parseInt(await margin());assert.ok(Math.abs(dragged-420)<=2,`dragged to ${dragged}px`);
 await edge.focus();await page.keyboard.press('ArrowRight');assert.equal(await margin(),`${dragged-20}px`);
 for(let i=0;i<20;i++)await page.keyboard.press('ArrowRight');assert.equal(await margin(),'300px','no narrower than 300px');
 await button('Minimize').click();assert.equal(await margin(),'3px','minimized: the page gets its width back');
 await ui.locator('.pill').click();assert.equal(await margin(),'300px');
 await button('Close review').click();await ui.waitFor({state:'detached'});
 assert.equal(await margin(),'3px','closing restores the page');
 await page.evaluate(()=>PageCrit.open());assert.equal(await margin(),'300px','the next review opens docked at the same width');
 await button('Float the panel').click();assert.equal(await margin(),'3px');
 assert.deepEqual(JSON.parse(await page.evaluate(()=>localStorage.getItem('pagecrit:layout'))),{sidebar:false,width:300});
 console.log('PASS sidebar: docks and moves the page over, resizes in range, minimizing or closing restores the page, layout remembered');
} finally {
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
