import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

import { findBrowser } from './browser.mjs';

const CHROME = findBrowser();
const BASE = process.env.CLAW_TEST_URL ?? 'http://127.0.0.1:5273/?stress=1';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
mkdirSync('shots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-position=-32000,-32000', '--start-minimized'],
  defaultViewport: { width: 1280, height: 820 },
});

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    const current = JSON.parse(localStorage.getItem('claw-settings-v1') ?? '{}');
    localStorage.setItem('claw-basket-score-v1', '17');
    localStorage.setItem('claw-settings-v1', JSON.stringify({
      ...current,
      gameMode: 'fugitives',
      basketHoop: true,
      prizeStand: true,
      freePlay: true,
      sound: true,
      volume: 20,
      graphics: 'balanced',
    }));
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__clawReady === true && !!window.__clawView?.prizeStand', { timeout: 40000 });

  const initial = await page.evaluate(() => {
    const view = window.__clawView;
    const fugitives = view.toys.toys.filter((item) => item.kind === 'fugitive');
    return {
      mode: view.toys.gameMode,
      count: fugitives.length,
      templates: view.toys.templates.map((item) => item.name),
      rigged: fugitives.every((item) => !!item.ai && (
        !!item.mesh.userData.fugitiveRig || !!item.mesh.userData.detailedFugitive?.ready
      )),
      detailed: fugitives.filter((item) => item.mesh.userData.detailedFugitive?.ready).length,
      upright: fugitives.every((item) => item.body.fixedRotation),
      basketRuntimeExists: 'basketHoop' in view,
      basketSettingExists: !!document.querySelector('[data-setting="basketHoop"]'),
      basketStorageExists: 'basketHoop' in JSON.parse(localStorage.getItem('claw-settings-v1') ?? '{}')
        || localStorage.getItem('claw-basket-score-v1') !== null,
      modeSetting: document.querySelector('[data-setting="gameMode"] select')?.value,
      modeOptions: [...document.querySelectorAll('[data-setting="gameMode"] option')].map((option) => option.value),
      scoreLabel: document.querySelector('#score .wins .label')?.textContent.trim(),
      tagline: document.querySelector('#attract .tagline')?.textContent.trim(),
      positions: fugitives.map((item) => [item.body.position.x, item.body.position.z]),
    };
  });

  await page.click('#playBtn');
  await wait(2100);
  const roaming = await page.evaluate((before) => {
    const fugitives = window.__clawView.toys.toys.filter((item) => item.kind === 'fugitive');
    const moved = fugitives.map((item, index) => Math.hypot(
      item.body.position.x - before[index][0],
      item.body.position.z - before[index][1]
    ));
    return {
      moved,
      movingCount: moved.filter((distance) => distance > 0.006).length,
      finite: fugitives.every((item) => [
        item.body.position.x, item.body.position.y, item.body.position.z,
        item.body.velocity.x, item.body.velocity.y, item.body.velocity.z,
      ].every(Number.isFinite)),
    };
  }, initial.positions);

  const motionStability = await page.evaluate(() => new Promise((resolve) => {
    const fugitives = window.__clawView.toys.toys.filter((item) => item.kind === 'fugitive');
    const stats = fugitives.map((item) => ({
      name: item.name,
      x: item.body.position.x,
      z: item.body.position.z,
      action: item.mesh.userData.detailedFugitive?.actionName ?? null,
      actionChanges: 0,
      maxStep: 0,
      totalStep: 0,
      samples: 0,
    }));
    let started = 0;
    const sample = (time) => {
      if (!started) started = time;
      fugitives.forEach((item, index) => {
        const stat = stats[index];
        const step = Math.hypot(item.body.position.x - stat.x, item.body.position.z - stat.z);
        const action = item.mesh.userData.detailedFugitive?.actionName ?? null;
        stat.maxStep = Math.max(stat.maxStep, step);
        stat.totalStep += step;
        stat.samples++;
        if (stat.action && action && stat.action !== action) stat.actionChanges++;
        stat.x = item.body.position.x;
        stat.z = item.body.position.z;
        stat.action = action;
      });
      if (time - started < 2200) requestAnimationFrame(sample);
      else resolve({
        maxStep: Math.max(...stats.map((stat) => stat.maxStep)),
        maxActionChanges: Math.max(...stats.map((stat) => stat.actionChanges)),
        people: stats.map((stat) => ({
          name: stat.name,
          actionChanges: stat.actionChanges,
          maxStep: stat.maxStep,
          meanStep: stat.totalStep / Math.max(1, stat.samples),
        })),
      });
    };
    requestAnimationFrame(sample);
  }));
  const facing = await page.evaluate(() => new Promise((resolve) => {
    const samples = [];
    let started = 0;
    let lastSample = -Infinity;
    const sample = (time) => {
      if (!started) started = time;
      if (time - lastSample >= 100) {
        lastSample = time;
        window.__clawView.toys.toys
          .filter((item) => item.kind === 'fugitive' && item.mesh.userData.detailedFugitive?.ready)
          .forEach((item) => {
            const rig = item.mesh.userData.detailedFugitive;
            const vx = item.ai.visualMoveX ?? 0;
            const vz = item.ai.visualMoveZ ?? 0;
            const speed = Math.hypot(vx, vz);
            if (speed < 0.035) return;
            const yaw = rig.model.rotation.y;
            samples.push((Math.sin(yaw) * vx + Math.cos(yaw) * vz) / speed);
          });
      }
      if (time - started < 1200) requestAnimationFrame(sample);
      else resolve({
        samples,
        average: samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length),
        forward: samples.filter((value) => value > 0).length,
      });
    };
    requestAnimationFrame(sample);
  }));
  const crowd = await page.evaluate(() => {
    const fugitives = window.__clawView.toys.toys.filter((item) => item.kind === 'fugitive');
    const nearest = fugitives.map((item, index) => Math.min(...fugitives
      .filter((_, otherIndex) => otherIndex !== index)
      .map((other) => Math.hypot(
        item.body.position.x - other.body.position.x,
        item.body.position.z - other.body.position.z
      ))));
    const targets = fugitives.filter((item) => item.ai.target).map((item) => item.ai.target);
    let closePairs = 0;
    let targetClusters = 0;
    for (let i = 0; i < fugitives.length; i++) {
      for (let j = i + 1; j < fugitives.length; j++) {
        if (Math.hypot(
          fugitives[i].body.position.x - fugitives[j].body.position.x,
          fugitives[i].body.position.z - fugitives[j].body.position.z
        ) < 0.22) closePairs++;
      }
    }
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        if (Math.hypot(targets[i].x - targets[j].x, targets[i].z - targets[j].z) < 0.15) targetClusters++;
      }
    }
    return {
      minDistance: Math.min(...nearest),
      meanNearest: nearest.reduce((sum, value) => sum + value, 0) / nearest.length,
      spreadX: Math.max(...fugitives.map((item) => item.body.position.x))
        - Math.min(...fugitives.map((item) => item.body.position.x)),
      spreadZ: Math.max(...fugitives.map((item) => item.body.position.z))
        - Math.min(...fugitives.map((item) => item.body.position.z)),
      closePairs,
      activeTargets: targets.length,
      targetClusters,
      paused: fugitives.filter((item) => !item.ai.target).length,
    };
  });
  await page.screenshot({ path: 'shots/fugitives-crowd.png' });

  const panicTarget = await page.evaluate(() => {
    const view = window.__clawView;
    const target = view.toys.toys
      .filter((item) => item.kind === 'fugitive')
      .sort((a, b) => Math.hypot(a.body.position.x, a.body.position.z) - Math.hypot(b.body.position.x, b.body.position.z))[0];
    view.toys.setThreatProvider(() => ({
      x: target.body.position.x + 0.12,
      z: target.body.position.z + 0.08,
      y: 0.7,
      state: 1,
      enabled: true,
      active: true,
    }));
    return { index: view.toys.toys.indexOf(target), x: target.body.position.x, z: target.body.position.z };
  });
  await wait(850);
  const panic = await page.evaluate((start) => {
    const target = window.__clawView.toys.toys[start.index];
    return {
      state: target.ai.state,
      speed: Math.hypot(target.body.velocity.x, target.body.velocity.z),
      distance: Math.hypot(target.body.position.x - start.x, target.body.position.z - start.z),
      reaction: target.mesh.userData.detailedFugitive?.actionName
        ?? (target.mesh.userData.fugitiveRig?.panicMark.visible ? 'panic-mark' : null),
    };
  }, panicTarget);

  const captured = await page.evaluate((index) => {
    const view = window.__clawView;
    const target = view.toys.toys[index];
    view.toys.onCaptured(target);
    view.toys.update(1 / 60, window.__clawStress.elapsed + 1 / 60);
    return {
      captured: target.ai.captured,
      state: target.ai.state,
      reaction: target.mesh.userData.detailedFugitive?.actionName
        ?? target.mesh.userData.fugitiveRig?.mouth.scale.y,
      audioState: view.sfx.ctx?.state,
      screamAt: view.sfx.lastScreamAt,
    };
  }, panicTarget.index);

  const clawTarget = await page.evaluate((excludedIndex) => {
    const view = window.__clawView;
    const claw = window.__claw;
    const target = view.toys.toys.find((item, index) => item.ai && index !== excludedIndex && !item.scored);
    const x = -0.24;
    const y = 0.285;
    const z = -0.34;
    view.toys.setThreatProvider(() => null);
    target.ai.speed = 0;
    target.ai.state = 'wander';
    target.ai.target = null;
    for (const other of view.toys.toys) {
      if (other !== target) other.body.collisionFilterMask = 8;
    }
    target.body.position.set(x, y, z);
    target.body.velocity.set(0, 0, 0);
    target.body.angularVelocity.set(0, 0, 0);
    target.body.force.set(0, 0, 0);
    target.body.torque.set(0, 0, 0);
    target.body.wakeUp();
    claw.pos.set(x, z);
    claw.vel.set(0, 0);
    claw.anchor.position.set(x, claw.anchor.position.y, z);
    claw.anchor.velocity.set(0, 0, 0);
    for (const body of claw.ropeBodies) {
      body.position.x = x;
      body.position.z = z;
      body.velocity.set(0, 0, 0);
      body.angularVelocity.set(0, 0, 0);
      body.force.set(0, 0, 0);
      body.torque.set(0, 0, 0);
    }
    claw.headBody.position.x = x;
    claw.headBody.position.z = z;
    claw.headBody.velocity.set(0, 0, 0);
    claw.headBody.angularVelocity.set(0, 0, 0);
    claw.visualHead = null;
    claw.pendingCapture = target;
    claw.canCaptureToy = (candidate) => candidate === target;
    claw.captureCandidates = () => [target];
    claw.latchCaptureCandidate = () => {
      claw.pendingCapture = target;
      return target;
    };
    claw.rollGrip = function rollFugitiveTestGrip() {
      this.gripPct = 100;
      this.grip = 180;
      this.jackpotHit = true;
      this.weakStreak = 0;
    };
    claw.weakenCheck = () => {};
    claw.tryStart();
    return { index: view.toys.toys.indexOf(target), wins: claw.wins };
  }, panicTarget.index);
  await wait(2450);
  await page.screenshot({ path: 'shots/fugitive-capture.png' });
  await page.waitForFunction((wins) => window.__claw.state === 0 && window.__claw.wins === wins + 1, { timeout: 22000 }, clawTarget.wins);
  // Сцена выдачи: клешня довозит приз, играет камера у люка, приз проезжает
  // шахту и выпадает на пол. Замерено — укладывается в 0.6-0.7с, так что 12с
  // это двадцатикратный запас, а не тесный бюджет. Если сюда всё же прилетел
  // таймаут, значит приз завис, а не «не успел»: печатаем состояние цели,
  // иначе от puppeteer остаётся бесполезное «Waiting failed: 12000ms exceeded».
  const deliveryStart = Date.now();
  try {
    await page.waitForFunction((index) => {
      const target = window.__clawView.toys.toys[index];
      return !!target?.onFloor && !target.deliver;
    }, { timeout: 12000 }, clawTarget.index);
  } catch (error) {
    const stuck = await page.evaluate((index) => {
      const target = window.__clawView.toys.toys[index];
      if (!target) return { missing: true };
      return {
        onFloor: target.onFloor ?? null,
        deliver: target.deliver ? { ...target.deliver } : null,
        journey: target.floorJourney?.phase ?? null,
        scored: target.scored ?? null,
        position: [target.body.position.x, target.body.position.y, target.body.position.z],
        velocity: [target.body.velocity.x, target.body.velocity.y, target.body.velocity.z],
        clawState: window.__claw?.state ?? null,
      };
    }, clawTarget.index);
    throw new Error(`Приз завис в выдаче (${Date.now() - deliveryStart} мс): ${JSON.stringify(stuck)}`);
  }
  const deliveryMs = Date.now() - deliveryStart;
  const fullCatch = await page.evaluate((index) => {
    const view = window.__clawView;
    const target = view.toys.toys[index];
    return {
      wins: window.__claw.wins,
      tries: window.__claw.tries,
      name: target?.name,
      onFloor: target?.onFloor,
      delivered: !target?.deliver,
      fixedRotation: target?.body.fixedRotation,
      captured: target?.ai.captured,
      journey: target?.floorJourney?.phase ?? null,
      draggable: view.prizeDrag.floorToys().includes(target),
    };
  }, clawTarget.index);

  await page.screenshot({ path: 'shots/fugitives-play.png' });

  const runStart = await page.evaluate((index) => {
    const view = window.__clawView;
    const target = view.toys.toys[index];
    return { x: target.body.position.x, z: target.body.position.z };
  }, clawTarget.index);
  await wait(1200);
  const floorRun = await page.evaluate(({ index, start }) => {
    const view = window.__clawView;
    const target = view.toys.toys[index];
    return {
      distance: Math.hypot(target.body.position.x - start.x, target.body.position.z - start.z),
      phase: target.floorJourney?.phase,
      action: target.mesh.userData.detailedFugitive?.actionName,
    };
  }, { index: clawTarget.index, start: runStart });

  await page.evaluate((index) => {
    const view = window.__clawView;
    const target = view.toys.toys[index];
    target.floorJourney.age = view.prizeStand.autoCollectDelay + 0.05;
    target.autoStandAge = target.floorJourney.age;
  }, clawTarget.index);
  await page.waitForFunction((index) => window.__clawView.toys.toys[index]?.floorJourney?.phase === 'approach', { timeout: 4000 }, clawTarget.index);
  const approachStart = await page.evaluate((index) => {
    const target = window.__clawView.toys.toys[index];
    const destination = target.floorJourney.target;
    return {
      distance: Math.hypot(target.body.position.x - destination.x, target.body.position.z - destination.z),
      slot: target.floorJourney.slot.index,
    };
  }, clawTarget.index);
  await wait(900);
  const approach = await page.evaluate(({ index, start }) => {
    const target = window.__clawView.toys.toys[index];
    const destination = target.floorJourney?.target;
    return {
      phase: target.floorJourney?.phase,
      slot: target.floorJourney?.slot?.index ?? -1,
      closer: destination
        ? Math.hypot(target.body.position.x - destination.x, target.body.position.z - destination.z) < start.distance
        : true,
      action: target.mesh.userData.detailedFugitive?.actionName,
    };
  }, { index: clawTarget.index, start: approachStart });
  try {
    await page.waitForFunction((index) => {
      const target = window.__clawView.toys.toys[index];
      return target?.floorJourney?.phase === 'climb' || target?.onStand;
    }, { timeout: 14000 }, clawTarget.index);
  } catch (error) {
    const state = await page.evaluate((index) => {
      const target = window.__clawView.toys.toys[index];
      const destination = target?.floorJourney?.target;
      return {
        position: target ? [target.body.position.x, target.body.position.y, target.body.position.z] : null,
        velocity: target ? [target.body.velocity.x, target.body.velocity.y, target.body.velocity.z] : null,
        phase: target?.floorJourney?.phase,
        destination,
        distance: target && destination
          ? Math.hypot(target.body.position.x - destination.x, target.body.position.z - destination.z)
          : null,
        slot: target?.floorJourney?.slot?.index,
      };
    }, clawTarget.index);
    throw new Error(`Fugitive did not reach the stand: ${JSON.stringify(state)}; ${error.message}`);
  }
  await page.evaluate(() => {
    const view = window.__clawView;
    view.controls.autoRotate = false;
    view.camera.position.set(-0.95, 0.86, 6.8);
    view.controls.target.set(-2.55, -0.5, 2.84);
    view.controls.update();
  });
  await wait(100);
  await page.screenshot({ path: 'shots/fugitive-climb.png' });
  await page.waitForFunction((index) => window.__clawView.toys.toys[index]?.onStand, { timeout: 5000 }, clawTarget.index);
  const standArrival = await page.evaluate((index) => {
    const view = window.__clawView;
    const target = view.toys.toys[index];
    const position = [target.body.position.x, target.body.position.z];
    target.ai.moveX = 0.9;
    target.ai.moveZ = 0.4;
    for (let i = 0; i < 50; i++) view.toys.update(1 / 60, window.__clawStress.elapsed + i / 60);
    return {
      onStand: target.onStand,
      slot: target.standSlot,
      journey: target.floorJourney ?? null,
      fixedRotation: target.body.fixedRotation,
      stationary: Math.hypot(target.body.position.x - position[0], target.body.position.z - position[1]) < 0.001,
      actionWhenStationary: target.mesh.userData.detailedFugitive?.actionName,
    };
  }, clawTarget.index);

  const stress = await page.evaluate(() => {
    const result = window.__clawStress.step(900);
    const bodies = window.__clawView.toys.toys.map((item) => item.body);
    return {
      ...result,
      finite: bodies.every((body) => [
        body.position.x, body.position.y, body.position.z,
        body.velocity.x, body.velocity.y, body.velocity.z,
      ].every(Number.isFinite)),
    };
  });

  const result = { initial, roaming, motionStability, facing, crowd, panic, captured, fullCatch, floorRun, approachStart, approach, standArrival, stress, deliveryMs, pageErrors };
  console.log(JSON.stringify(result, null, 2));

  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join('; ')}`);
  if (initial.mode !== 'fugitives' || initial.count !== 10 || !initial.rigged || initial.detailed !== 10 || !initial.upright) throw new Error('Fugitive population did not initialize');
  if (initial.basketRuntimeExists || initial.basketSettingExists || initial.basketStorageExists) throw new Error('Removed basketball mechanic is still exposed');
  if (initial.modeSetting !== 'fugitives' || initial.modeOptions.join(',') !== 'toys,fugitives') throw new Error('Game mode setting is incomplete');
  if (initial.scoreLabel !== 'ПОЙМАНО' || !initial.tagline.includes('ПАНИКА')) throw new Error('Fugitive UI copy was not applied');
  if (!roaming.finite || roaming.movingCount < 5) throw new Error('Fugitives are not roaming');
  if (motionStability.maxStep > 0.012 || motionStability.maxActionChanges > 4) throw new Error('Fugitive locomotion is visibly stepping or flickering');
  if (facing.samples.length < 8 || facing.average < 0.35 || facing.forward < facing.samples.length * 0.7) throw new Error('Fugitives are moving backwards');
  if (crowd.minDistance < 0.18 || crowd.meanNearest < 0.28 || crowd.closePairs > 1 || crowd.targetClusters > 1 || crowd.spreadX < 0.9 || crowd.spreadZ < 0.65) throw new Error('Fugitives are clumping together');
  if (!['panic', 'hide'].includes(panic.state) || panic.distance < 0.05 || !panic.reaction) throw new Error('Threat did not trigger visible panic');
  if (!captured.captured || captured.state !== 'captured' || !captured.reaction || captured.audioState !== 'running' || captured.screamAt < 0) throw new Error('Capture reaction did not engage');
  if (fullCatch.wins !== clawTarget.wins + 1 || !fullCatch.onFloor || !fullCatch.delivered || !fullCatch.fixedRotation || fullCatch.captured || fullCatch.journey !== 'run' || !fullCatch.draggable) throw new Error('Claw-to-floor fugitive delivery failed');
  if (floorRun.phase !== 'run' || floorRun.distance < 0.08 || !['Sprint_Loop', 'Walk_Loop'].includes(floorRun.action)) throw new Error('Won fugitive did not run around the floor');
  if (approach.slot !== approachStart.slot || !approach.closer || !['approach', 'climb'].includes(approach.phase)) throw new Error('Won fugitive did not walk toward the stand');
  if (!standArrival.onStand || standArrival.slot !== approachStart.slot || standArrival.journey || !standArrival.fixedRotation) throw new Error('Won fugitive did not climb onto the reserved stand slot');
  if (!standArrival.stationary || standArrival.actionWhenStationary !== 'Idle_Loop') throw new Error('Stationary fugitive kept walking in place');
  if (!stress.finite) throw new Error('Fugitive stress run produced non-finite physics');
} finally {
  await browser.close();
}
