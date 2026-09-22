// Ускоренный stress/fuzz-прогон: реальные шаги физики без ожидания wall-clock.
import puppeteer from 'puppeteer-core';

import { findBrowser } from './browser.mjs';

const CHROME = findBrowser();
const URL = 'http://127.0.0.1:5273/?noToys&stress=1&lite=1';
const SEED = Number((process.argv.find((arg) => arg.startsWith('--seed=')) ?? '--seed=67').split('=')[1]) >>> 0;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-position=-32000,-32000', '--start-minimized'],
  defaultViewport: { width: 960, height: 640 },
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.evaluateOnNewDocument((seed) => {
    let state = seed || 1;
    Math.random = () => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let value = Math.imul(state ^ (state >>> 15), 1 | state);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    localStorage.setItem('claw-settings-v1', JSON.stringify({
      refill: false,
      sound: false,
      graphics: 'fast',
    }));
  }, SEED);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__clawReady === true && !!window.__clawStress', { timeout: 40000 });

  const report = await page.evaluate((seed) => {
    const claw = window.__claw;
    const stress = window.__clawStress;
    const { toys, scene } = window.__clawView;
    const world = claw.world;
    const wins = [];
    toys.onWin = (toy, { trick = false } = {}) => {
      toy.__stressWinCount = (toy.__stressWinCount ?? 0) + 1;
      if (toy.__stressWinCount > 1) throw new Error(`${toy.name}: prize counted more than once`);
      wins.push({ name: toy.name, trick });
      claw.wins++;
      return true;
    };
    claw.enabled = true;
    claw.hooks.gate = () => true;
    claw.hooks.onSpend = () => {};
    claw.hooks.onAttempt = () => {};

    const finite = (value) => Number.isFinite(value);
    const bodyFinite = (body) => [
      body.position.x, body.position.y, body.position.z,
      body.velocity.x, body.velocity.y, body.velocity.z,
      body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w,
      body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z,
    ].every(finite);
    const assertFiniteWorld = (label) => {
      const broken = world.bodies.filter((body) => !bodyFinite(body));
      if (broken.length) throw new Error(`${label}: ${broken.length} physics bodies contain NaN/Infinity`);
    };
    const cleanupToys = () => {
      if (claw.held.length) claw.dropAll(true);
      for (const toy of [...toys.toys]) {
        scene.remove(toy.mesh);
        world.removeBody(toy.body);
      }
      toys.toys.length = 0;
      toys.floorCount = 0;
      toys.lidT = 0;
    };
    const alignRig = (x, z, ropeLen = 0.82) => {
      claw.state = 0;
      claw.pos.set(x, z);
      claw.vel.set(0, 0);
      claw.ropeLen = ropeLen;
      claw.applyRopeLen();
      claw.anchor.position.set(x, 2.38, z);
      claw.anchor.velocity.set(0, 0, 0);
      const chain = [...claw.ropeBodies, claw.headBody];
      chain.forEach((body, index) => {
        body.position.set(x, 2.38 - ropeLen * ((index + 1) / chain.length), z);
        body.velocity.set(0, 0, 0);
        body.angularVelocity.set(0, 0, 0);
        body.force.set(0, 0, 0);
        body.torque.set(0, 0, 0);
      });
      claw.visualHead = null;
      claw.visualPalmReady = false;
      claw.palmBody.position.set(x, 2.38 - ropeLen - 0.48, z);
      stress.step(4);
    };
    const stepUntil = (predicate, limit, label, details = null) => {
      for (let i = 0; i < limit; i++) {
        stress.step(1, i % 9 === 0 ? 1 / 45 : 1 / 60);
        if (predicate()) return i + 1;
      }
      const suffix = details ? `; ${JSON.stringify(details())}` : '';
      throw new Error(`${label}: timed out after ${limit} simulation steps${suffix}`);
    };

    // Численный взрыв верёвки должен быть погашен за один кадр.
    for (const [index, body] of [...claw.ropeBodies, claw.headBody].entries()) {
      body.velocity.set(70 - index * 3, 55 + index, -64 + index * 2);
    }
    claw.headBody.position.y = claw.anchor.position.y + 5;
    stress.step(1, 0.05);
    const ropeSpeeds = [...claw.ropeBodies, claw.headBody].map((body) => body.velocity.length());
    if (Math.max(...ropeSpeeds) > 7.001) throw new Error('rope stabilizer allowed excessive velocity');
    if (claw.headBody.position.y > claw.anchor.position.y - 0.019) throw new Error('rope head crossed its ceiling');
    assertFiniteWorld('rope explosion');

    // Пустые захваты из трёх точек: state machine всегда возвращается в IDLE.
    const emptySteps = [];
    for (const [x, z] of [[-0.9, -0.8], [0, 0], [0.9, 0.8]]) {
      alignRig(x, z, 0.36);
      claw.tryStart();
      emptySteps.push(stepUntil(() => claw.state === 0 && claw.tries > emptySteps.length, 900, 'empty attempt'));
      if (claw.held.length) throw new Error('empty attempt retained a toy');
    }

    // Разные коллайдеры и массы проходят GRAB → LIFT → CARRY → RELEASE → delivery.
    const names = ['Мягкий мячик', 'Звёздочка', 'Сердце-подушка', 'Китёнок', 'Золотой мишка', 'Гигантский мишка'];
    const deliverySteps = [];
    names.forEach((name, index) => {
      cleanupToys();
      const x = -0.82 + (index % 3) * 0.72;
      const z = -0.72 + Math.floor(index / 3) * 0.66;
      alignRig(x, z);
      const tpl = toys.templates.find((item) => item.name === name);
      if (!tpl) throw new Error(`missing template ${name}`);
      const toy = toys.spawnTemplate(tpl, x, claw.palmBody.position.y - 0.2, z, { yaw: index * 0.37 });
      const originals = {
        canCaptureToy: claw.canCaptureToy,
        captureCandidates: claw.captureCandidates,
        latchCaptureCandidate: claw.latchCaptureCandidate,
        rollGrip: claw.rollGrip,
        weakenCheck: claw.weakenCheck,
      };
      claw.canCaptureToy = (candidate) => candidate === toy;
      claw.captureCandidates = () => [toy];
      claw.latchCaptureCandidate = () => (claw.pendingCapture = toy);
      claw.rollGrip = function rollStressGrip() {
        this.gripPct = 100;
        this.grip = 180;
        this.jackpotHit = true;
      };
      claw.weakenCheck = () => {};
      claw.pendingCapture = toy;
      claw.state = 3;
      claw.grabT = 1;
      stress.step(1);
      if (claw.held[0]?.toy !== toy) throw new Error(`${name}: capture failed`);
      const steps = stepUntil(
        () => claw.state === 0 && toy.onFloor && !toy.deliver,
        1500,
        `${name} delivery`,
        () => ({
          clawState: claw.state,
          held: claw.held.length,
          wins: claw.wins,
          position: [toy.body.position.x, toy.body.position.y, toy.body.position.z],
          velocity: [toy.body.velocity.x, toy.body.velocity.y, toy.body.velocity.z],
          scored: toy.scored,
          prizeEligible: toy.prizeEligible,
          onFloor: toy.onFloor,
          deliver: toy.deliver,
          inManager: toys.toys.includes(toy),
        })
      );
      deliverySteps.push({ name, steps, position: [toy.body.position.x, toy.body.position.y, toy.body.position.z] });
      Object.assign(claw, originals);
      if (!bodyFinite(toy.body)) throw new Error(`${name}: delivery produced invalid body state`);
      if (toy.body.position.z < toys.delivery.ejectPos.z - 0.25) throw new Error(`${name}: stopped behind the prize door`);
      assertFiniteWorld(name);
    });

    // Сильные случайные импульсы: кламп не даёт игрушкам туннелировать по X/Z.
    cleanupToys();
    toys.templates.forEach((tpl, index) => {
      const col = index % 6;
      const row = Math.floor(index / 6);
      const toy = toys.spawnTemplate(tpl, -0.95 + col * 0.32, 0.42 + row * 0.34, -0.72 + row * 0.5, { yaw: index });
      toy.body.velocity.set(((index * 17) % 23) - 11, 4 + (index % 5), ((index * 29) % 25) - 12);
      toy.body.angularVelocity.set(index * 0.7, -index * 0.45, index * 0.3);
    });
    let maxToyXZ = 0;
    for (let i = 0; i < 900; i++) {
      stress.step(1, i % 11 === 0 ? 0.05 : 1 / 90);
      maxToyXZ = toys.toys.reduce(
        (max, toy) => Math.max(max, Math.hypot(toy.body.velocity.x, toy.body.velocity.z)),
        maxToyXZ
      );
    }
    assertFiniteWorld('impulse fuzz');
    if (maxToyXZ > 5.501) throw new Error(`toy horizontal clamp failed: ${maxToyXZ}`);
    const impulseSurvivors = toys.toys.length;

    // Очередь из 18 призов одновременно проверяет люк, выкат и лимит пола.
    cleanupToys();
    toys.templates.forEach((tpl, index) => {
      const toy = toys.spawnTemplate(tpl, 0.72, -1.2 - index * 0.01, 0.72, { yaw: index * 0.2 });
      toy.scored = true;
      toys.startDelivery(toy);
    });
    stepUntil(() => toys.toys.every((toy) => !toy.deliver), 500, 'concurrent deliveries');
    stress.step(120);
    assertFiniteWorld('concurrent deliveries');
    if (toys.floorCount > 14 || toys.toys.length > 14) throw new Error(`floor prize cap failed: ${toys.floorCount}/${toys.toys.length}`);
    if (toys.lidT > 0.05) throw new Error(`prize door did not close: ${toys.lidT}`);

    const result = {
      seed,
      simulatedSeconds: Number(stress.elapsed.toFixed(2)),
      worldBodies: world.bodies.length,
      ropeMaxSpeed: Number(Math.max(...ropeSpeeds).toFixed(3)),
      emptySteps,
      deliverySteps,
      wins,
      impulseSurvivors,
      maxToyXZ: Number(maxToyXZ.toFixed(3)),
      concurrent: { floorCount: toys.floorCount, toys: toys.toys.length, lidT: Number(toys.lidT.toFixed(4)) },
    };
    cleanupToys();
    return result;
  }, SEED);

  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
  const regularWins = report.wins.filter((win) => !win.trick);
  if (regularWins.length !== 6) throw new Error(`Expected 6 regular delivered prizes, got ${regularWins.length}`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
