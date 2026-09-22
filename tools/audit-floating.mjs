import puppeteer from 'puppeteer-core';

import { findBrowser } from './browser.mjs';

const CHROME = findBrowser();
const URL = 'http://localhost:5273/?gfx=fast&bg=white&noToys=1&auditFloating=1';
const OUT = 'shots/floating';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-position=-32000,-32000', '--start-minimized', '--window-size=1280,800', '--hide-scrollbars'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[claw]') || m.type() === 'error') console.log('PAGE:', t);
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__clawReady === true', { timeout: 40000 });
await page.keyboard.press('Enter');
await wait(1200);

const candidates = await page.evaluate(() => {
  const view = window.__clawView;
  const V3 = view.camera.position.constructor;
  const items = [];
  view.scene.updateMatrixWorld(true);

  function worldBox(o) {
    if (!o.geometry) return null;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    const pts = [
      [bb.min.x, bb.min.y, bb.min.z], [bb.min.x, bb.min.y, bb.max.z],
      [bb.min.x, bb.max.y, bb.min.z], [bb.min.x, bb.max.y, bb.max.z],
      [bb.max.x, bb.min.y, bb.min.z], [bb.max.x, bb.min.y, bb.max.z],
      [bb.max.x, bb.max.y, bb.min.z], [bb.max.x, bb.max.y, bb.max.z],
    ].map(([x, y, z]) => new V3(x, y, z).applyMatrix4(o.matrixWorld));
    const min = new V3(Infinity, Infinity, Infinity);
    const max = new V3(-Infinity, -Infinity, -Infinity);
    for (const p of pts) {
      min.min(p);
      max.max(p);
    }
    return { min, max, size: new V3().subVectors(max, min), center: new V3().addVectors(min, max).multiplyScalar(0.5) };
  }

  view.scene.traverse((o) => {
    if (!o.isMesh || !o.visible || o.userData?.plushAux) return;
    const box = worldBox(o);
    if (!box) return;
    const volume = box.size.x * box.size.y * box.size.z;
    if (volume <= 0 || box.center.y < -1.45) return;
    items.push({ o, box, volume });
  });

  const solids = items.filter((it) =>
    it.volume > 0.01 ||
    it.box.size.x > 0.6 ||
    it.box.size.y > 0.6 ||
    it.box.size.z > 0.6
  );

  function gap1d(aMin, aMax, bMin, bMax) {
    if (aMax < bMin) return bMin - aMax;
    if (bMax < aMin) return aMin - bMax;
    return 0;
  }

  function supportGap(a, b) {
    return Math.hypot(
      gap1d(a.min.x, a.max.x, b.min.x, b.max.x),
      gap1d(a.min.y, a.max.y, b.min.y, b.max.y),
      gap1d(a.min.z, a.max.z, b.min.z, b.max.z)
    );
  }

  function isExterior(box) {
    return (
      box.center.z > 0.88 ||
      Math.abs(box.center.x) > 1.42 ||
      (box.center.y > 2.48 && box.center.z > 0.55)
    );
  }

  function isExpectedFloatingControl(it) {
    return (
      it.o.name === 'panelJoystickKnob' ||
      it.o.name === 'panelGrabButton' ||
      it.o.name === 'panelGrabButtonRing' ||
      it.o.name === 'interiorLampTrim'
    );
  }

  return items
    .filter((it) => it.volume < 0.035)
    .filter((it) => isExterior(it.box) && !isExpectedFloatingControl(it))
    .map((it) => {
      let nearest = Infinity;
      let nearestLarge = null;
      for (const s of solids) {
        if (s === it) continue;
        const d = supportGap(it.box, s.box);
        if (d < nearest) {
          nearest = d;
          nearestLarge = s;
        }
      }
      const mats = Array.isArray(it.o.material) ? it.o.material : [it.o.material];
      return {
        name: it.o.name || '(unnamed)',
        uuid: it.o.uuid,
        pos: {
          x: +it.box.center.x.toFixed(3),
          y: +it.box.center.y.toFixed(3),
          z: +it.box.center.z.toFixed(3),
        },
        size: {
          x: +it.box.size.x.toFixed(3),
          y: +it.box.size.y.toFixed(3),
          z: +it.box.size.z.toFixed(3),
        },
        gap: +nearest.toFixed(3),
        nearest: nearestLarge ? {
          pos: {
            x: +nearestLarge.box.center.x.toFixed(3),
            y: +nearestLarge.box.center.y.toFixed(3),
            z: +nearestLarge.box.center.z.toFixed(3),
          },
          size: {
            x: +nearestLarge.box.size.x.toFixed(3),
            y: +nearestLarge.box.size.y.toFixed(3),
            z: +nearestLarge.box.size.z.toFixed(3),
          },
        } : null,
        color: mats.map((m) => m.color?.getHexString?.() ?? null),
        emissive: mats.map((m) => m.emissive?.getHexString?.() ?? null),
      };
    })
    .filter((it) => it.gap > 0.035)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 80);
});

console.log('FLOATING_CANDIDATES:', JSON.stringify(candidates, null, 2));

async function setCamera(name, pos, target) {
  await page.evaluate(({ pos, target }) => {
    const view = window.__clawView;
    view.camera.position.set(...pos);
    view.controls.target.set(...target);
    view.controls.update();
  }, { pos, target });
  await wait(450);
  await page.screenshot({ path: `${OUT}-${name}.png` });
  console.log(`saved ${OUT}-${name}.png`);
}

await page.addStyleTag({ content: '.hud,#gearBtn,#helpBtn,#buildTag,#perfTag,#attract,#loader,#settingsPanel{display:none!important}' });
await setCamera('strict-right', [6.8, 1.55, 1.35], [0, 0.5, 0.2]);
await setCamera('upper-side', [5.8, 2.7, 2.9], [0.25, 1.7, 1.15]);
await setCamera('panel-side', [4.0, 1.0, 3.2], [0.05, -0.22, 1.48]);
await setCamera('front-right', [3.4, 1.55, 5.35], [0, 0.55, 0.18]);

await browser.close();
