import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findBrowser } from './browser.mjs';
import { withVite } from './server.mjs';

const output = fileURLToPath(new URL('../assets/screenshots/', import.meta.url));
await fs.mkdir(output, { recursive: true });
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

await withVite(async (url) => {
  const browser = await puppeteer.launch({
    executablePath: findBrowser(), headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1440, height: 1000 },
  });
  try {
    for (const mode of ['toys', 'fugitives']) {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(mode => {
        localStorage.setItem('claw-settings-v1', JSON.stringify({ gameMode: mode, graphics: 'balanced', sound: false, freePlay: true }));
      }, mode);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => window.__clawReady === true, { timeout: 60000 });
      if (mode === 'fugitives') await page.waitForFunction(() => window.__clawView.toys.toys.every(toy => toy.mesh.userData.detailedFugitive?.ready), { timeout: 40000 });
      await page.keyboard.press('Enter');
      await wait(2000);
      await page.evaluate(() => {
        const v = window.__clawView;
        v.controls.maxDistance = 20;
        v.camera.position.set(4.3, 2.0, 9.2);
        v.controls.target.set(-.65, .65, .18);
        v.controls.update();
      });
      await wait(500);
      await page.screenshot({ path: output + (mode === 'toys' ? 'hero.jpg' : 'factory-panic.jpg'), type: 'jpeg', quality: 90 });
      await page.close();
    }
    const viewer = await browser.newPage();
    await viewer.goto(url + '/toy-viewer.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await viewer.waitForFunction(() => window.__toyViewerReady === true, { timeout: 40000 });
    await wait(500);
    await viewer.screenshot({ path: output + 'toy-viewer.jpg', type: 'jpeg', quality: 90 });
    console.log('Saved assets/screenshots/{hero,factory-panic,toy-viewer}.jpg');
  } finally { await browser.close(); }
});
