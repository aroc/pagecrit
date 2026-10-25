// Real Chrome action gesture and activeTab grant; no test host permissions.
import {chromium} from 'playwright';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const temp=await mkdtemp(path.join(tmpdir(),'pagecrit-activation-'));
const server=http.createServer((_,res)=>res.end('<!doctype html><title>Activation test</title><h1>Activate on this page</h1>'));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/`;
let context;
try {
 const ext=path.join(temp,'extension');await cp(path.join(root,'extension'),ext,{recursive:true});
 const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json'),'utf8'));
 assert.equal(manifest.host_permissions,undefined);
 // Equivalent to clicking the toolbar action, grants activeTab through Chrome itself.
 manifest.commands={_execute_action:{suggested_key:{default:'Alt+Shift+Y'}}};
 await writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:false,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const page=await context.newPage();await page.goto(url);await page.bringToFront();
 const tabId=await worker.evaluate(async()=>(await chrome.tabs.query({active:true,currentWindow:true}))[0].id);
 const denied=await worker.evaluate(async tabId=>{try {await chrome.scripting.executeScript({target:{tabId},files:['core.js']});return false;}catch{return true;}},tabId);
 assert.equal(denied,true,'Page inaccessible before user invokes action');
 // A native Alt+Shift+Y keystroke through the X server, like a person pressing the shortcut.
 const pressShortcut=()=>execFileSync('python3',['-c',`
import ctypes, ctypes.util, time
x=ctypes.CDLL(ctypes.util.find_library('X11')); t=ctypes.CDLL(ctypes.util.find_library('Xtst'))
x.XOpenDisplay.restype=ctypes.c_void_p; x.XOpenDisplay.argtypes=[ctypes.c_char_p]
x.XKeysymToKeycode.argtypes=[ctypes.c_void_p,ctypes.c_ulong]; x.XKeysymToKeycode.restype=ctypes.c_uint
x.XFlush.argtypes=[ctypes.c_void_p];x.XCloseDisplay.argtypes=[ctypes.c_void_p]
t.XTestFakeKeyEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
d=x.XOpenDisplay(None)
assert d, 'No X display'
keys=[x.XKeysymToKeycode(d,n) for n in [0xffe9,0xffe1,0x79]]
for key in keys:t.XTestFakeKeyEvent(d,key,1,0)
x.XFlush(d);time.sleep(.15)
for key in reversed(keys):t.XTestFakeKeyEvent(d,key,0,0)
x.XFlush(d);x.XCloseDisplay(d)
`]);
 // The keystroke reaches Chrome only once its window has X input focus, which the page cannot observe
 // (Playwright emulates document focus). Press again until the panel opens instead of sleeping first.
 // No popup: the action opens the review panel directly through the shipped background handler.
 let opened=false;
 for(let attempt=0;attempt<5&&!opened;attempt++){pressShortcut();opened=await page.locator('[data-pagecrit-root]').waitFor({timeout:2000}).then(()=>true,()=>false);}
 assert.ok(opened,'native action shortcut opens the review panel');
 assert.equal(await page.locator('[data-pagecrit-root]').evaluate(el=>el.shadowRoot),null);
 console.log('PASS no host permissions: denied before action, native action opens the closed production panel directly');
 // Same-origin reload: report whether Chrome kept activeTab so the saved review comes back by itself.
 await page.reload();
 const restored=await page.locator('[data-pagecrit-root]').waitFor({timeout:3000}).then(()=>true,()=>false);
 console.log(`INFO same-origin reload ${restored?'restored the review automatically':'needs a toolbar click to continue the saved review'}`);
 // Grant revoked on cross-origin navigation.
 await page.goto(url.replace('127.0.0.1','localhost'));
 const revoked=await worker.evaluate(async tabId=>{try{await chrome.scripting.executeScript({target:{tabId},files:['core.js']});return false;}catch{return true;}},tabId);
 assert.equal(revoked,true);
 console.log('PASS activeTab access revoked on cross-origin navigation');
}finally{if(context)await context.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
