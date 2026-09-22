// Прогон инспектора: скриншот каждой игрушки (8 ракурсов на кадр) в shots/toys/
// Использование: node tools/toy-inspect.mjs [--only=Мишка,Кролик]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

import { findBrowser } from './browser.mjs';

const CHROME = findBrowser();
const BASE = 'http://localhost:5273/inspect.html';
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').split('=')[1]?.split(',');

mkdirSync('shots/toys', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--window-position=-32000,-32000', '--start-minimized'],
  defaultViewport: { width: 1600, height: 860 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(`${BASE}?list`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__inspectReady === true', { timeout: 20000 });
const names = await page.evaluate(() => window.__toyNames);

const list = only?.length ? names.filter((n) => only.includes(n)) : names;
console.log(`игрушек: ${list.length}`);
let idx = 0;
for (const n of list) {
  idx++;
  await page.goto(`${BASE}?toy=${encodeURIComponent(n)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__inspectReady === true', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 150));
  const file = `shots/toys/${String(idx).padStart(2, '0')}-${n.replace(/[^\wа-яА-ЯёЁ-]+/g, '_')}.png`;
  await page.screenshot({ path: file });
  console.log('saved', file);
}
await browser.close();
