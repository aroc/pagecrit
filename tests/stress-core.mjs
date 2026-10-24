// Adversarial DOM/geometry tests against real Chromium. Synthetic content only.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const browser = await chromium.launch({channel:'chromium',headless:true});
const page = await browser.newPage({viewport:{width:1100,height:800}});
// No fixture should ever contact even its synthetic example domains.
await page.route('**/*', route => route.abort());
const source = path.resolve(import.meta.dirname,'../extension/core.js');
const cases = [];
async function run(name, html, test) {
  await page.setContent(html);
  await page.addScriptTag({path:source});
  try { await test(); console.log(`PASS ${name}`); cases.push({name,pass:true}); }
  catch(error) { console.error(`FAIL ${name}: ${error.message}`); cases.push({name,pass:false}); }
}
const equal = (actual, expected, epsilon=0.01) => assert.ok(Math.abs(actual-expected)<epsilon, `${actual} ~= ${expected}`);
try {
 await run('document horizontal+vertical scrolling; element viewport units; responsive scale+zoom',`<style>body{margin:0;width:2400px;height:2600px}#a{position:absolute;left:700px;top:900px;width:200px;height:100px;background:red}</style><div id=a>A</div>`,async()=>{
   const results=await page.evaluate(()=>{
    const c=PageNotesCore,a=document.querySelector('#a');window.scrollTo(400,600);let r=a.getBoundingClientRect();
    const element=c.createAnchor(a,r.left+r.width*.25,r.top+r.height*.75,'element');
    const fixed=c.createAnchor(a,r.left+r.width*.25,r.top+r.height*.75,'page');
    window.scrollTo(550,700);const plain=c.resolveAnchor(fixed,a);
    a.style.width='400px';a.style.height='200px';a.style.transformOrigin='0 0';a.style.transform='scale(1.5)';
    let rr=a.getBoundingClientRect(),resolved=c.resolveAnchor(element,a);
    const scaled={resolved,expected:{x:rr.left+rr.width*.25,y:rr.top+rr.height*.75}};
    a.style.zoom='0.8';rr=a.getBoundingClientRect();resolved=c.resolveAnchor(element,a);
    return{plain,document:fixed.document,scaled,zoomed:{resolved,expected:{x:rr.left+rr.width*.25,y:rr.top+rr.height*.75}}};
   });
   assert.deepEqual(results.document,{x:750,y:975});equal(results.plain.x,200);equal(results.plain.y,275);
   for(const key of ['scaled','zoomed']){equal(results[key].resolved.x,results[key].expected.x);equal(results[key].resolved.y,results[key].expected.y);}
 });
 await run('nested horizontal+vertical clipping with CSS transform and borders',`<style>body{margin:0}#outer{margin:50px;width:200px;height:200px;overflow:scroll;border:10px solid;transform:scale(1.5);transform-origin:0 0}#inner{width:700px;height:700px}#a{position:relative;left:40px;top:40px;width:80px;height:80px}</style><div id=outer><div id=inner><p id=a>Nested target</p></div></div>`,async()=>{
   const values=await page.evaluate(()=>{
    const a=document.querySelector('#a'),o=document.querySelector('#outer'),c=PageNotesCore,r=a.getBoundingClientRect();
    const anchor=c.createAnchor(a,r.left+r.width/2,r.top+r.height/2,'element');const initial=c.resolveAnchor(anchor,a);
    o.scrollTo(20,20);const scrolled=c.resolveAnchor(anchor,a);o.scrollTo(160,160);const hidden=c.resolveAnchor(anchor,a);
    return{initial,scrolled,hidden};
   });
   assert.equal(values.initial.visible,true);assert.equal(values.scrolled.visible,true);equal(values.scrolled.x,values.initial.x-30);equal(values.scrolled.y,values.initial.y-30);assert.equal(values.hidden.visible,false);
 });
 await run('fixed and sticky elements track viewport while document pins stay fixed',`<style>body{margin:0;height:3000px}#fixed{position:fixed;top:25px;left:25px;width:100px;height:50px}#sticky{position:sticky;top:80px;width:100px;height:50px;margin-top:200px}</style><div id=fixed>Fixed</div><div id=sticky>Sticky</div>`,async()=>{
   const values=await page.evaluate(()=>{
    window.scrollTo(0,0);const fixed=document.querySelector('#fixed'),sticky=document.querySelector('#sticky'),c=PageNotesCore;
    const r=fixed.getBoundingClientRect(),s=sticky.getBoundingClientRect(),fa=c.createAnchor(fixed,r.left+20,r.top+20,'element'),sa=c.createAnchor(sticky,s.left+20,s.top+20,'element');
    window.scrollTo(0,400);return{fixed:c.resolveAnchor(fa,fixed),sticky:c.resolveAnchor(sa,sticky),srect:sticky.getBoundingClientRect().toJSON()};
   });equal(values.fixed.y,45);equal(values.sticky.y,values.srect.top+20);assert.equal(values.fixed.visible,true);assert.equal(values.sticky.visible,true);
 });
 await run('hidden and transparent parents hide pins; child visibility override remains visible',`<div id=parent style="opacity:0"><p id=a style="width:200px;height:40px">Invisible</p></div>`,async()=>{
   const values=await page.evaluate(()=>{
    const a=document.querySelector('#a'),p=a.parentElement,c=PageNotesCore,r=a.getBoundingClientRect(),anchor=c.createAnchor(a,r.left+20,r.top+20,'element');
    const transparent=c.resolveAnchor(anchor,a);p.style.opacity='1';p.style.visibility='hidden';a.style.visibility='visible';const override=c.resolveAnchor(anchor,a);
    a.style.visibility='hidden';const hidden=c.resolveAnchor(anchor,a);return{transparent,override,hidden};
   });assert.equal(values.transparent.visible,false);assert.equal(values.override.visible,true);assert.equal(values.hidden.visible,false);
 });
 await run('duplicate and special IDs resolve exact DOM nodes; edits retain unicode, whitespace and inline markup',`<p id=duplicate>First</p><p id=duplicate>Second</p><p id="123 weird:#[]">  Héllo 👩🏽‍💻 <em>inline</em>\n tail\t</p>`,async()=>{
   const values=await page.evaluate(()=>{
    const c=PageNotesCore,ps=[...document.querySelectorAll('p')];
    const matching=ps.map(p=>c.findElement(c.describeElement(p))===p);
    const p=ps[2],n=p.firstChild,before=p.innerHTML,desc=c.describeTextNode(n);const resolved=c.resolveTextNode(desc)===n;
    const edit=c.applyTextEdit(n,'  <script>literal & 🦆</script>\n');return{matching,resolved,edit,text:p.textContent,html:p.innerHTML,before};
   });assert.deepEqual(values.matching,[true,true,true]);assert.equal(values.resolved,true);assert.equal(values.edit.originalText,'  Héllo 👩🏽‍💻 ');assert.equal(values.edit.newText,'  <script>literal & 🦆</script>\n');assert.match(values.html,/&lt;script&gt;/);assert.match(values.html,/<em>inline<\/em>/);assert.ok(values.text.endsWith('\n tail\t'));
 });
 await run('blocked contexts and detached nodes are never editable; blank clicks do not select nearby text',`<style>body{margin:0}p{margin:0;width:400px;height:100px}</style><p id=a>Hello</p><input value=private><textarea>private</textarea><div contenteditable><b>private</b></div><svg><text>vector</text></svg><div id=shadow></div>`,async()=>{
   const values=await page.evaluate(()=>{
    const c=PageNotesCore,shadow=document.querySelector('#shadow').attachShadow({mode:'open'});shadow.innerHTML='<p>shadow</p>';
    const nodes=[document.querySelector('textarea').firstChild,document.querySelector('b').firstChild,document.querySelector('text').firstChild,shadow.querySelector('p').firstChild,document.createTextNode('detached')];
    const rejected=nodes.map(n=>{try{c.applyTextEdit(n,'bad');return false}catch{return true}});
    const rect=document.querySelector('#a').getBoundingClientRect();return{rejected,blank:c.locateTextNodeAtPoint(rect.right-10,rect.bottom-10)===null};
   });assert.deepEqual(values.rejected,[true,true,true,true,true]);assert.equal(values.blank,true);
 });
 await run('snapshot redacts sensitive URL variants, controls, script state and extension UI without changing source',`<!doctype html><html><head><base href="https://example.test/base/"><meta name=token content=SECRET_META><style>.a{background:url('https://x.test/i?SECRET_CSS=1')} @import 'https://x.test/s?SECRET_IMPORT=1';</style></head><body data-token=SECRET_DATA onload="bad()"><!--SECRET_COMMENT--><script>SECRET_SCRIPT</script><div data-page-notes-root>SECRET_UI</div><form action="https://u:p@example.test/send?SECRET_FORM=1#fragment"><input type=hidden value=SECRET_HIDDEN><input value=SECRET_INPUT><textarea>SECRET_TEXTAREA</textarea><select><option selected>SECRET_OPTION</option></select></form><a href="java&#10;script:alert(1)" ping="https://x.test/p?SECRET_PING=1">link</a><img src="https://u:p@x.test/a?SECRET_SRC=1#private" srcset="https://x.test/a?SECRET_SRCSET=1 1x, https://x.test/b?SECRET_SRCSET=2 2x"><blockquote cite="https://x.test/c?SECRET_CITE=1">Quote</blockquote><div style="background-image:url(https://x.test/a?SECRET_STYLE=1)" data-state=SECRET_STATE>Visible evidence</div><svg><a xlink:href="https://x.test/s?SECRET_SVG=1"><text>SVG</text></a></svg><iframe srcdoc="SECRET_FRAME"></iframe><template>SECRET_TEMPLATE</template></body></html>`,async()=>{
    const values=await page.evaluate(()=>{const before=document.documentElement.outerHTML;const snapshot=PageNotesCore.snapshotDocument();return{snapshot,unchanged:before===document.documentElement.outerHTML};});
    assert.equal(values.unchanged,true);assert.ok(!values.snapshot.includes('SECRET_'), values.snapshot.match(/SECRET_[A-Z]+/g)?.join(', '));assert.match(values.snapshot,/Visible evidence/);assert.match(values.snapshot,/Content-Security-Policy/);assert.ok(!values.snapshot.includes('javascript:'));assert.ok(!values.snapshot.includes('u:p@'));
 });
 await run('snapshot cannot execute custom element constructors or attribute callbacks',`<script>window.calls={construct:0,attribute:0,connected:0};customElements.define('x-probe',class extends HTMLElement{static get observedAttributes(){return ['data-token','style','src']}constructor(){super();calls.construct++}attributeChangedCallback(){calls.attribute++}connectedCallback(){calls.connected++}})</script><x-probe data-token=SECRET_CUSTOM style="color:red" src="https://example.test/a?secret=1">Evidence</x-probe>`,async()=>{
   const values=await page.evaluate(()=>{const before={...calls};const html=PageNotesCore.snapshotDocument();const again=PageNotesCore.snapshotDocument();return{before,after:calls,html,stable:html===again};});
   assert.deepEqual(values.after,values.before);assert.equal(values.stable,true);assert.ok(!values.html.includes('SECRET_CUSTOM'));assert.match(values.html,/Evidence/);
 });
 await run('fixed and absolute descendants escape non-containing overflow ancestors',`<style>body{margin:0;height:1500px}#outer{width:80px;height:80px;overflow:hidden}#fixed{position:fixed;left:200px;top:200px;width:80px;height:80px}#absolute{position:absolute;left:400px;top:200px;width:80px;height:80px}</style><div id=outer><div id=fixed>Fixed outside</div><div id=absolute>Absolute outside</div></div>`,async()=>{
   const values=await page.evaluate(()=>['fixed','absolute'].map(id=>{const el=document.getElementById(id),r=el.getBoundingClientRect(),c=PageNotesCore;return c.resolveAnchor(c.createAnchor(el,r.left+20,r.top+20,'element'),el);}));
   assert.equal(values[0].visible,true);assert.equal(values[1].visible,true);
 });
 await run('containing blocks still clip positioned descendants and fixed descendants of transformed parents',`<style>body{margin:0}#outer{width:80px;height:80px;overflow:hidden;position:relative;transform:translate(0)}#fixed{position:fixed;left:200px;top:200px;width:80px;height:80px}#absolute{position:absolute;left:400px;top:200px;width:80px;height:80px}#inner{position:fixed;left:200px;top:400px;width:80px;height:80px}#leaf{width:60px;height:60px}</style><div id=outer><div id=fixed>Fixed outside</div><div id=absolute>Absolute outside</div><div id=inner><span id=leaf>Nested</span></div></div>`,async()=>{
   const values=await page.evaluate(()=>['fixed','absolute','leaf'].map(id=>{const el=document.getElementById(id),r=el.getBoundingClientRect(),c=PageNotesCore;return c.resolveAnchor(c.createAnchor(el,r.left+10,r.top+10,'element'),el);}));
   for(const value of values)assert.equal(value.visible,false);
 });
 await run('large synthetic DOM snapshot is bounded and leaves live DOM intact',`<main id=root></main>`,async()=>{
   const value=await page.evaluate(()=>{
    const root=document.querySelector('#root');for(let i=0;i<5000;i++){const p=document.createElement('p');p.id='item-'+i;p.dataset.secret='SECRET';p.textContent='Item '+i+' with unicode 🦆 and ordinary useful evidence.';root.append(p);}
    const start=performance.now(),html=PageNotesCore.snapshotDocument();return{ms:performance.now()-start,html,sourceCount:root.children.length,sourceAttr:root.firstChild.dataset.secret};
   });assert.equal(value.sourceCount,5000);assert.equal(value.sourceAttr,'SECRET');assert.ok(!value.html.includes('SECRET'));assert.match(value.html,/Item 4999/);assert.ok(value.ms<5000,`Snapshot took ${value.ms} ms`);console.log(`  5,000-node snapshot: ${Math.round(value.ms)}ms, ${value.html.length} characters`);
 });
 await run('snapshot remains inert even when the live page removed its head',`<p>Body remains</p>`,async()=>{
   const value=await page.evaluate(()=>{document.head.remove();return PageNotesCore.snapshotDocument();});assert.match(value,/Content-Security-Policy/);assert.match(value,/Body remains/);
 });
} finally { await browser.close(); }
const failed=cases.filter(t=>!t.pass);console.log(`${cases.length-failed.length}/${cases.length} adversarial core browser groups passed`);if(failed.length)process.exitCode=1;
