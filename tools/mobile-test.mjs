// Реальные multi-touch события: диагональ, раздельное отпускание и кнопка хвата.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

import { findBrowser } from './browser.mjs';

const CHROME = findBrowser();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
mkdirSync('shots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-position=-32000,-32000', '--start-minimized'],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));

try {
  await page.goto('http://127.0.0.1:5273/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__clawReady === true', { timeout: 40000 });
  await page.click('#playBtn');
  // Дождаться конца стартового облёта: во время него OrbitControls и попытка
  // намеренно заблокированы.
  await wait(1800);

  const center = async (selector) => page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const upPos = await center('.touchBtn.up');
  const leftPos = await center('.touchBtn.left');
  const grabPos = await center('#touchGrab');

  const up = await page.touchscreen.touchStart(upPos.x, upPos.y);
  await wait(80);
  const upOnly = await page.evaluate(() => ({
    input: window.__claw.panelInput.toArray(),
    controls: window.__clawView.controls.enabled,
    active: document.querySelector('.touchBtn.up').classList.contains('active'),
  }));

  const left = await page.touchscreen.touchStart(leftPos.x, leftPos.y);
  await wait(80);
  const diagonal = await page.evaluate(() => ({
    input: window.__claw.panelInput.toArray(),
    controls: window.__clawView.controls.enabled,
    active: document.querySelectorAll('.touchBtn.active').length,
  }));

  await up.end();
  await wait(80);
  const leftOnly = await page.evaluate(() => ({
    input: window.__claw.panelInput.toArray(),
    controls: window.__clawView.controls.enabled,
  }));

  await left.end();
  await wait(80);
  const released = await page.evaluate(() => ({
    input: window.__claw.panelInput.toArray(),
    controls: window.__clawView.controls.enabled,
    active: document.querySelectorAll('.touchBtn.active').length,
  }));

  await page.keyboard.press('KeyM');
  await wait(1100);
  const grab = await page.touchscreen.touchStart(grabPos.x, grabPos.y);
  await wait(100);
  const grabbing = await page.evaluate(() => ({
    state: window.__claw.state,
    tries: window.__claw.tries,
    active: document.querySelector('#touchGrab').classList.contains('active'),
    label: document.querySelector('#touchGrab').textContent.trim(),
  }));
  await grab.end();
  await wait(80);

  await page.screenshot({ path: 'shots/mobile-touch-test.png' });
  const result = { upOnly, diagonal, leftOnly, released, grabbing };
  console.log(JSON.stringify(result, null, 2));

  const same = (a, b) => Math.abs(a - b) < 0.01;
  if (!same(upOnly.input[0], 0) || !same(upOnly.input[1], -1) || !upOnly.active) throw new Error('Up touch direction is wrong');
  if (!same(diagonal.input[0], -1) || !same(diagonal.input[1], -1) || diagonal.active !== 2) throw new Error('Multi-touch diagonal failed');
  if (!same(leftOnly.input[0], -1) || !same(leftOnly.input[1], 0)) throw new Error('Independent touch release failed');
  if (!same(released.input[0], 0) || !same(released.input[1], 0) || released.active !== 0) throw new Error('Touch input stayed active');
  if (upOnly.controls || diagonal.controls || leftOnly.controls || !released.controls) throw new Error('Camera lock was not restored correctly');
  if (grabbing.state === 0 || grabbing.tries !== 1 || !grabbing.active || grabbing.label !== 'ХВАТ') throw new Error('Touch grab did not start an attempt');
} finally {
  await browser.close();
}
