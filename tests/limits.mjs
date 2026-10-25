// Regression for recoverable oversized exports and bounded long-running history.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,cp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
const root=path.resolve(import.meta.dirname,'..'), temp=await mkdtemp(path.join(tmpdir(),'page-notes-limits-'));
const server=http.createServer((req,res)=>res.end('<!doctype html><title>Limits</title><h1>Review this page</h1><p>Keep this feedback</p>'+(req.url.includes('large')?'<div hidden>'+'x'.repeat(11*1024*1024)+'</div>':'')));
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/`;
let context;
try {
 const ext=path.join(temp,'extension');await cp(path.join(root,'extension'),ext,{recursive:true});
 const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*'];await writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));
 let source=await readFile(path.join(ext,'content.js'),'utf8');
 source=source.replace("host.attachShadow({ mode: 'closed' })","host.attachShadow({ mode: 'open' })");
 // Test-only instrumentation of the isolated world to exercise a long review without 6,000 UI clicks.
 source=source.replace('  render();\n})();','  globalThis.testHistory = {record, state};\n  render();\n})();');
 await writeFile(path.join(ext,'content.js'),source);
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,viewport:{width:1200,height:900},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
 context.setDefaultTimeout(5000);const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker.evaluate(()=>{const original=chrome.downloads.download.bind(chrome.downloads);chrome.downloads.download=opts=>original({...opts,saveAs:false});});
 const page=await context.newPage();await page.goto(base);
 const tab=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,page.url());
 const inject=()=>worker.evaluate(async tabId=>chrome.scripting.executeScript({target:{tabId},files:['core.js','content.js']}),tab);
 await inject();const ui=page.locator('[data-page-notes-root]');
 async function addNote(){await ui.getByRole('button',{name:'⊕ Pin',exact:true}).click();await page.mouse.click(40,35);await ui.locator('textarea').fill('A note that must survive export problems.');await ui.getByRole('button',{name:'Save',exact:true}).click();}
 await addNote();
 const result=await worker.evaluate(async tabId=>(await chrome.scripting.executeScript({target:{tabId},func:()=>{const t=globalThis.testHistory;for(let i=0;i<6000;i++)t.record('text_edited',{before:'a'.repeat(1000),after:'b'.repeat(1000),i});return{length:t.state.history.length,bytes:t.state.historyBytes,omitted:t.state.historyOmitted,comments:t.state.comments.length};}}))[0].result,tab);
 assert.ok(result.length<=1000);assert.ok(result.bytes<=512*1024);assert.ok(result.omitted>5000);assert.equal(result.comments,1);
 await mkdir(path.join(temp,'downloads'));const cdp=await context.newCDPSession(page);await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.join(temp,'downloads')});
 async function download(button,status){const ids=await worker.evaluate(async()=>(await chrome.downloads.search({})).map(d=>d.id));await ui.getByRole('button',{name:button,exact:true}).click();await ui.getByRole('status').filter({hasText:status}).waitFor();let d;for(let i=0;i<50;i++){d=await worker.evaluate(async ids=>(await chrome.downloads.search({})).find(d=>!ids.includes(d.id)),ids);if(d?.state==='complete')break;await page.waitForTimeout(100);}assert.equal(d?.state,'complete');return JSON.parse(await readFile(d.filename,'utf8'));}
 const ordinary=await download('Download review','Download started');assert.equal(ordinary.comments.length,1);assert.ok(ordinary.historyOmitted>5000);assert.ok(ordinary.history.length<=1000);
 console.log('PASS 6,000 history events stay bounded; active feedback preserved and export completes');
 page.on('dialog',d=>d.accept());await page.goto(base+'large');await inject();await addNote();
 await ui.getByRole('button',{name:'Download review',exact:true}).click();await ui.getByRole('button',{name:'Download feedback only',exact:true}).waitFor();
 const light=await download('Download feedback only','Feedback-only download started');
 assert.equal(light.snapshots.omitted,true);assert.equal(light.snapshots.originalHtml,'');assert.equal(light.comments[0].text,'A note that must survive export problems.');assert.equal(light.history.length,0);assert.match(light.warnings.join('\n'),/Feedback-only/);
 assert.equal(await ui.locator('article').count(),1);
 console.log('PASS 22 MB of snapshots trigger explicit feedback-only recovery; draft and all current notes preserved');
}finally{if(context)await context.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
