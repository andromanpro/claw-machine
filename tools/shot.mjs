// Скриншот + прогон геймплея через puppeteer-core (системный Chrome).
// Использование: node tools/shot.mjs [--play] [--audit] [--out=shots/name]
import puppeteer from 'puppeteer-core';

import { findBrowser } from './browser.mjs';

const CHROME = findBrowser();
const URL = 'http://localhost:5273/';
const args = process.argv.slice(2);
const DELIVERY_AUDIT = args.includes('--delivery-audit');
const PLAY = args.includes('--play');
const AUDIT = args.includes('--audit');
const DETAIL = args.includes('--detail');
const OUT = (args.find((a) => a.startsWith('--out=')) ?? '--out=shots/shot').split('=')[1];
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
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__clawReady === true', { timeout: 40000 });
await wait(1500); // attract: камера успевает поехать по орбите

await page.screenshot({ path: `${OUT}-0-attract.png` });
console.log(`saved ${OUT}-0-attract.png`);

async function setCamera(name, pos, target) {
  await page.evaluate(({ pos, target }) => {
    const view = window.__clawView;
    view.camera.position.set(pos[0], pos[1], pos[2]);
    view.controls.target.set(target[0], target[1], target[2]);
    view.controls.update();
  }, { pos, target });
  await wait(450);
  await page.screenshot({ path: `${OUT}-${name}.png` });
  console.log(`saved ${OUT}-${name}.png`);
}

if (AUDIT) {
  await page.keyboard.press('Enter');
  await wait(1800);
  await page.addStyleTag({ content: '.hud,#gearBtn,#helpBtn,#buildTag,#perfTag,#attract,#loader,#settingsPanel{display:none!important}' });
  const target = [0, 0.55, 0.18];
  await setCamera('audit-front', [0, 1.35, 6.2], target);
  await setCamera('audit-front-right', [3.4, 1.55, 5.35], target);
  await setCamera('audit-right-side', [6.2, 1.35, 0.18], target);
  await setCamera('audit-panel', [2.65, 1.05, 3.25], [0.05, -0.05, 1.45]);
  await setCamera('audit-top', [1.65, 6.5, 3.45], [0, 0.2, 0.25]);
}

if (DETAIL) {
  await page.keyboard.press('Enter');
  await wait(1800);
  await page.addStyleTag({ content: '.hud,#gearBtn,#helpBtn,#buildTag,#perfTag,#attract,#loader,#settingsPanel{display:none!important}' });
  await setCamera('detail-panel-close', [1.28, 0.58, 2.18], [-0.15, 0.13, 1.36]);
  await setCamera('detail-glass', [1.55, 1.55, 2.18], [0.18, 1.24, 1.25]);
  await setCamera('detail-toys', [0.95, 0.88, 2.02], [0.02, 0.38, 0.68]);
  await setCamera('detail-delivery-close', [1.18, -0.46, 2.25], [0.78, -0.78, 1.5]);
  await setCamera('detail-side', [-5.5, 0.98, 0.0], [-1.36, 0.12, 0.0]);

  await page.keyboard.down('ArrowRight');
  await wait(460);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowUp');
  await wait(360);
  await page.keyboard.up('ArrowUp');
  await wait(380);
  await setCamera('detail-mechanism', [0.72, 1.9, 1.75], [0.03, 2.13, -0.06]);
  await setCamera('detail-mechanism-inspect', [0.34, 1.74, 1.18], [0.02, 2.18, -0.02]);
  await setCamera('detail-trolley-close', [0.46, 2.3, 0.72], [0.01, 2.32, -0.01]);
  await setCamera('detail-claw-close', [0.42, 1.72, 0.76], [0.01, 1.8, -0.01]);
  await setCamera('detail-rope-close', [1.05, 2.18, 2.0], [0.02, 1.55, -0.05]);
}

if (DELIVERY_AUDIT) {
  await page.keyboard.press('Enter');
  await wait(1200);
  await page.addStyleTag({ content: '.hud,#gearBtn,#helpBtn,#buildTag,#perfTag,#attract,#loader,#settingsPanel{display:none!important}' });
  await page.evaluate(() => {
    const manager = window.__claw.toys;
    const toy = manager.toys.find((candidate) => !candidate.scored);
    const route = manager.delivery.routeIn;
    toy.body.position.set(route.x, route.y - 0.62, route.z - 0.34);
    toy.body.velocity.set(0, 0, 0);
    toy.body.angularVelocity.set(0, 0, 0);
    toy.scored = true;
    toy.prizeEligible = false;
    manager.startDelivery(toy);
  });
  await setCamera('delivery-ready', [1.48, -0.28, 2.32], [0.76, -0.75, 1.48]);
  for (const phase of ['open', 'route', 'eject']) {
    await page.waitForFunction(
      (wanted) => window.__claw?.toys?.toys?.some((toy) => toy.deliver?.phase === wanted),
      { timeout: 8000 },
      phase
    );
    await wait(phase === 'open' ? 120 : 40);
    const state = await page.evaluate(() => {
      const manager = window.__claw.toys;
      const toy = manager.toys.find((candidate) => candidate.deliver);
      return {
        phase: toy?.deliver?.phase,
        lidT: Number(manager.lidT.toFixed(3)),
        position: toy ? [toy.body.position.x, toy.body.position.y, toy.body.position.z].map((v) => Number(v.toFixed(3))) : null,
      };
    });
    const file = `${OUT}-delivery-${phase}.png`;
    await page.screenshot({ path: file });
    console.log(`saved ${file}`, JSON.stringify(state));
  }
  await wait(750);
  await page.screenshot({ path: `${OUT}-delivery-clear.png` });
  console.log(`saved ${OUT}-delivery-clear.png`);
}

if (PLAY) {
  // старт игры + перелёт камеры
  await page.keyboard.press('Enter');
  await wait(1800);

  // две монетки
  await page.keyboard.press('KeyM');
  await wait(1100);
  await page.keyboard.press('KeyM');
  await wait(600);
  await page.screenshot({ path: `${OUT}-1-coin.png` });
  console.log(`saved ${OUT}-1-coin.png`);

  const target = await page.evaluate(() => {
    const c = window.__claw;
    const x = -0.25;
    const z = -0.35;
    // Компактная сферическая цель делает полный delivery-тест независимым от
    // случайной формы кучи. Вытянутый динозаврик иногда задевал край шахты уже
    // после успешного хвата и создавал ложное падение теста.
    const tpl = c.toys.templates.find((item) => item.name === 'Мягкий мячик');
    if (!tpl) throw new Error('Playtest template not found');
    c.toys.spawnTemplate(tpl, x, 0.78, z, { yaw: 0 });
    const toy = c.toys.toys.at(-1);
    const y = 0.78;
    // Остальная случайная куча остаётся видимой и физической, но не толкает
    // контрольный мяч. Иначе редкий контакт уже над шахтой превращает проверку
    // state machine в лотерею раскладки игрушек.
    for (const other of c.toys.toys) {
      if (other !== toy) other.body.collisionFilterMask = 8;
    }
    toy.body.mass = 1;
    toy.body.updateMassProperties();
    toy.body.position.set(x, y, z);
    toy.body.velocity.set(0, 0, 0);
    toy.body.angularVelocity.set(0, 0, 0);
    toy.body.force.set(0, 0, 0);
    toy.body.torque.set(0, 0, 0);
    toy.body.wakeUp();
    c.keys.clear();
    c.panelInput.set(0, 0);
    c.pos.set(x, z);
    c.vel.set(0, 0);
    c.anchor.position.set(x, c.anchor.position.y, z);
    c.anchor.velocity.set(0, 0, 0);
    for (const b of c.ropeBodies) {
      b.position.x = x;
      b.position.z = z;
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
      b.force.set(0, 0, 0);
      b.torque.set(0, 0, 0);
    }
    c.headBody.position.x = x;
    c.headBody.position.z = z;
    c.headBody.velocity.set(0, 0, 0);
    c.headBody.angularVelocity.set(0, 0, 0);
    c.visualHead = null;
    c.pendingCapture = toy;
    const originalCanCaptureToy = c.canCaptureToy.bind(c);
    c.canCaptureToy = (candidate, grabPoint, slack = 0) =>
      candidate === toy || originalCanCaptureToy(candidate, grabPoint, slack);
    c.captureCandidates = () => [toy];
    c.latchCaptureCandidate = () => {
      c.pendingCapture = toy;
      return toy;
    };
    c.rollGrip = function rollPlaytestGrip() {
      this.gripPct = 100;
      this.grip = 180;
      this.jackpotHit = true;
      this.weakStreak = 0;
    };
    // Срыв по distance нужен живой игре, но не детерминированной проверке
    // полного маршрута уже принудительно выбранного тестового приза.
    c.weakenCheck = () => {};
    return {
      name: toy.name,
      x: x.toFixed(3),
      z: z.toFixed(3),
      y: y.toFixed(3),
    };
  });
  console.log('TARGET:', JSON.stringify(target));
  await page.screenshot({ path: `${OUT}-2-swing.png` });
  console.log(`saved ${OUT}-2-swing.png`);
  const swing = await page.evaluate(() => {
    const c = window.__claw;
    if (!c) return null;
    return {
      headSwayX: (c.headBody.position.x - c.pos.x).toFixed(3),
      headY: c.headBody.position.y.toFixed(3),
      held: c.held.length,
    };
  });
  console.log('SWING:', JSON.stringify(swing));

  // хват на качающейся клешне
  await page.keyboard.press('Space');
  await wait(2400);
  await page.screenshot({ path: `${OUT}-3-grab.png` });
  console.log(`saved ${OUT}-3-grab.png`);

  await wait(4500);
  await page.screenshot({ path: `${OUT}-4-carry.png` });
  console.log(`saved ${OUT}-4-carry.png`);

  await page.waitForFunction(() => {
    const c = window.__claw;
    return c && c.state === 0 && c.tries > 0;
  }, { timeout: 16000 });
  const state = await page.evaluate(() => ({
    credits: document.getElementById('credits')?.textContent,
    tries: document.getElementById('tries')?.textContent,
    wins: document.getElementById('wins')?.textContent,
    status: document.getElementById('status')?.textContent,
  }));
  console.log('STATE:', JSON.stringify(state));
  if (Number(state.wins) < 1) throw new Error(`Playtest did not deliver a prize: ${JSON.stringify(state)}`);
  await page.waitForFunction(() => !window.__prizeMoment?.active, { timeout: 10000 });

  // панель настроек
  await page.click('#gearBtn');
  await wait(500);
  await page.screenshot({ path: `${OUT}-5-settings.png` });
  console.log(`saved ${OUT}-5-settings.png`);
  const toggles = await page.evaluate(() =>
    [...document.querySelectorAll('#optList .opt')].map((o) => {
      const input = o.querySelector('input');
      const select = o.querySelector('select');
      if (input) return `${o.textContent.trim()}=${input.checked}`;
      if (select) return `${o.textContent.trim()}=${select.value}`;
      return o.textContent.trim();
    })
  );
  console.log('SETTINGS:', JSON.stringify(toggles));
}

await browser.close();
