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
  await page.waitForFunction('window.__clawReady === true && !!window.__prizeStand', { timeout: 40000 });
  await page.click('#playBtn');
  await wait(1800);

  await page.evaluate(() => {
    const view = window.__clawView;
    const tpl = view.toys.templates.find((item) => item.name === 'Сердце-подушка');
    const toy = view.toys.spawnTemplate(tpl, 0, view.toys.delivery.floorY + tpl.r + 0.035, 3.15, { color: 0xe2a3ae, yaw: 0 });
    view.toys.floorCount++;
    toy.onFloor = true;
    toy.scored = true;
    toy.body.velocity.set(0, 0, 0);
    toy.body.angularVelocity.set(0, 0, 0);
    toy.body.wakeUp();
    toy.mesh.position.copy(toy.body.position);
    toy.mesh.quaternion.copy(toy.body.quaternion);

    view.controls.autoRotate = false;
    view.camera.position.set(4.5, 1.2, 10.0);
    view.controls.target.set(-1.0, -0.72, 2.9);
    view.controls.update();
  });
  await wait(450);

  const points = await page.evaluate(() => {
    const view = window.__clawView;
    const toy = view.toys.toys.find((candidate) => candidate.onFloor && !candidate.onStand);
    const slot = view.prizeStand.slots[1];
    const V3 = view.camera.position.constructor;
    const project = (v) => {
      const p = v.project(view.camera);
      return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
    };
    return {
      start: project(new V3(toy.body.position.x, toy.body.position.y, toy.body.position.z)),
      end: project(new V3(slot.x, view.toys.delivery.floorY + toy.r + 0.15, slot.z)),
    };
  });
  for (const point of [points.start, points.end]) {
    if (point.x < 0 || point.x > 390 || point.y < 0 || point.y > 844) throw new Error(`Touch point is outside viewport: ${JSON.stringify(point)}`);
  }

  const touch = await page.touchscreen.touchStart(points.start.x, points.start.y);
  await wait(120);
  const grabbed = await page.evaluate(() => ({
    active: !!window.__prizeDrag.active,
    controls: window.__clawView.controls.enabled,
    hint: getComputedStyle(document.getElementById('prizeDragHint')).display,
    standCollision: !!(window.__prizeDrag.active?.toy.body.collisionFilterMask & 8),
  }));
  for (let i = 1; i <= 24; i++) {
    const k = i / 24;
    await touch.move(
      points.start.x + (points.end.x - points.start.x) * k,
      points.start.y + (points.end.y - points.start.y) * k
    );
  }
  await wait(450);
  const preview = await page.evaluate(() => window.__prizeStand.previewSlot?.index ?? -1);
  await touch.end();
  await wait(350);
  const placed = await page.evaluate(() => ({
    count: window.__prizeStand.count,
    onStand: window.__clawView.toys.toys.some((toy) => toy.onStand),
    controls: window.__clawView.controls.enabled,
    hint: getComputedStyle(document.getElementById('prizeDragHint')).display,
  }));

  const tierPoints = await page.evaluate(() => {
    const view = window.__clawView;
    const toy = view.toys.toys.find((candidate) => candidate.onStand);
    const V3 = view.camera.position.constructor;
    const project = (v) => {
      const p = v.project(view.camera);
      return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
    };
    return {
      start: project(new V3(toy.body.position.x, toy.body.position.y + 0.08, toy.body.position.z)),
    };
  });
  const tierTouch = await page.touchscreen.touchStart(tierPoints.start.x, tierPoints.start.y);
  await wait(120);
  const lowerGrab = await page.evaluate(() => ({
    active: !!window.__prizeDrag.active,
    standCollision: !!(window.__prizeDrag.active?.toy.body.collisionFilterMask & 8),
  }));
  const tierEnd = await page.evaluate(() => {
    const view = window.__clawView;
    const upper = view.prizeStand.slots[5];
    const V3 = view.camera.position.constructor;
    const dragY = -view.prizeDrag.dragPlane.constant;
    const p = new V3(upper.x, dragY, upper.z).project(view.camera);
    return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
  });
  for (let i = 1; i <= 28; i++) {
    const k = i / 28;
    await tierTouch.move(
      tierPoints.start.x + (tierEnd.x - tierPoints.start.x) * k,
      tierPoints.start.y + (tierEnd.y - tierPoints.start.y) * k
    );
  }
  await wait(420);
  const upperPreview = await page.evaluate(() => window.__prizeStand.previewSlot?.index ?? -1);
  await tierTouch.end();
  await wait(360);
  const movedToUpper = await page.evaluate(() => {
    const toy = window.__clawView.toys.toys.find((candidate) => candidate.onStand);
    return { slot: toy?.standSlot ?? -1, mask: toy?.body.collisionFilterMask ?? null };
  });
  await page.screenshot({ path: 'shots/prize-touch-stand.png' });

  const cameraBefore = await page.evaluate(() => window.__clawView.camera.position.toArray());
  const orbit = await page.touchscreen.touchStart(340, 300);
  await orbit.move(295, 255);
  await orbit.end();
  await wait(350);
  const orbitDelta = await page.evaluate((before) => Math.hypot(
    ...window.__clawView.camera.position.toArray().map((value, index) => value - before[index])
  ), cameraBefore);
  await page.evaluate(() => window.__prizeStand.clear());

  const result = { points, grabbed, preview, placed, tierPoints, lowerGrab, tierEnd, upperPreview, movedToUpper, orbitDelta };
  console.log(JSON.stringify(result, null, 2));
  if (!grabbed.active || grabbed.controls || grabbed.hint !== 'block' || grabbed.standCollision) throw new Error('Touch did not grab the prize without stand collisions');
  if (preview !== 1) throw new Error('Touch did not preview the stand slot');
  if (placed.count !== 1 || !placed.onStand || !placed.controls || placed.hint !== 'none') throw new Error('Touch did not place the prize');
  if (!lowerGrab.active || lowerGrab.standCollision || upperPreview !== 5 || movedToUpper.slot !== 5 || movedToUpper.mask !== 0) throw new Error('Prize lagged or failed while moving from lower to upper stand tier');
  if (orbitDelta < 0.02) throw new Error('Empty-canvas touch no longer rotates the camera');
} finally {
  await browser.close();
}
