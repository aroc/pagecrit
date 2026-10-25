// Renders the Chrome Web Store listing images into store/ from the landing-page screenshots in
// site/assets, so run npm run screenshots first when the UI changes. Usage: npm run store
// Sizes and formats follow the store: a 128px icon with 16px transparent padding, and opaque
// 24-bit PNGs for the 1280x800 screenshots and the 440x280 and 1400x560 promo tiles.
import {chromium} from 'playwright';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const assets=path.join(root,'site/assets'), out=path.join(root,'store');
await mkdir(out,{recursive:true});
const data=async(file,type='image/png')=>`data:${type};base64,${(await readFile(file)).toString('base64')}`;
const img=name=>data(path.join(assets,name));
const logo=(await readFile(path.join(root,'extension/icons/logo.svg'),'utf8')).replace(/<!--[\s\S]*?-->/,'');
const font=await data(path.join(root,'extension/fonts/caveat-latin.woff2'),'font/woff2');
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
const base=`<style>@font-face{font-family:Hand;src:url(${font})}
 *{box-sizing:border-box}
 body{margin:0;overflow:hidden;background:#f4f5f8;font-family:ui-sans-serif,system-ui,sans-serif;color:#1f2430;position:relative}
 body:before{content:'';position:absolute;inset:0;background-image:radial-gradient(#d9dce5 1.2px,transparent 1.2px);background-size:22px 22px;opacity:.7}
 .mark{display:flex;align-items:center;gap:10px;font:700 34px/1 Hand}
 .mark svg{width:36px;height:36px;flex:none}
 h1{margin:0;font-weight:700;letter-spacing:-.6px}
 p{margin:0;color:#585c69;line-height:1.45}
 .card{border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 30px 70px -30px #1f243080,0 0 0 1px #1f24301a}
 .card img{display:block;width:100%}
 .feature{position:relative;width:1280px;height:800px;display:flex;flex-direction:column;align-items:center;padding:56px 72px 0}
 .feature .mark{margin-bottom:34px}
 .feature h1{font-size:46px;text-align:center}
 .feature p{font-size:22px;text-align:center;margin:14px 0 0;max-width:980px}
 .feature .body{flex:1;display:flex;align-items:center;padding-bottom:40px}
</style>`;
const feature=(title,sub,body)=>`${base}<div class="feature"><div class="mark">${logo}PageCrit</div><h1>${title}</h1><p>${sub}</p><div class="body">${body}</div></div>`;
const markdown=(await readFile(path.join(assets,'sample-review.md'),'utf8')).split('\n').slice(0,30)
 .map(line=>/^#/.test(line)?`<b>${esc(line)}</b>`:esc(line)).join('\n');

const images={
 // The real product, full bleed: hero.png is already 16:10.
 'screenshot-1-review.png':[1280,800,`${base}<img src="${await img('hero.png')}" style="display:block;width:1280px;height:800px">`],
 'screenshot-2-pin.png':[1280,800,feature('Pin a note to any element','Hover to see what you are pointing at, then click. Rate each note from must fix to nit.',
  `<div class="card" style="width:1000px"><img src="${await img('pin-hover.png')}"></div>`)],
 'screenshot-3-edit.png':[1280,800,feature('Edit text right on the page','Rewrite copy where it lives. The review keeps the original and your new text.',
  `<div class="card" style="width:980px"><img src="${await img('edit-inline.png')}"></div>`)],
 'screenshot-4-remove.png':[1280,800,feature('Strike whole sections','Remove hides a section so you see the page without it. Restore it any time.',
  `<div class="card" style="width:980px"><img src="${await img('remove-hover.png')}" style="margin-top:-28px"></div>`)],
 'screenshot-5-markdown.png':[1280,800,`${base}<style>
   .md{position:absolute;left:600px;top:70px;width:620px;height:760px;padding:26px 28px;font:13px/1.6 ui-monospace,Menlo,monospace;color:#3a3f4c;white-space:pre-wrap;word-break:break-word;transform:rotate(-1deg)}
   .md b{color:#2f4be0}
   .md:after{content:'';position:absolute;left:0;right:0;bottom:0;height:200px;background:linear-gradient(#fff0,#fff)}
   .copy{position:absolute;left:72px;top:190px;width:470px}
   .copy h1{font-size:44px;line-height:1.12;margin:30px 0 18px}.copy p{font-size:21px}
   .copy .card{margin-top:40px;width:362px}</style>
  <div class="copy"><div class="mark">${logo}PageCrit</div><h1>One Markdown review for your agent</h1>
  <p>Every item with its text, section and locator, plus instructions for the agent. Copy it or download it. Nothing leaves your machine.</p>
  <div class="card"><img src="${await img('footer.png')}"></div></div>
  <div class="card md">${markdown}</div>`],
 'small-promo-440x280.png':[440,280,`${base}<style>
   .tile{position:relative;height:280px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
   .tile .mark{font-size:52px;gap:14px}.tile .mark svg{width:58px;height:58px}
   .tile h1{font-size:23px;line-height:1.25;margin-top:22px;letter-spacing:-.4px}</style>
  <div class="tile"><div class="mark">${logo}PageCrit</div><h1>Add feedback on any web page.<br>Then hand it to your agent.</h1></div>`],
 'marquee-1400x560.png':[1400,560,`${base}<style>
   .copy{position:absolute;left:80px;top:120px;width:450px}
   .copy .mark{font-size:64px;gap:14px}.copy .mark svg{width:64px;height:64px}
   .copy h1{font-size:31px;line-height:1.2;margin:26px 0 14px}.copy p{font-size:19px}
   .shot{position:absolute;left:580px;top:70px;width:760px;transform:rotate(-1.5deg)}</style>
  <div class="copy"><div class="mark">${logo}PageCrit</div><h1>Add feedback on any web page.<br>Then hand it to your agent.</h1>
  <p>Pins, in-place text edits and removals, turned into one Markdown review.</p></div>
  <div class="card shot"><img src="${await img('hero.png')}"></div>`],
};

const browser=await chromium.launch();
try {
 for(const [name,[width,height,html]] of Object.entries(images)){
  const page=await browser.newPage({viewport:{width,height}});
  await page.setContent(`<style>body{width:${width}px;height:${height}px}</style>${html}`);
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.join(out,name)});
  await page.close();
 }
 // Store icon: 96px artwork centred in 128px, transparent around it.
 const page=await browser.newPage({viewport:{width:128,height:128}});
 await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:96px;height:96px;margin:16px}</style>${logo}`);
 await page.screenshot({path:path.join(out,'store-icon-128.png'),omitBackground:true});
} finally { await browser.close(); }
console.log('Wrote',['store-icon-128.png',...Object.keys(images)].join(', '),'to store/');
