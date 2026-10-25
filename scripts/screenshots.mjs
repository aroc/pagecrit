// Regenerates the README banner and landing-page screenshots from the real extension running on a
// synthetic demo page (scripts/demo). Like the browser tests, it uses a temporary copy of the
// extension with localhost access and an open shadow root so it can be driven; the shipped
// extension is untouched. Usage: npm run screenshots
import {chromium} from 'playwright';
import {mkdtemp,readFile,writeFile,cp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const out=path.join(root,'site/assets');
await mkdir(out,{recursive:true});
await cp(path.join(root,'extension/icons/icon-128.png'),path.join(out,'icon-128.png'));
const temp=await mkdtemp(path.join(tmpdir(),'page-notes-shots-'));
const demo=await readFile(path.join(root,'scripts/demo/index.html'));
const server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end(demo);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
let context, anchors;
try {
 const ext=path.join(temp,'extension');await cp(path.join(root,'extension'),ext,{recursive:true});
 const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*'];
 await writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));
 const source=await readFile(path.join(ext,'content.js'),'utf8');
 await writeFile(path.join(ext,'content.js'),source.replace("host.attachShadow({ mode: 'closed' })","host.attachShadow({ mode: 'open' })"));
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,viewport:{width:1440,height:900},deviceScaleFactor:2,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
 context.setDefaultTimeout(8000);
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(url).origin});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const page=await context.newPage();await page.goto(url);
 const tab=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,url);
 await worker.evaluate(async tabId=>chrome.scripting.executeScript({target:{tabId},files:['core.js','content.js']}),tab);
 const ui=page.locator('[data-page-notes-root]');await ui.getByRole('region',{name:'Page Notes review'}).waitFor();
 await page.waitForTimeout(400); // handwriting font
 const button=name=>ui.getByRole('button',{name,exact:true});
 const ensure=async name=>{if(await button(name).getAttribute('aria-pressed')!=='true')await button(name).click();};
 const textPoint=(selector,at=0.3)=>page.locator(selector).evaluate((el,at)=>{const node=[...el.childNodes].find(n=>n.nodeType===3&&n.data.trim());const r=document.createRange();r.selectNodeContents(node);const rect=r.getClientRects()[0];return{x:rect.x+rect.width*at,y:rect.y+rect.height/2};},at);
 const clickAt=async p=>page.mouse.click(p.x,p.y);
 const note=async(selector,text,severity,at=[0.55,0.45])=>{await ensure('Pin');const b=await page.locator(selector).boundingBox();await page.mouse.click(b.x+b.width*at[0],b.y+b.height*at[1]);await ui.locator('textarea').fill(text);await button('Save').click();if(severity)await ui.locator('article').filter({hasText:text}).getByRole('button',{name:severity,exact:true}).click();};
 const shot=async(name,clip)=>{await page.mouse.move(1,899);await page.waitForTimeout(150);await page.screenshot({path:path.join(out,name),...(clip?{clip}:{})});};
 const box=async locator=>locator.boundingBox();
 const pad=(b,x,y=x)=>({x:Math.max(0,b.x-x),y:Math.max(0,b.y-y),width:b.width+2*x,height:b.height+2*y});

 // A realistic small review: two text edits, three pins, one removal. The short pricing edit
 // goes first so the landing page's excerpt can show items 1 and 2 in order.
 await ensure('Edit text');
 await clickAt(await textPoint('[data-testid="plan-pro"] p'));await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('$8 a month per seat, billed yearly.');await page.keyboard.press('Enter');
 await clickAt(await textPoint('.lede'));await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('Kettle turns meetings, focus time and real capacity into one honest weekly plan.');await page.keyboard.press('Enter');
 await note('[data-testid="plan-pro"] .price','Annual price reads like monthly. Lead with the per-month price.','Must fix',[0.92,0.15]);
 await note('[data-testid="plan-team"] .button','Sales-led plan: say "Talk to us", not "Buy now".');
 await note('.quote .avatar','Love this quote. Keep it right under pricing.','Note',[0.5,0.3]);
 await ensure('Remove section');await page.locator('#promo').click();
 await page.keyboard.press('Escape');
 await ui.getByRole('button',{name:/^Note 1:/}).click();await page.waitForTimeout(1100);
 await shot('hero.png');
 // Where the landing page's hand-drawn arrows land: pin 1's tail and the left side of the Copy Markdown button.
 const vp=page.viewportSize(), at=(x,y)=>`${(x/vp.width).toFixed(3)},${(y/vp.height).toFixed(3)}`;
 const pinBox=await box(ui.locator('.pin').filter({hasText:/^1$/})), copyBox=await box(button('Copy Markdown'));
 anchors={pin:at(pinBox.x+pinBox.width/2,pinBox.y+pinBox.height+8),copy:at(copyBox.x,copyBox.y+copyBox.height/2)};
 await shot('panel.png',pad(await box(ui.getByRole('region',{name:'Page Notes review'})),12));
 await shot('row-severity.png',pad(await box(ui.locator('article').first()),6));

 // Pin to element: hover outline and the element's tag, next to placed pins.
 await ensure('Pin');
 const plans=await box(page.locator('.plans'));
 const free=await box(page.locator('[data-testid="plan-free"]'));
 await page.mouse.move(free.x+10,free.y+free.height*0.5);await page.waitForTimeout(150);
 await page.screenshot({path:path.join(out,'pin-hover.png'),clip:{x:plans.x-24,y:plans.y-46,width:plans.width+48,height:plans.height+70}});
 await shot('tools.png',pad(await box(ui.locator('.modes')),10,8));

 // Edit text in place, with a bold selection, before saving.
 await ensure('Edit text');
 await page.locator('.quote').scrollIntoViewIfNeeded();await page.evaluate(()=>window.scrollBy(0,120));await page.waitForTimeout(150);
 await clickAt(await textPoint('.quote b',0.5));await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('“We stopped overbooking Mondays within a week.”');
 for(let i=0;i<'within a week.”'.length;i++)await page.keyboard.press('ArrowLeft');
 for(let i=0;i<' Mondays'.length;i++)await page.keyboard.press('Shift+ArrowLeft');
 await page.keyboard.press('ControlOrMeta+B');await page.keyboard.press('ArrowRight');
 const quote=await box(page.locator('.quote'));
 await page.screenshot({path:path.join(out,'edit-inline.png'),clip:{x:quote.x-20,y:quote.y-34,width:560,height:quote.height+60}});
 await page.keyboard.press('Escape');

 // Remove a section: red outline before the click.
 await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(150);
 await ensure('Remove section');
 const actions=await box(page.locator('.actions'));
 const first=await box(page.locator('.actions .button').first());await page.mouse.move(first.x+first.width+6,actions.y+actions.height/2);await page.waitForTimeout(150);
 await page.screenshot({path:path.join(out,'remove-hover.png'),clip:{x:actions.x-24,y:actions.y-120,width:640,height:actions.height+150}});
 await page.keyboard.press('Escape');

 // The Markdown digest exactly as Copy Markdown produces it.
 await page.keyboard.press('c');await ui.getByRole('button',{name:'Copy Markdown'}).filter({hasText:'Copied'}).waitFor().catch(()=>{});
 const markdown=await page.evaluate(()=>navigator.clipboard.readText());
 if(!markdown.startsWith('# Review'))throw new Error('Copy Markdown did not produce a digest');
 await writeFile(path.join(out,'sample-review.md'),markdown.replace(/http:\/\/127\.0\.0\.1:\d+\//g,'https://kettle.example/pricing'));

 // Minimized to the pill, which keeps the item count.
 // Shot against the landing page card's wash so it sits in the card without a visible box.
 await button('Minimize').click();const pill=ui.locator('.pill');await pill.waitFor();
 await page.addStyleTag({content:'html,body,nav{background:#f6f7fa!important;border-color:transparent!important}nav>*{visibility:hidden}'});
 await shot('pill.png',pad(await box(pill),24,20));

 // README banner: the product on the left, the hero screenshot on the right.
 const font=(await readFile(path.join(root,'extension/fonts/caveat-latin.woff2'))).toString('base64');
 const heroData=(await readFile(path.join(out,'hero.png'))).toString('base64');
 const banner=await context.newPage();await banner.setViewportSize({width:1280,height:640});
 await banner.setContent(`<style>@font-face{font-family:Hand;src:url(data:font/woff2;base64,${font})}
  body{margin:0;width:1280px;height:640px;overflow:hidden;background:#f4f5f8;font-family:ui-sans-serif,system-ui,sans-serif;color:#1f2430;position:relative}
  body:before{content:'';position:absolute;inset:0;background-image:radial-gradient(#d9dce5 1.2px,transparent 1.2px);background-size:22px 22px;opacity:.7}
  .copy{position:absolute;left:72px;top:150px;width:400px}
  .mark{display:flex;align-items:center;gap:14px;font:700 64px/1 Hand}
  .mark svg{width:64px;height:64px}
  h1{font-size:30px;line-height:1.2;letter-spacing:-.6px;margin:26px 0 14px;font-weight:700}
  p{font-size:18px;line-height:1.5;color:#585c69;margin:0}
  .shot{position:absolute;left:500px;top:96px;width:720px;border-radius:16px;overflow:hidden;box-shadow:0 30px 70px -30px #1f243080,0 0 0 1px #1f24301a;transform:rotate(-1.5deg)}
  .shot img{display:block;width:100%}</style>
  <div class="copy"><div class="mark"><svg viewBox="0 0 100 100"><path d="M20 9C42 5.5 67 5.5 83 9.5C93 12 95.5 19 95.5 32V52C95.5 65 91 70 79 70H63L50.5 92L38 70H21.5C9.5 70 5 65 5 52V30C5 17.5 8.5 11 20 9Z" fill="#2f4be0" stroke="#2f4be0" stroke-width="4" stroke-linejoin="round"/><path d="M26 49C42 43.5 60 41.5 75 41.5" fill="none" stroke="#ffe36e" stroke-width="10" stroke-linecap="round"/></svg>Page Notes</div>
  <h1>Mark up any web page.<br>Hand it to your coding agent.</h1><p>Pins, in-place text edits and removals, turned into one Markdown review.</p></div>
  <div class="shot"><img src="data:image/png;base64,${heroData}"></div>`);
 await banner.waitForTimeout(300);
 await banner.screenshot({path:path.join(out,'readme-banner.png')});
 console.log('Wrote',['hero.png','panel.png','row-severity.png','pin-hover.png','tools.png','edit-inline.png','remove-hover.png','pill.png','sample-review.md','readme-banner.png'].join(', '));
} finally {
 if(context)await context.close();
 await new Promise(resolve=>server.close(resolve));
 await rm(temp,{recursive:true,force:true});
}
// Point the landing page's arrows at where things actually are in the new hero.png.
if (anchors) {
 const site=path.join(root,'site/index.html');let html=await readFile(site,'utf8');
 for(const [name,value] of Object.entries(anchors))html=html.replace(new RegExp(`data-anchor="${name}" data-at="[^"]*"`),`data-anchor="${name}" data-at="${value}"`);
 await writeFile(site,html);
}
// Keep the repository light: shrink the full-viewport hero for the web.
try { execFileSync('magick',[path.join(out,'hero.png'),'-resize','1800x','-strip',path.join(out,'hero.png')]); } catch (_) { /* ImageMagick optional. */ }
