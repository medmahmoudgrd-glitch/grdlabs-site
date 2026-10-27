// Copies the phone UI from ../mobile into www/ so Capacitor can package it, and points the icon at a local copy.
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, '..');
const www = join(root, 'www');
mkdirSync(www, { recursive: true });
// Inside the app the phone itself is the frame, so the desktop device mock-up is switched off.
const html = readFileSync(join(site, 'mobile', 'index.html'), 'utf8')
  .replaceAll('../img/grdlabs-app-icon.svg', 'icon.svg')
  .replace('@media (min-width: 600px) and (min-height: 760px) {', '@media not all {')
  .replace('@media (max-width: 599px), (max-height: 759px) { #bans', '@media all { #bans');
if (html.includes('@media (min-width: 600px) and (min-height: 760px)')) throw new Error('frame media query not replaced');
writeFileSync(join(www, 'index.html'), html);
copyFileSync(join(site, 'img', 'grdlabs-app-icon.svg'), join(www, 'icon.svg'));
console.log('www/ ready');
