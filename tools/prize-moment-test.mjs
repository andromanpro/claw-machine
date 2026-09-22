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
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));

async function stagePrize(index = 0, templateName = null) {
  return page.evaluate(({ toyIndex, wantedTemplate }) => {
    const view = window.__clawView;
    const manager = view.toys;
    const route = manager.delivery.routeIn;
    let toy = manager.toys[toyIndex];
    if (wantedTemplate) {
      const template = manager.templates.find((item) => item.name === wantedTemplate);
      toy = manager.spawnTemplate(template, route.x, route.y - 0.62, route.z - 0.34, { yaw: 0 });
    }
    toy.body.position.set(route.x, route.y - 0.62, route.z - 0.34);
    toy.body.velocity.set(0, 0, 0);
    toy.body.angularVelocity.set(0, 0, 0);
    toy.scored = true;
    toy.onFloor = false;
    toy.prizeEligible = false;
    manager.startDelivery(toy);
    window.__prizeMoment.start(toy);
    return toy.name;
  }, { toyIndex: index, wantedTemplate: templateName });
}

try {
  await page.goto('http://127.0.0.1:5273/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__clawReady === true && !!window.__prizeMoment', { timeout: 40000 });
  await page.keyboard.press('Enter');
  await wait(1800);

  const cameraBefore = await page.evaluate(() => ({
    pos: window.__clawView.camera.position.toArray(),
    target: window.__clawView.controls.target.toArray(),
  }));
  const naturalToy = await stagePrize(0, 'Гигантский мишка');
  const started = await page.evaluate(() => ({
    active: window.__prizeMoment.active,
    overlay: document.getElementById('prizeMoment').classList.contains('active'),
    controls: window.__clawView.controls.enabled,
  }));

  await page.waitForFunction(
    () => window.__prizeMoment.toy?.deliver?.phase === 'eject',
    { timeout: 8000 }
  );
  await wait(140);
  const focused = await page.evaluate(() => ({
    phase: window.__prizeMoment.toy?.deliver?.phase,
    haloRemoved: !window.__prizeMoment.halo,
    light: window.__prizeMoment.light.intensity,
    controls: window.__clawView.controls.enabled,
    camera: window.__clawView.camera.position.toArray(),
    title: document.getElementById('prizeMomentTitle').textContent,
    visualScale: window.__prizeMoment.toy.mesh.scale.x / window.__prizeMoment.toy.mesh.userData.baseScale.x,
  }));
  await page.screenshot({ path: 'shots/prize-moment.png' });

  await page.waitForFunction(() => !window.__prizeMoment.active, { timeout: 10000 });
  const returned = await page.evaluate((before) => {
    const view = window.__clawView;
    const delta = Math.hypot(...view.camera.position.toArray().map((value, i) => value - before.pos[i]));
    return {
      cameraDelta: delta,
      controls: view.controls.enabled,
      overlay: document.getElementById('prizeMoment').classList.contains('active'),
      haloRemoved: !window.__prizeMoment.halo,
      visualScale: window.__clawView.toys.toys.find((toy) => toy.onFloor)?.mesh.scale.x
        / window.__clawView.toys.toys.find((toy) => toy.onFloor)?.mesh.userData.baseScale.x,
    };
  }, cameraBefore);

  const skippedToy = await stagePrize(1);
  await wait(120);
  const skipStart = performance.now();
  await page.click('#prizeMoment');
  await page.waitForFunction(() => !window.__prizeMoment.active, { timeout: 2000 });
  const skipped = await page.evaluate(() => ({
    active: window.__prizeMoment.active,
    controls: window.__clawView.controls.enabled,
    overlay: document.getElementById('prizeMoment').classList.contains('active'),
  }));
  skipped.ms = Math.round(performance.now() - skipStart);

  const result = { naturalToy, started, focused, returned, skippedToy, skipped };
  console.log(JSON.stringify(result, null, 2));

  if (!started.active || !started.overlay || started.controls) throw new Error('Prize moment did not lock the camera');
  if (!focused.haloRemoved || focused.light < 0.5 || focused.controls) throw new Error('Prize focus light is missing or the floor halo returned');
  if (focused.title !== 'ПРИЗ В ПУТИ') throw new Error('Prize overlay title is wrong');
  if (focused.visualScale >= 0.9 || focused.visualScale < 0.46) throw new Error('Prize is not safely scaled while leaving the hatch');
  if (returned.cameraDelta > 0.08 || !returned.controls || returned.overlay || !returned.haloRemoved) throw new Error('Natural camera return failed');
  if (Math.abs(returned.visualScale - 1) > 0.01) throw new Error('Prize scale was not restored after delivery');
  if (skipped.active || !skipped.controls || skipped.overlay || skipped.ms > 1000) throw new Error('Prize moment skip failed');
} finally {
  await browser.close();
}
