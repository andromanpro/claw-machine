// Проверяет связность деталей каждой процедурной игрушки по мировым AABB.
// Компонент считается прикреплённым, если он касается другой детали или
// находится от неё не дальше малого допуска для шва/нашивки.
import puppeteer from 'puppeteer-core';

import { findBrowser } from './browser.mjs';

const CHROME = findBrowser();
const BASE = 'http://localhost:5273/inspect.html';
const CONNECT_GAP = 0.012;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-position=-32000,-32000', '--start-minimized'],
  defaultViewport: { width: 800, height: 500 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(`${BASE}?list`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__inspectReady === true', { timeout: 20000 });
const names = await page.evaluate(() => window.__toyNames);
const failures = [];

for (const name of names) {
  await page.goto(`${BASE}?toy=${encodeURIComponent(name)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__inspectReady === true && !!window.__inspectToy', { timeout: 20000 });
  const result = await page.evaluate((connectGap) => {
    const toy = window.__inspectToy;
    const T = window.__inspectTHREE;
    toy.updateMatrixWorld(true);
    const meshes = [];
    toy.traverse((o) => {
      if (!o.isMesh || !o.visible || o.userData?.plushAux || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const box = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      const size = box.getSize(box.min.clone());
      meshes.push({
        o,
        box,
        volume: Math.max(1e-9, size.x * size.y * size.z),
        size,
      });
    });

    function axisGap(a0, a1, b0, b1) {
      if (a1 < b0) return b0 - a1;
      if (b1 < a0) return a0 - b1;
      return 0;
    }
    function gap(a, b) {
      return Math.hypot(
        axisGap(a.min.x, a.max.x, b.min.x, b.max.x),
        axisGap(a.min.y, a.max.y, b.min.y, b.max.y),
        axisGap(a.min.z, a.max.z, b.min.z, b.max.z)
      );
    }

    const links = meshes.map(() => []);
    for (let i = 0; i < meshes.length; i++) {
      for (let j = i + 1; j < meshes.length; j++) {
        if (gap(meshes[i].box, meshes[j].box) <= connectGap) {
          links[i].push(j);
          links[j].push(i);
        }
      }
    }

    let root = 0;
    for (let i = 1; i < meshes.length; i++) {
      if (meshes[i].volume > meshes[root].volume) root = i;
    }
    const attached = new Set([root]);
    const queue = [root];
    while (queue.length) {
      const i = queue.pop();
      for (const j of links[i]) {
        if (attached.has(j)) continue;
        attached.add(j);
        queue.push(j);
      }
    }

    const disconnected = meshes.map((m, i) => {
      if (attached.has(i)) return null;
      let nearest = Infinity;
      for (let j = 0; j < meshes.length; j++) {
        if (i !== j) nearest = Math.min(nearest, gap(m.box, meshes[j].box));
      }
      const center = m.box.getCenter(m.box.min.clone());
      const mats = Array.isArray(m.o.material) ? m.o.material : [m.o.material];
      return {
        index: i,
        name: m.o.name || '(unnamed)',
        gap: +nearest.toFixed(4),
        center: [center.x, center.y, center.z].map((v) => +v.toFixed(3)),
        size: [m.size.x, m.size.y, m.size.z].map((v) => +v.toFixed(3)),
        colors: mats.map((mat) => mat.color?.getHexString?.() ?? null),
      };
    }).filter(Boolean);

    // Дополнительная проверка по реальной поверхности. Луч идёт от центра
    // небольшой детали к центру каждой более крупной детали; расстояние до
    // первого пересечения сравнивается с толщиной самой детали в этом направлении.
    const ray = new T.Raycaster();
    const surfaceDetached = [];
    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      if (i === root || m.volume > meshes[root].volume * 0.72) continue;
      const center = m.box.getCenter(new T.Vector3());
      const half = m.size.clone().multiplyScalar(0.5);
      let best = Infinity;
      for (let j = 0; j < meshes.length; j++) {
        if (i === j || meshes[j].volume < m.volume * 1.2) continue;
        const target = meshes[j].box.getCenter(new T.Vector3());
        const dir = center.clone().sub(target);
        const distance = dir.length();
        if (distance < 1e-6) continue;
        dir.multiplyScalar(1 / distance);
        ray.set(target, dir);
        ray.near = 0;
        ray.far = distance + 0.5;
        const targetMats = Array.isArray(meshes[j].o.material) ? meshes[j].o.material : [meshes[j].o.material];
        const oldSides = targetMats.map((mat) => mat.side);
        for (const mat of targetMats) mat.side = T.DoubleSide;
        const hit = ray.intersectObject(meshes[j].o, false)[0];
        targetMats.forEach((mat, k) => { mat.side = oldSides[k]; });
        if (!hit) continue;
        const ownReach = Math.abs(dir.x) * half.x + Math.abs(dir.y) * half.y + Math.abs(dir.z) * half.z;
        best = Math.min(best, distance - hit.distance - ownReach);
      }
      if (best <= connectGap || !Number.isFinite(best)) continue;
      const mats = Array.isArray(m.o.material) ? m.o.material : [m.o.material];
      surfaceDetached.push({
        index: i,
        name: m.o.name || '(unnamed)',
        gap: +best.toFixed(4),
        center: [center.x, center.y, center.z].map((v) => +v.toFixed(3)),
        size: [m.size.x, m.size.y, m.size.z].map((v) => +v.toFixed(3)),
        colors: mats.map((mat) => mat.color?.getHexString?.() ?? null),
      });
    }

    const unique = new Map();
    for (const item of [...disconnected, ...surfaceDetached]) unique.set(item.index, item);
    return [...unique.values()].sort((a, b) => b.gap - a.gap);
  }, CONNECT_GAP);

  if (result.length) failures.push({ name, detached: result });
  console.log(`${result.length ? 'FAIL' : 'OK  '} ${name}${result.length ? `: ${result.length}` : ''}`);
}

await browser.close();
if (failures.length) {
  console.log('DETACHED_COMPONENTS:', JSON.stringify(failures, null, 2));
  process.exitCode = 1;
} else {
  console.log(`Все ${names.length} игрушек: оторванных компонентов не найдено.`);
}
