// Renders the email header picture (white Grdlabs logo on navy) to img/email-header.png, for emails, which cannot
// show SVG. Run on the Mac: node tools/email-header.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(resolve(process.env.HOME, 'Grdlabs-Mobile/package.json'));
const puppeteer = require('puppeteer-core');
const site = resolve(import.meta.dirname, '..');
const logo = readFileSync(resolve(site, 'img/grdlabs-logo-white.svg'), 'utf8');

const html = `<!doctype html><html><body style="margin:0">
<div style="width:560px;height:120px;display:flex;align-items:center;justify-content:center;background:#001349">
  <div style="width:210px">${logo.replace('<svg', '<svg style="width:100%;height:auto;display:block"')}</div>
</div></body></html>`;

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 120, deviceScaleFactor: 2 });
await page.setContent(html);
await page.screenshot({ path: resolve(site, 'img/email-header.png'), clip: { x: 0, y: 0, width: 560, height: 120 } });
await browser.close();
console.log('HEADER-DONE');
