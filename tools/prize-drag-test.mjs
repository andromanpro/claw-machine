import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

import { findBrowser } from './browser.mjs';

const CHROME = findBrowser();
const URL = 'http://localhost:5273/';
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

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__clawReady === true && !!window.__prizeDrag', { timeout: 40000 });
await page.keyboard.press('Enter');
// Стартовый flyTo длится 1.4с; оставляем запас, чтобы его последний кадр не
// перезаписал тестовую камеру и не уронил проекцию игрушки ниже viewport.
await wait(1800);

await page.evaluate(() => {
  const view = window.__clawView;
  const toy = view.toys.toys[0];
  if (!toy.onFloor) view.toys.floorCount++;
  toy.onFloor = true;
  toy.scored = true;
  toy.deliver = null;
  toy.body.type = 1; // CANNON.Body.DYNAMIC
  toy.body.collisionFilterGroup = 1;
  toy.body.collisionFilterMask = -1;
  toy.body.updateMassProperties();
  toy.body.position.set(0, view.toys.delivery.floorY + toy.r + 0.035, 2.05);
  toy.body.velocity.set(0, 0, 0);
  toy.body.angularVelocity.set(0, 0, 0);
  toy.body.quaternion.set(0, 0, 0, 1);
  toy.body.wakeUp();
  toy.mesh.position.copy(toy.body.position);
  toy.mesh.quaternion.copy(toy.body.quaternion);

  view.controls.autoRotate = false;
  view.camera.position.set(3.2, 0.55, 5.3);
  view.controls.target.set(0, -1.08, 2.0);
  view.controls.update();
});
await wait(450);

const start = await page.evaluate(() => {
  const view = window.__clawView;
  const toy = view.toys.toys.find((candidate) => candidate.onFloor);
  const V3 = view.camera.position.constructor;
  const p = new V3(toy.body.position.x, toy.body.position.y, toy.body.position.z).project(view.camera);
  return {
    name: toy.name,
    world: [toy.body.position.x, toy.body.position.y, toy.body.position.z],
    screen: [(p.x + 1) * innerWidth / 2, (1 - p.y) * innerHeight / 2],
    hint: getComputedStyle(document.getElementById('prizeDragHint')).display,
  };
});

if (start.screen[0] < 0 || start.screen[0] > 1280 || start.screen[1] < 0 || start.screen[1] > 800) {
  throw new Error(`Prize projection is outside viewport: ${JSON.stringify(start.screen)}`);
}

await page.mouse.move(start.screen[0], start.screen[1]);
await wait(120);
await page.mouse.down();
await wait(160);
const grabbed = await page.evaluate(() => ({
  active: !!window.__prizeDrag.active,
  cursor: window.__clawView.renderer.domElement.style.cursor,
  controlsEnabled: window.__clawView.controls.enabled,
}));

await page.mouse.move(start.screen[0] + 190, start.screen[1] - 45, { steps: 18 });
await wait(500);
await page.screenshot({ path: 'shots/prize-drag-test.png' });
await page.mouse.up();
await wait(700);

const finish = await page.evaluate(() => {
  const view = window.__clawView;
  const toy = view.toys.toys.find((candidate) => candidate.onFloor);
  return {
    world: [toy.body.position.x, toy.body.position.y, toy.body.position.z],
    active: !!window.__prizeDrag.active,
    controlsEnabled: view.controls.enabled,
    hint: getComputedStyle(document.getElementById('prizeDragHint')).display,
  };
});

await browser.close();
const delta = Math.hypot(finish.world[0] - start.world[0], finish.world[2] - start.world[2]);
const result = { start, grabbed, finish, horizontalDelta: +delta.toFixed(3) };
console.log(JSON.stringify(result, null, 2));

if (!grabbed.active || grabbed.cursor !== 'grabbing' || grabbed.controlsEnabled) process.exitCode = 1;
if (finish.active || !finish.controlsEnabled || finish.hint !== 'block' || delta < 0.22) process.exitCode = 1;
