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

try {
  await page.goto('http://127.0.0.1:5273/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__clawReady === true && !!window.__prizeStand', { timeout: 40000 });
  await page.keyboard.press('Enter');
  await wait(1800);

  const structure = await page.evaluate(() => ({
    slots: window.__prizeStand.slots.length,
    rows: [...new Set(window.__prizeStand.slots.map((slot) => slot.row))].length,
    marquee: !!window.__clawView.scene.getObjectByName('cabinetMarquee'),
  }));

  await page.evaluate(() => {
    const view = window.__clawView;
    const tpl = view.toys.templates.find((item) => item.name === 'Сердце-подушка');
    view.toys.spawnTemplate(tpl, 0, view.toys.delivery.floorY + tpl.r + 0.035, 3.15, { yaw: 0 });
    const toy = view.toys.toys.at(-1);
    view.toys.floorCount++;
    toy.onFloor = true;
    toy.scored = true;
    toy.deliver = null;
    toy.body.type = 1;
    toy.body.collisionFilterGroup = 1;
    toy.body.collisionFilterMask = -1;
    toy.body.updateMassProperties();
    toy.body.position.set(0, view.toys.delivery.floorY + toy.r + 0.035, 3.15);
    toy.body.velocity.set(0, 0, 0);
    toy.body.angularVelocity.set(0, 0, 0);
    toy.body.quaternion.set(0, 0, 0, 1);
    toy.body.wakeUp();
    toy.mesh.position.copy(toy.body.position);
    toy.mesh.quaternion.copy(toy.body.quaternion);

    view.controls.autoRotate = false;
    view.camera.position.set(3.3, 0.72, 6.1);
    view.controls.target.set(-0.85, -0.78, 2.72);
    view.controls.update();
  });
  await wait(450);

  const project = async (kind) => page.evaluate((wanted) => {
    const view = window.__clawView;
    const toy = view.toys.toys.find((candidate) => candidate.onFloor && !candidate.onStand);
    const slot = view.prizeStand.slots[1];
    const V3 = view.camera.position.constructor;
    const world = wanted === 'toy'
      ? new V3(toy.body.position.x, toy.body.position.y, toy.body.position.z)
      : new V3(slot.x, view.toys.delivery.floorY + toy.r + 0.15, slot.z);
    const p = world.project(view.camera);
    return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
  }, kind);

  const start = await project('toy');
  const slot = await project('slot');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await wait(120);
  await page.mouse.move(slot.x, slot.y, { steps: 28 });
  await wait(500);
  const preview = await page.evaluate(() => ({
    active: !!window.__prizeDrag.active,
    slot: window.__prizeStand.previewSlot?.index ?? -1,
  }));
  await page.mouse.up();
  await wait(350);

  const placed = await page.evaluate(() => {
    const stand = window.__prizeStand;
    const toy = stand.slots.find((candidate) => candidate.toy)?.toy;
    return {
      count: stand.count,
      onStand: !!toy?.onStand,
      slot: toy?.standSlot ?? -1,
      bodyType: toy?.body.type ?? -1,
      name: toy?.name ?? null,
      color: toy?.variantColor ?? null,
      stored: JSON.parse(localStorage.getItem('claw-prize-collection-v1') ?? '[]'),
      labelUpdated: stand.labelCanvas.getContext('2d') !== null,
      position: toy ? [toy.body.position.x, toy.body.position.y, toy.body.position.z] : null,
      visualScale: toy?.standVisualScale ?? null,
      fit: toy?.standFit ?? null,
    };
  });
  await page.screenshot({ path: 'shots/prize-stand.png' });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__clawReady === true && !!window.__prizeStand', { timeout: 40000 });
  await page.keyboard.press('Enter');
  await wait(1800);
  await page.evaluate(() => {
    const view = window.__clawView;
    view.controls.autoRotate = false;
    view.camera.position.set(3.3, 0.72, 6.1);
    view.controls.target.set(-0.85, -0.78, 2.72);
    view.controls.update();
  });
  await wait(300);
  const restored = await page.evaluate(() => {
    const stand = window.__prizeStand;
    const toy = stand.slots.find((candidate) => candidate.toy)?.toy;
    return {
      count: stand.count,
      name: toy?.name ?? null,
      color: toy?.variantColor ?? null,
      onStand: !!toy?.onStand,
      bodyType: toy?.body.type ?? -1,
    };
  });
  await page.screenshot({ path: 'shots/prize-stand-restored.png' });

  const mounted = await page.evaluate(() => {
    const view = window.__clawView;
    const toy = view.prizeStand.slots.find((candidate) => candidate.toy)?.toy;
    const V3 = view.camera.position.constructor;
    const p = new V3(toy.body.position.x, toy.body.position.y, toy.body.position.z).project(view.camera);
    return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
  });
  const floorDest = await page.evaluate(() => {
    const view = window.__clawView;
    const toy = view.prizeStand.slots.find((candidate) => candidate.toy)?.toy;
    const V3 = view.camera.position.constructor;
    const p = new V3(0.25, view.toys.delivery.floorY + toy.r + 0.15, 3.55).project(view.camera);
    return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
  });
  await page.mouse.move(mounted.x, mounted.y);
  await page.mouse.down();
  await wait(120);
  await page.mouse.move(floorDest.x, floorDest.y, { steps: 28 });
  await wait(350);
  await page.mouse.up();
  await wait(450);
  const removed = await page.evaluate(() => ({
    count: window.__prizeStand.count,
    onStand: window.__clawView.toys.toys.some((toy) => toy.onStand),
    controls: window.__clawView.controls.enabled,
    stored: JSON.parse(localStorage.getItem('claw-prize-collection-v1') ?? '[]'),
  }));

  await page.evaluate(() => {
    const stand = window.__prizeStand;
    const toy = window.__clawView.toys.toys.find((candidate) => candidate.onFloor && !candidate.onStand);
    stand.tryPlace(toy, stand.slots[0]);
  });
  await page.click('#gearBtn');
  await wait(120);
  await page.click('#clearCollectionBtn');
  await wait(120);
  const cleared = await page.evaluate(() => ({
    count: window.__prizeStand.count,
    stored: JSON.parse(localStorage.getItem('claw-prize-collection-v1') ?? '[]'),
    button: document.getElementById('clearCollectionBtn').textContent,
  }));
  await page.click('#closeSettings');
  await wait(360);

  const autoCollected = await page.evaluate(() => {
    const view = window.__clawView;
    const stand = view.prizeStand;
    const tpl = view.toys.templates.find((item) => item.name === 'Мягкий мячик');
    view.toys.spawnTemplate(tpl, 0.1, view.toys.delivery.floorY + tpl.r + 0.04, 3.2, { yaw: 0 });
    const toy = view.toys.toys.at(-1);
    toy.onFloor = true;
    toy.scored = true;
    toy.deliver = null;
    toy.autoStandAge = stand.autoCollectDelay + 0.1;
    view.toys.floorCount++;
    for (let i = 0; i < 90; i++) stand.update(i / 60, 1 / 60, null);
    const slot = stand.slots.find((candidate) => candidate.toy === toy);
    return {
      count: stand.count,
      slot: slot?.index ?? -1,
      onStand: !!toy.onStand,
      transferring: !!toy.autoTransferring || !!stand.autoTransfer,
      stored: JSON.parse(localStorage.getItem('claw-prize-collection-v1') ?? '[]'),
    };
  });

  const upperFit = await page.evaluate(() => {
    const view = window.__clawView;
    const stand = view.prizeStand;
    const tpl = view.toys.templates.find((item) => item.name === 'Гигантский мишка');
    const slot = stand.slots[4];
    const toy = view.toys.spawnTemplate(tpl, slot.x, slot.y + tpl.r, slot.z, { yaw: 0 });
    toy.onFloor = true;
    toy.scored = true;
    view.toys.floorCount++;
    stand.tryPlace(toy, slot);
    return { scale: toy.standVisualScale, fit: toy.standFit, slot: toy.standSlot };
  });

  await page.click('#gearBtn');
  await wait(360);
  const standFlagSelector = '[data-setting="prizeStand"] input[type="checkbox"]';
  const standFlagInitial = await page.$eval(standFlagSelector, (input) => input.checked);
  await page.$eval(standFlagSelector, (input) => input.click());
  await wait(220);
  const standDisabled = await page.evaluate(() => ({
    enabled: window.__prizeStand.enabled,
    groupVisible: window.__prizeStand.group.visible,
    mountedVisible: window.__prizeStand.slots.filter((slot) => slot.toy).map((slot) => slot.toy.mesh.visible),
    colliderMasks: window.__prizeStand.staticBodies.map((body) => body.collisionFilterMask),
    stored: JSON.parse(localStorage.getItem('claw-settings-v1') ?? '{}').prizeStand,
    focusButtonExists: !!document.getElementById('standFocusBtn'),
  }));
  await page.$eval(standFlagSelector, (input) => input.click());
  await wait(220);
  const standEnabled = await page.evaluate(() => ({
    enabled: window.__prizeStand.enabled,
    groupVisible: window.__prizeStand.group.visible,
    mountedVisible: window.__prizeStand.slots.filter((slot) => slot.toy).map((slot) => slot.toy.mesh.visible),
    colliderMasks: window.__prizeStand.staticBodies.map((body) => body.collisionFilterMask),
    stored: JSON.parse(localStorage.getItem('claw-settings-v1') ?? '{}').prizeStand,
  }));
  await page.click('#closeSettings');
  await wait(360);

  const physicalStandPoint = await page.evaluate(() => {
    const view = window.__clawView;
    const stand = view.prizeStand;
    const V3 = view.camera.position.constructor;
    const x = stand.slots.reduce((sum, slot) => sum + slot.x, 0) / stand.slots.length;
    const p = new V3(x, view.toys.delivery.floorY + 1.48, stand.slots[4].z - 0.28).project(view.camera);
    return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
  });
  await page.mouse.click(physicalStandPoint.x, physicalStandPoint.y);
  await wait(1000);
  const physicalFocused = await page.evaluate(() => ({
    active: document.body.classList.contains('stand-focus'),
    target: window.__clawView.controls.target.toArray(),
  }));
  await page.screenshot({ path: 'shots/prize-stand-focus.png' });
  const focusedStandPoint = await page.evaluate(() => {
    const view = window.__clawView;
    const stand = view.prizeStand;
    const V3 = view.camera.position.constructor;
    const x = stand.slots.reduce((sum, slot) => sum + slot.x, 0) / stand.slots.length;
    const p = new V3(x, view.toys.delivery.floorY + 1.48, stand.slots[4].z - 0.28).project(view.camera);
    return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
  });
  await page.mouse.click(focusedStandPoint.x, focusedStandPoint.y);
  await wait(900);
  const physicalReturned = await page.evaluate(() => ({
    active: document.body.classList.contains('stand-focus'),
    controls: window.__clawView.controls.enabled,
  }));
  await page.evaluate(() => window.__prizeStand.clear());

  const result = { structure, start, slot, preview, placed, restored, removed, cleared, autoCollected, upperFit, standFlagInitial, standDisabled, standEnabled, physicalStandPoint, physicalFocused, focusedStandPoint, physicalReturned };
  console.log(JSON.stringify(result, null, 2));
  if (structure.slots !== 8 || structure.rows !== 2 || !structure.marquee) throw new Error('Expanded stand or cabinet marquee is missing');
  if (!preview.active || preview.slot !== 1) throw new Error('Stand slot preview failed');
  if (placed.count !== 1 || !placed.onStand || placed.slot !== 1 || placed.bodyType !== 4 || placed.stored.length !== 1) throw new Error('Prize did not mount on stand');
  if (!placed.fit || placed.visualScale > 1 || placed.fit.width > placed.fit.maxWidth + 0.002 || placed.fit.height > placed.fit.maxHeight + 0.002 || placed.fit.depth > placed.fit.maxDepth + 0.002) throw new Error('Lower-tier prize does not fit its stand cell');
  if (restored.count !== 1 || !restored.onStand || restored.bodyType !== 4 || restored.name !== placed.name || restored.color !== placed.color) throw new Error('Stored prize did not survive reload');
  if (removed.count !== 0 || removed.onStand || !removed.controls || removed.stored.length !== 0) throw new Error('Prize could not be removed from stand');
  if (cleared.count !== 0 || cleared.stored.length !== 0 || !cleared.button.includes('очищен')) throw new Error('Collection clear button failed');
  if (autoCollected.count !== 1 || autoCollected.slot !== 0 || !autoCollected.onStand || autoCollected.transferring || autoCollected.stored.length !== 1) {
    throw new Error('Delayed automatic collection failed');
  }
  if (upperFit.slot !== 4 || upperFit.scale >= 1 || upperFit.fit.width > upperFit.fit.maxWidth + 0.002 || upperFit.fit.height > upperFit.fit.maxHeight + 0.002 || upperFit.fit.depth > upperFit.fit.maxDepth + 0.002) throw new Error('Large upper-tier prize does not fit its stand cell');
  if (!standFlagInitial || standDisabled.enabled || standDisabled.groupVisible || standDisabled.mountedVisible.some(Boolean) || standDisabled.colliderMasks.some(Boolean) || standDisabled.stored || standDisabled.focusButtonExists) throw new Error('Prize stand setting did not disable the whole mechanic');
  if (!standEnabled.enabled || !standEnabled.groupVisible || standEnabled.mountedVisible.some((visible) => !visible) || standEnabled.colliderMasks.some((mask) => mask !== 1) || !standEnabled.stored) throw new Error('Prize stand setting did not restore the mechanic');
  if (!physicalFocused.active || physicalFocused.target[0] > -2.4) throw new Error('Clicking the physical stand did not focus the camera');
  if (physicalReturned.active || !physicalReturned.controls) throw new Error('Clicking the focused stand did not return to the machine');
} finally {
  await browser.close();
}
