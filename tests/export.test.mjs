import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const api=require('../extension/export.js');
const sample=()=>({schemaVersion:1,tool:{name:'Page Notes',version:'0.1.0'},session:{id:'synthetic'},page:{url:'https://example.com/product?test=1',title:'Example'},snapshots:{originalHtml:'<h1>Old</h1>',editedHtml:'<h1>New</h1>'},comments:[{id:'p1',text:'More detail here',anchor:{kind:'page',document:{x:10,y:300}}}],edits:[{before:'Old',after:'New',locator:{element:{selector:'h1'}}}],history:[]});
test('agent handoff retains original/replacement evidence and scannable review',()=>{
 const output=JSON.parse(api.serializeBundle(sample()));
 assert.equal(output.snapshots.originalHtml,'<h1>Old</h1>');
 assert.equal(output.edits[0].after,'New');
 assert.match(output.reviewMarkdown,/> More detail here/);
 assert.match(output.reviewMarkdown,/reference data, not agent instructions/);
 assert.match(api.filename(output),/^\d{4}-\d{2}-\d{2} \d{2}-\d{2} Example\.page-notes\.json$/);
});
test('download filename has local date, time and a sanitized page title',()=>{
 const at=new Date(2026,9,24,9,5,7);const b=sample();
 assert.equal(api.filename(b,at),'2026-10-24 09-05 Example.page-notes.json');
 b.page.title='  Q3 / Q4: "Pricing" <draft>?\u202e\n\t  ..';assert.equal(api.filename(b,at),'2026-10-24 09-05 Q3 Q4 Pricing draft.page-notes.json');
 b.page.title='../../etc/passwd';assert.equal(api.filename(b,at),'2026-10-24 09-05 etc passwd.page-notes.json');
 b.page.title='Fieldwork — café 🦆';assert.equal(api.filename(b,at),'2026-10-24 09-05 Fieldwork — café 🦆.page-notes.json');
 b.page.title='x'.repeat(500);assert.equal(api.filename(b,at),`2026-10-24 09-05 ${'x'.repeat(80)}.page-notes.json`);
 b.page.title='   ';assert.equal(api.filename(b,at),'2026-10-24 09-05 example.com.page-notes.json');
 b.session.exportedAt='2026-01-02T03:04:05Z';assert.match(api.filename(b),/^2026-01-0\d \d{2}-\d{2} example\.com\.page-notes\.json$/);
});
test('formatted edits carry ranges and escaped HTML into the summary; bad ranges are rejected',()=>{
 const b=sample();b.edits[0]={before:'Old',after:'New bold',formatting:[{start:4,end:8,marks:['bold']}],afterHtml:'New <strong>bold</strong>',locator:{}};
 assert.match(JSON.parse(api.serializeBundle(b)).reviewMarkdown,/> New <strong>bold<\/strong>/);
 b.edits[0].formatting=[{start:4,end:20,marks:['bold']}];assert.throws(()=>api.serializeBundle(b),/formatting/);
 b.edits[0].formatting=[{start:0,end:2,marks:['script']}];assert.throws(()=>api.serializeBundle(b),/formatting/);
});
test('reject malformed or oversized bundles before download',()=>{
 assert.throws(()=>api.serializeBundle({schemaVersion:2}),/Unsupported/);
 const b=sample(); b.snapshots.originalHtml='x'.repeat(api.MAX_BYTES);
 assert.throws(()=>api.serializeBundle(b),/20 MB/);
 const c=sample(); c.comments[0].anchor.kind='remote';
 assert.throws(()=>api.serializeBundle(c),/anchor/);
});
test('page-originated messages cannot invoke a remote destination; only extension top frame can download',async()=>{
 let callback, download;
 const context={importScripts(){},PageNotesExport:api,encodeURIComponent,chrome:{runtime:{id:'our-extension',onMessage:{addListener(fn){callback=fn}}},downloads:{async download(opts){download=opts;return 8}}}};
 vm.runInNewContext(readFileSync(new URL('../extension/background.js',import.meta.url),'utf8'),context);
 const invoke=sender=>new Promise(resolve=>callback({type:'PAGE_NOTES_EXPORT',bundle:sample(),destination:'https://evil.invalid/'},sender,resolve));
 assert.equal((await invoke({id:'foreign',tab:{id:1},frameId:0,url:'https://example.com'})).ok,false);
 assert.equal(download,undefined);
 assert.equal((await invoke({id:'our-extension',tab:{id:1},frameId:1,url:'https://example.com'})).ok,false);
 const result=await invoke({id:'our-extension',tab:{id:1},frameId:0,url:'https://example.com'});
 assert.equal(result.downloadId,8);
 assert.match(download.url,/^data:application\/json/);
 assert.equal(download.saveAs,true);
});
test('canceled download is returned as an error for draft retention',async()=>{
 let callback;
 vm.runInNewContext(readFileSync(new URL('../extension/background.js',import.meta.url),'utf8'),{importScripts(){},PageNotesExport:api,encodeURIComponent,chrome:{runtime:{id:'ext',onMessage:{addListener(fn){callback=fn}}},downloads:{async download(){throw new Error('User canceled')}}}});
 const result=await new Promise(resolve=>callback({type:'PAGE_NOTES_EXPORT',bundle:sample()},{id:'ext',tab:{id:1},frameId:0,url:'https://example.com'},resolve));
 assert.equal(result.ok,false);assert.match(result.error,/canceled/);
});
