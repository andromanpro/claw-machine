import puppeteer from 'puppeteer-core';

import { findBrowser } from './browser.mjs';

const CHROME = findBrowser();
const URL = 'http://localhost:5273/toy-viewer.html';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-position=-32000,-32000', '--start-minimized', '--window-size=1280,800', '--hide-scrollbars'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));

await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__toyViewerReady === true', { timeout: 20000 });

const initial = await page.evaluate(() => ({
  current: window.__toyViewer.current,
  count: window.__toyViewer.names.length,
  canvas: document.querySelectorAll('canvas').length,
  selected: document.querySelector('.toyButton[aria-selected="true"]')?.dataset.toy,
  mobileOptions: document.querySelectorAll('#mobileToySelect option').length,
}));

await page.click('[data-toy="Лисёнок"]');
await page.waitForFunction('window.__toyViewer.current === "Лисёнок"');
const cameraBefore = await page.evaluate(() => window.__toyViewer.camera.position.toArray());
await page.mouse.move(820, 410);
await page.mouse.down();
await page.mouse.move(1010, 470, { steps: 10 });
await page.mouse.up();
await new Promise((resolve) => setTimeout(resolve, 350));
const cameraAfter = await page.evaluate(() => window.__toyViewer.camera.position.toArray());
const cameraDelta = Math.hypot(...cameraAfter.map((value, index) => value - cameraBefore[index]));
await page.screenshot({ path: 'shots/viewer-test-desktop.png' });

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction('window.__toyViewerReady === true', { timeout: 20000 });
const mobile = await page.evaluate(() => ({
  selectVisible: getComputedStyle(document.getElementById('mobileSelectWrap')).display !== 'none',
  asideHidden: getComputedStyle(document.querySelector('aside')).display === 'none',
  current: window.__toyViewer.current,
}));
await page.screenshot({ path: 'shots/viewer-test-mobile.png' });

await browser.close();

const result = { initial, selected: 'Лисёнок', cameraDelta: Number(cameraDelta.toFixed(4)), mobile };
console.log(JSON.stringify(result, null, 2));
if (initial.count !== 18 || initial.canvas !== 1 || initial.mobileOptions !== 18) throw new Error('Viewer catalog did not initialize');
if (cameraDelta < 0.02) throw new Error('Orbit drag did not move the camera');
if (!mobile.selectVisible || !mobile.asideHidden) throw new Error('Mobile viewer layout is invalid');
