// Диагностика пальцев: у стекла, при мотылянии, после цикла хвата
import puppeteer from 'puppeteer-core';

import { findBrowser } from './browser.mjs';

const CHROME = findBrowser();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--window-position=-32000,-32000', '--start-minimized', '--window-size=1280,800'], defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto('http://localhost:5273/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__clawReady === true', { timeout: 40000 });

const probe = (label) => page.evaluate((lbl) => {
  const c = window.__claw;
  const phis = c.fingerPhys.map((f) => {
    const d = f.upper.quaternion.vmult(new (f.upper.position.constructor)(0, -1, 0));
    return +Math.atan2(d.x * f.dir.x + d.z * f.dir.z, -d.y).toFixed(2);
  });
  const jitter = c.fingerPhys.map((f) => +f.upper.angularVelocity.length().toFixed(2));
  const headSpin = +c.headBody.angularVelocity.length().toFixed(3);
  return { lbl, phis, jitter, headSpin, pos: +c.pos.x.toFixed(2) };
}, label).then((r) => console.log(JSON.stringify(r)));

await page.keyboard.press('Enter');
await wait(1800);
await probe('after-start');

// в правую стену и повисеть там
await page.keyboard.down('ArrowRight');
await wait(1600);
await page.keyboard.up('ArrowRight');
await wait(800);
await probe('at-glass');
await page.screenshot({ path: 'shots/f1-glass.png' });

// мотыляние у стены
for (let i = 0; i < 4; i++) {
  await page.keyboard.down('ArrowLeft'); await wait(260); await page.keyboard.up('ArrowLeft');
  await page.keyboard.down('ArrowRight'); await wait(260); await page.keyboard.up('ArrowRight');
}
await probe('after-shake');
await page.screenshot({ path: 'shots/f2-shake.png' });

// цикл хвата у стены (кредит нужен)
await page.keyboard.press('KeyM');
await wait(1100);
await page.keyboard.press('Space');
await wait(2600);
await probe('grab-bottom');
await page.screenshot({ path: 'shots/f3-grabwall.png' });
await wait(5000);
await probe('after-cycle');
await page.screenshot({ path: 'shots/f4-idle.png' });

await browser.close();
