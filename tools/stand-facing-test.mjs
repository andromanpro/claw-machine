import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { findBrowser } from './browser.mjs';
import { withVite } from './server.mjs';

await withVite(async (url) => {
  const browser = await puppeteer.launch({
    executablePath: findBrowser(), headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1440, height: 1000 },
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('claw-settings-v1', JSON.stringify({ gameMode: 'fugitives', sound: false, freePlay: true, graphics: 'balanced' }));
    });
    async function ready() {
      await page.waitForFunction(() => window.__clawReady === true, { timeout: 60000 });
    }
    async function inspect() {
      return page.evaluate(() => {
        const view = window.__clawView;
        for (let i = 0; i < 45; i++) view.toys.update(1 / 60, i / 60);
        view.scene.updateMatrixWorld(true);
        return view.prizeStand.slots.filter(slot => slot.toy).map(slot => {
          const toy = slot.toy;
          const model = toy.mesh.userData.detailedFugitive?.model ?? toy.mesh.userData.fugitiveRig.rig;
          const quaternion = model.getWorldQuaternion(model.quaternion.clone());
          const forward = model.position.clone().set(0, 0, 1).applyQuaternion(quaternion);
          const dx = 3 - toy.body.position.x;
          const dz = 6.05 - toy.body.position.z;
          return { name: toy.name, slot: slot.index, facing: (forward.x * dx + forward.z * dz) / Math.hypot(dx, dz), localYaw: model.rotation.y };
        });
      });
    }
    function check(rows, stage) {
      assert.equal(rows.length, 6, stage + ': collection lost a character');
      assert.ok(rows.every(row => row.facing > .9), stage + ': character faces away from the player: ' + JSON.stringify(rows));
    }

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await ready();
    await page.evaluate(async () => {
      const view = window.__clawView;
      const { createFugitiveTemplates } = await import('/src/fugitives.js');
      const templates = [...view.toys.templates, createFugitiveTemplates()[0]];
      for (let i = 0; i < templates.length; i++) {
        const toy = view.toys.spawnTemplate(templates[i], 0, 1, 0);
        toy.scored = true;
        toy.onFloor = true;
        toy.ai.visualYaw = i * 1.1 + .4;
        const detailed = toy.mesh.userData.detailedFugitive;
        if (detailed) {
          detailed.visualYaw = i * 1.1 + .4;
          detailed.model.rotation.y = Math.PI + detailed.visualYaw;
        } else toy.mesh.userData.fugitiveRig.rig.rotation.y = toy.ai.visualYaw;
        view.prizeStand.placeInSlot(toy, view.prizeStand.slots[i]);
      }
      view.prizeStand.save();
      view.prizeStand.refresh();
    });
    const placed = await inspect();
    check(placed, 'placement');

    await page.evaluate(() => {
      const view = window.__clawView;
      const toy = view.prizeStand.slots[0].toy;
      view.prizeStand.beginDrag(toy);
      toy.mesh.userData.detailedFugitive.visualYaw = 1.6;
      view.prizeStand.placeInSlot(toy, view.prizeStand.slots[6]);
      view.prizeStand.save();
      view.prizeStand.refresh();
    });
    const moved = await inspect();
    check(moved, 'moving between shelves');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    const restored = await inspect();
    check(restored, 'restoring the saved collection');

    await page.keyboard.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 1800));
    await page.evaluate(() => {
      const view = window.__clawView;
      view.camera.position.set(-1, .82, 6.85);
      view.controls.target.set(-2.55, -.52, 2.92);
      view.controls.update();
    });
    await fs.mkdir('shots', { recursive: true });
    await page.screenshot({ path: 'shots/stand-facing.png' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ placed, moved, restored, errors }, null, 2));
  } finally { await browser.close(); }
});
