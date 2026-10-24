import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../extension/popup.js',import.meta.url),'utf8');
async function activate({url='https://example.com/',inspection={modal:false,contentType:'text/html'},failure}={}){
 let click,closed=false;const button={disabled:false,addEventListener(type,fn){click=fn;}},status={textContent:''},calls=[];
 vm.runInNewContext(source,{document:{querySelector:s=>s==='#start'?button:status},window:{close(){closed=true;}},chrome:{tabs:{query:async()=>[{id:10,url}]},scripting:{async executeScript(opts){calls.push(opts);if(failure)throw new Error(failure);return[{result:inspection}];}}}});
 await click();return{closed,button,status,calls};
}
test('popup only injects HTML pages after explicit activation',async()=>{
 const r=await activate();assert.equal(r.closed,true);assert.equal(r.calls.length,2);assert.deepEqual(Array.from(r.calls[1].files),['core.js','content.js']);
});
test('restricted pages and non-HTML documents give recoverable errors',async()=>{
 for(const options of [{url:'chrome://settings/'},{inspection:{contentType:'application/pdf'}},{failure:'Cannot access contents of the page.'}]){
   const r=await activate(options);assert.equal(r.closed,false);assert.equal(r.button.disabled,false);assert.match(r.status.textContent,/Couldn't start/);assert.ok(!r.calls.some(c=>c.files));
 }
});
test('modal dialog is identified before mounting an inaccessible overlay',async()=>{
 const r=await activate({inspection:{modal:true,contentType:'text/html'}});assert.equal(r.closed,false);assert.match(r.status.textContent,/Close the page’s modal dialog/);assert.equal(r.button.disabled,false);assert.equal(r.calls.length,1);
});
