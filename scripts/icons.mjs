// Renders the extension icons from extension/icons/logo.svg. Usage: npm run icons
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const dir=path.resolve(import.meta.dirname,'../extension/icons');
const svg=await readFile(path.join(dir,'logo.svg'),'utf8');
const browser=await chromium.launch();
try {
 for(const size of [16,32,48,128]){
  const page=await browser.newPage({viewport:{width:size,height:size}});
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({path:path.join(dir,`icon-${size}.png`),omitBackground:true});
  await page.close();
 }
} finally { await browser.close(); }
console.log('Wrote icon-16.png, icon-32.png, icon-48.png, icon-128.png');
