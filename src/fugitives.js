// Мультяшные беглецы для альтернативного режима игры.
// Модели процедурные: лёгкий внутренний риг анимируется без GLTF и AnimationMixer.
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { animateDetailedFugitive } from './fugitive-models.js';

export const FUGITIVE_COUNT = 10;

const materialCache = new Map();

function material(color, roughness = 0.72, metalness = 0) {
  const key = `${color}:${roughness}:${metalness}`;
  if (!materialCache.has(key)) {
    materialCache.set(key, new MeshStandardMaterial({ color, roughness, metalness }));
  }
  return materialCache.get(key);
}

function glossy(color) {
  const key = `glossy:${color}`;
  if (!materialCache.has(key)) {
    materialCache.set(key, new MeshPhysicalMaterial({
      color,
      roughness: 0.34,
      metalness: 0.08,
      clearcoat: 0.42,
      clearcoatRoughness: 0.35,
    }));
  }
  return materialCache.get(key);
}

function mesh(geometry, mat, parent, position, scale = null) {
  const item = new Mesh(geometry, mat);
  item.position.set(...position);
  if (scale) item.scale.set(...scale);
  item.castShadow = true;
  item.receiveShadow = true;
  parent.add(item);
  return item;
}

function makeLimb(parent, x, y, z, color, length, radius, bootColor = null) {
  const pivot = new Group();
  pivot.position.set(x, y, z);
  parent.add(pivot);
  mesh(new CylinderGeometry(radius * 0.82, radius, length, 8), material(color), pivot, [0, -length * 0.5, 0]);
  if (bootColor != null) {
    mesh(new RoundedBoxGeometry(radius * 2.15, radius * 1.22, radius * 2.85, 2, radius * 0.32),
      material(bootColor, 0.52), pivot, [0, -length - radius * 0.22, radius * 0.38]);
  }
  return pivot;
}

function makeWorker({
  uniform,
  accent,
  helmet = null,
  coat = false,
  glasses = false,
  cap = false,
  skin = 0xd69a73,
  boots = 0x171b1a,
}) {
  const root = new Group();
  const rig = new Group();
  rig.name = 'fugitiveRig';
  root.add(rig);

  const torso = mesh(
    new RoundedBoxGeometry(0.235, 0.225, 0.145, 3, 0.035),
    material(coat ? 0xdce8df : uniform, 0.74),
    rig,
    [0, -0.005, 0]
  );
  if (coat) {
    mesh(new RoundedBoxGeometry(0.105, 0.19, 0.012, 2, 0.008), material(uniform, 0.68), rig, [0, -0.005, 0.079]);
  }
  mesh(new RoundedBoxGeometry(0.055, 0.055, 0.018, 2, 0.007), glossy(accent), torso, [0.062, 0.047, 0.079]);

  const neck = mesh(new CylinderGeometry(0.045, 0.05, 0.06, 10), material(skin), rig, [0, 0.135, 0]);
  neck.castShadow = false;
  const headPivot = new Group();
  headPivot.position.set(0, 0.215, 0);
  rig.add(headPivot);
  const head = mesh(new SphereGeometry(0.108, 16, 12), material(skin, 0.65), headPivot, [0, 0, 0], [0.9, 1.03, 0.91]);

  const eyeWhite = material(0xf5f0df, 0.5);
  const eyeDark = material(0x17201d, 0.46);
  for (const x of [-0.038, 0.038]) {
    mesh(new SphereGeometry(0.027, 10, 8), eyeWhite, headPivot, [x, 0.018, 0.088], [1, 1.2, 0.45]);
    mesh(new SphereGeometry(0.012, 8, 6), eyeDark, headPivot, [x, 0.014, 0.103], [1, 1.18, 0.5]);
  }
  const mouth = mesh(new SphereGeometry(0.026, 10, 8), material(0x531c20, 0.78), headPivot, [0, -0.043, 0.1], [1, 0.34, 0.3]);
  mesh(new SphereGeometry(0.012, 8, 6), material(0xb75b55, 0.72), headPivot, [0, -0.048, 0.107], [1.05, 0.35, 0.18]);

  if (helmet != null) {
    mesh(new SphereGeometry(0.113, 16, 10), glossy(helmet), headPivot, [0, 0.047, -0.004], [1.04, 0.63, 1.02]);
    mesh(new RoundedBoxGeometry(0.24, 0.025, 0.085, 2, 0.009), glossy(helmet), headPivot, [0, 0.055, 0.064]);
  } else if (cap) {
    mesh(new SphereGeometry(0.112, 16, 10), material(accent, 0.58), headPivot, [0, 0.052, -0.006], [1.02, 0.57, 1]);
    mesh(new RoundedBoxGeometry(0.17, 0.018, 0.105, 2, 0.008), material(accent, 0.58), headPivot, [0, 0.048, 0.095]);
  } else {
    mesh(new SphereGeometry(0.109, 14, 9), material(0x3b291f, 0.92), headPivot, [0, 0.054, -0.012], [1, 0.57, 0.98]);
  }

  if (glasses) {
    for (const x of [-0.039, 0.039]) {
      const lens = mesh(new TorusGeometry(0.033, 0.005, 6, 16), material(0x243a37, 0.35, 0.25), headPivot, [x, 0.017, 0.105]);
      lens.scale.y = 0.82;
    }
    mesh(new BoxGeometry(0.024, 0.006, 0.006), material(0x243a37, 0.35, 0.25), headPivot, [0, 0.018, 0.107]);
  }

  const leftArm = makeLimb(rig, -0.145, 0.077, 0, uniform, 0.19, 0.043);
  const rightArm = makeLimb(rig, 0.145, 0.077, 0, uniform, 0.19, 0.043);
  const leftHand = mesh(new SphereGeometry(0.047, 10, 8), material(skin), leftArm, [0, -0.207, 0]);
  const rightHand = mesh(new SphereGeometry(0.047, 10, 8), material(skin), rightArm, [0, -0.207, 0]);
  leftHand.castShadow = rightHand.castShadow = true;

  const leftLeg = makeLimb(rig, -0.065, -0.105, 0, uniform, 0.155, 0.048, boots);
  const rightLeg = makeLimb(rig, 0.065, -0.105, 0, uniform, 0.155, 0.048, boots);

  const panicMark = new Group();
  panicMark.position.set(0.15, 0.37, 0.02);
  panicMark.visible = false;
  rig.add(panicMark);
  const panicMat = new MeshStandardMaterial({
    color: 0xffc247,
    emissive: 0xff3045,
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });
  const rayA = mesh(new ConeGeometry(0.018, 0.07, 6), panicMat, panicMark, [0, 0.045, 0]);
  rayA.rotation.z = -0.28;
  const rayB = mesh(new ConeGeometry(0.015, 0.058, 6), panicMat, panicMark, [0.057, 0.006, 0]);
  rayB.rotation.z = -1.1;

  root.userData.fugitiveRig = {
    rig, torso, headPivot, mouth, leftArm, rightArm, leftLeg, rightLeg, panicMark,
  };
  return root;
}

export function createFugitiveTemplates(makeDetailed = null) {
  return [
    {
      name: 'Стажёр', fugitive: true, archetype: 'runner', weight: 2.4, r: 0.26, colliderR: 0.245, box: [0.115, 0.255, 0.075],
      massMul: 0.72, grip: { radius: 0.27, drop: 0.235, maxSpeed: 3.25, squish: 0.018 },
      make: () => makeDetailed?.({ modelKey: 'workerFemale' })
        ?? makeWorker({ uniform: 0x315d86, accent: 0xffc247, helmet: 0xe0a52f }),
    },
    {
      name: 'Инженер', fugitive: true, archetype: 'hider', weight: 2.1, r: 0.26, colliderR: 0.245, box: [0.115, 0.255, 0.075],
      massMul: 0.78, grip: { radius: 0.27, drop: 0.235, forceMul: 0.96, squish: 0.018 },
      make: () => makeDetailed?.({ modelKey: 'workerMale' })
        ?? makeWorker({ uniform: 0x335f50, accent: 0x38f5ff, helmet: 0xe7e0c8, glasses: true }),
    },
    {
      name: 'Лаборант', fugitive: true, archetype: 'freezer', weight: 1.8, r: 0.26, colliderR: 0.245, box: [0.115, 0.255, 0.075],
      massMul: 0.7, grip: { radius: 0.27, drop: 0.235, squish: 0.02 },
      make: () => makeDetailed?.({ modelKey: 'doctorFemale' })
        ?? makeWorker({ uniform: 0x2d7d78, accent: 0xe879f9, coat: true, glasses: true }),
    },
    {
      name: 'Курьер', fugitive: true, archetype: 'panicker', weight: 2.2, r: 0.26, colliderR: 0.245, box: [0.115, 0.255, 0.075],
      massMul: 0.68, grip: { radius: 0.27, drop: 0.235, maxSpeed: 3.4, squish: 0.02 },
      make: () => makeDetailed?.({ modelKey: 'courierMale' })
        ?? makeWorker({ uniform: 0xb24c2e, accent: 0xffc247, cap: true }),
    },
    {
      name: 'Бригадир', fugitive: true, archetype: 'hero', weight: 1.4, r: 0.27, colliderR: 0.255, box: [0.12, 0.265, 0.08],
      massMul: 0.9, grip: { radius: 0.28, drop: 0.24, forceMul: 0.9, maxSpeed: 3.05, squish: 0.016 },
      make: () => makeDetailed?.({ modelKey: 'supervisorFemale' })
        ?? makeWorker({ uniform: 0x594638, accent: 0xff3045, helmet: 0xa51f2b }),
    },
  ];
}

export function createFugitiveAI(template, seed = Math.random()) {
  const profiles = {
    runner: { speed: 0.43, reaction: 0.22, detect: 1.02, roam: 0.32, pause: 0.68, patrol: 0.86 },
    hider: { speed: 0.34, reaction: 0.34, detect: 1.08, roam: 0.23, pause: 1.18, patrol: 1.08 },
    freezer: { speed: 0.37, reaction: 0.66, detect: 0.9, roam: 0.17, pause: 1.72, patrol: 1.22 },
    panicker: { speed: 0.46, reaction: 0.28, detect: 1.12, roam: 0.36, pause: 0.52, patrol: 0.78 },
    hero: { speed: 0.31, reaction: 0.42, detect: 0.94, roam: 0.2, pause: 1.38, patrol: 1.18 },
  };
  const archetype = template.archetype ?? 'runner';
  const profile = profiles[archetype];
  return {
    archetype,
    state: 'wander',
    stateTime: 0,
    thinkTime: 0,
    target: null,
    speed: profile.speed * (0.9 + seed * 0.18),
    reaction: profile.reaction * (0.88 + seed * 0.3),
    detect: profile.detect,
    roam: profile.roam * (0.9 + seed * 0.18),
    pauseScale: profile.pause * (0.88 + seed * 0.24),
    patrolScale: profile.patrol * (0.9 + seed * 0.2),
    phase: seed * Math.PI * 2,
    visualYaw: seed * Math.PI * 2,
    captured: false,
    panicNotified: false,
    calmTime: 0,
    desiredMoveX: 0,
    desiredMoveZ: 0,
    moveX: 0,
    moveZ: 0,
    visualSpeed: 0,
    pauseTime: (0.2 + (1 - seed) * 1.35) * profile.pause,
    retargetAfter: (3.2 + seed * 2.8) * profile.patrol,
    escapeRetargetIn: 0,
    personalSpace: 0.31 + seed * 0.085,
    passSide: Math.sin(seed * Math.PI * 8.37) >= 0 ? 1 : -1,
  };
}

function safeCorners(dims) {
  const xL = -dims.INNER_X + 0.24;
  const xR = Math.min(dims.HOLE_MIN_X - 0.25, dims.INNER_X - 0.24);
  const zF = -dims.INNER_Z + 0.23;
  const zB = dims.INNER_Z - 0.23;
  return [
    { x: xL, z: zF },
    { x: xL, z: zB },
    { x: xR, z: zF },
  ];
}

function isSafe(dims, x, z, pad = 0.18) {
  if (x < -dims.INNER_X + pad || x > dims.INNER_X - pad) return false;
  if (z < -dims.INNER_Z + pad || z > dims.INNER_Z - pad) return false;
  return !(x > dims.HOLE_MIN_X - pad && z > dims.HOLE_MIN_Z - pad);
}

function sampleSafePoint(dims, pad = 0.22) {
  // Пол автомата Г-образный: справа от шахты остаётся большая безопасная зона.
  // Старый ограничитель по HOLE_MIN_X запирал всю толпу в левой половине.
  for (let i = 0; i < 24; i++) {
    const x = MathUtils.lerp(-dims.INNER_X + pad, dims.INNER_X - pad, Math.random());
    const z = MathUtils.lerp(-dims.INNER_Z + pad, dims.INNER_Z - pad, Math.random());
    if (isSafe(dims, x, z, pad)) return { x, z };
  }
  return safeCorners(dims)[0];
}

function isActiveCrowdMember(item) {
  return !!item?.ai && !!item.body?.world
    && !item.scored && !item.prizeEligible && !item.deliver && !item.onFloor && !item.onStand
    && !item.autoTransferring && item.body.collisionFilterGroup !== 16 && !item.ai.captured;
}

function crowdClearance(context, toy, candidate) {
  let body = 1.2;
  let target = 1.2;
  for (const other of context.toys) {
    if (other === toy || !isActiveCrowdMember(other)) continue;
    body = Math.min(body, Math.hypot(
      candidate.x - other.body.position.x,
      candidate.z - other.body.position.z
    ));
    if (other.ai.target) {
      target = Math.min(target, Math.hypot(
        candidate.x - other.ai.target.x,
        candidate.z - other.ai.target.z
      ));
    }
  }
  return { body, target };
}

function randomSafeTarget(dims, context, toy) {
  let best = null;
  for (let i = 0; i < 22; i++) {
    const candidate = sampleSafePoint(dims, 0.22);
    const clearance = crowdClearance(context, toy, candidate);
    const travel = Math.hypot(
      candidate.x - toy.body.position.x,
      candidate.z - toy.body.position.z
    );
    // Свободная точка важнее близкой: цели других персонажей тоже считаются
    // занятыми, поэтому группа не строится в колонну к одному месту.
    const edgeDistance = Math.min(
      candidate.x - (-dims.INNER_X + 0.2),
      dims.INNER_X - 0.2 - candidate.x,
      candidate.z - (-dims.INNER_Z + 0.2),
      dims.INNER_Z - 0.2 - candidate.z
    );
    let score = Math.min(0.7, clearance.body) * 1.35
      + Math.min(0.8, clearance.target) * 1.7
      + Math.min(0.85, travel) * 0.18
      + Math.random() * 0.08;
    if (toy.ai.archetype === 'hider') score += Math.max(0, 0.3 - edgeDistance) * 0.7;
    if (toy.ai.archetype === 'runner' || toy.ai.archetype === 'panicker') score += Math.min(0.9, travel) * 0.12;
    if (!best || score > best.score) best = { ...candidate, score };
  }
  return best ?? safeCorners(dims)[0];
}

function escapeTarget(toy, context, threat) {
  const from = toy.body.position;
  const threatX = threat?.x ?? 0.72;
  const threatZ = threat?.z ?? 0.52;
  const corners = safeCorners(context.dims).map((corner, index) => {
    const angle = toy.ai.phase + index * 2.17;
    const candidate = {
      x: corner.x + Math.cos(angle) * 0.09,
      z: corner.z + Math.sin(angle) * 0.09,
      corner: true,
    };
    return isSafe(context.dims, candidate.x, candidate.z, 0.2) ? candidate : { ...corner, corner: true };
  });
  const candidates = [...corners];
  for (let i = 0; i < 18; i++) candidates.push(sampleSafePoint(context.dims, 0.21));

  return candidates.reduce((best, candidate) => {
    const clearance = crowdClearance(context, toy, candidate);
    const threatDistance = Math.hypot(candidate.x - threatX, candidate.z - threatZ);
    const travelX = candidate.x - from.x;
    const travelZ = candidate.z - from.z;
    const travel = Math.hypot(travelX, travelZ);
    const fromThreatX = from.x - threatX;
    const fromThreatZ = from.z - threatZ;
    const awayProgress = (travelX * fromThreatX + travelZ * fromThreatZ)
      / Math.max(0.001, travel * Math.hypot(fromThreatX, fromThreatZ));
    let score = threatDistance * 1.85
      + Math.min(0.65, clearance.body) * 1.15
      + Math.min(0.8, clearance.target) * 1.7
      + Math.max(-0.25, awayProgress) * 0.38
      - travel * 0.08
      + Math.random() * 0.06;
    if (toy.ai.archetype === 'hider' && candidate.corner) score += 0.48;
    if (toy.ai.archetype === 'hero') {
      const cross = travelX * fromThreatZ - travelZ * fromThreatX;
      score += Math.sign(cross || 1) === toy.ai.passSide ? 0.2 : 0;
    }
    return !best || score > best.score ? { ...candidate, score } : best;
  }, null);
}

export function fugitiveSpawnPoints(dims, count = FUGITIVE_COUNT) {
  const candidates = Array.from({ length: Math.max(80, count * 16) }, () => sampleSafePoint(dims, 0.27));
  const points = [candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0]];
  // Farthest-point sampling заполняет всю Г-образную площадку и не позволяет
  // случайной последовательности сложить стартовую толпу в одной половине.
  while (points.length < count && candidates.length) {
    let bestIndex = 0;
    let bestDistance = -1;
    candidates.forEach((candidate, index) => {
      const nearest = Math.min(...points.map((point) => Math.hypot(
        candidate.x - point.x,
        candidate.z - point.z
      )));
      if (nearest > bestDistance) {
        bestDistance = nearest;
        bestIndex = index;
      }
    });
    points.push(candidates.splice(bestIndex, 1)[0]);
  }
  return points;
}

function enterPanic(toy, context) {
  const ai = toy.ai;
  if (['alert', 'freeze', 'panic', 'hide', 'captured'].includes(ai.state)) return;
  ai.state = ai.archetype === 'freezer' ? 'freeze' : 'alert';
  ai.stateTime = 0;
  ai.target = null;
  ai.calmTime = 0;
  ai.escapeRetargetIn = 0;
  if (!ai.panicNotified) {
    ai.panicNotified = true;
    context.onPanic?.(toy);
  }
}

export function thinkFugitive(toy, context, dt) {
  const ai = toy.ai;
  const body = toy.body;
  if (!ai || !body?.world) return;
  ai.stateTime += dt;

  // На полу персонажем управляет маршрут к коллекционному стенду. Обычный AI
  // внутри автомата не должен гасить его скорость или тянуть назад в витрину.
  if (toy.floorJourney?.controlled) return;

  if (
    toy.scored || toy.prizeEligible || toy.deliver || toy.onFloor || toy.onStand || toy.autoTransferring
    || body.collisionFilterGroup === 16 || ai.captured
  ) {
    ai.desiredMoveX = 0;
    ai.desiredMoveZ = 0;
    return;
  }

  const threat = context.threat;
  const dxThreat = body.position.x - (threat?.x ?? 99);
  const dzThreat = body.position.z - (threat?.z ?? 99);
  const threatDist = Math.hypot(dxThreat, dzThreat);
  const seesThreat = !!threat?.enabled && !!threat.active && threatDist < ai.detect;
  if (seesThreat) enterPanic(toy, context);

  if (!seesThreat && (ai.state === 'panic' || ai.state === 'hide' || ai.state === 'freeze' || ai.state === 'alert')) {
    ai.calmTime += dt;
    if (ai.calmTime > 1.35) {
      ai.state = 'wander';
      ai.stateTime = 0;
      ai.target = null;
      ai.pauseTime = (0.4 + Math.random() * 1.35) * ai.pauseScale;
      ai.panicNotified = false;
    }
  } else if (seesThreat) {
    ai.calmTime = 0;
  }

  if (ai.state === 'wander') {
    ai.pauseTime = Math.max(0, ai.pauseTime - dt);
    if (ai.target && ai.stateTime > ai.retargetAfter) {
      ai.target = null;
      ai.pauseTime = (0.55 + Math.random() * 1.35) * ai.pauseScale;
    }
    if (!ai.target && ai.pauseTime <= 0) {
      ai.target = randomSafeTarget(context.dims, context, toy);
      ai.stateTime = 0;
      ai.retargetAfter = (3.3 + Math.random() * 3.2) * ai.patrolScale;
    }
  } else if (ai.state === 'alert') {
    if (ai.stateTime >= ai.reaction) {
      ai.state = 'panic';
      ai.stateTime = 0;
      ai.target = null;
    }
  } else if (ai.state === 'freeze') {
    if (ai.stateTime >= ai.reaction || threatDist < 0.42) {
      ai.state = 'panic';
      ai.stateTime = 0;
      ai.target = null;
    }
  }

  if (ai.state === 'panic') {
    ai.escapeRetargetIn -= dt;
    const distanceToTarget = ai.target
      ? Math.hypot(ai.target.x - body.position.x, ai.target.z - body.position.z)
      : 0;
    if (!ai.target || ai.escapeRetargetIn <= 0 || distanceToTarget < 0.1) {
      ai.target = escapeTarget(toy, context, threat);
      ai.escapeRetargetIn = (ai.archetype === 'panicker' ? 0.6 : 0.95) + Math.random() * 0.65;
    }
  }

  if (ai.state === 'hide' && threatDist < 0.62) {
    ai.state = 'panic';
    ai.stateTime = 0;
    ai.target = escapeTarget(toy, context, threat);
    ai.escapeRetargetIn = 0.8 + Math.random() * 0.5;
  }

  let desiredX = 0;
  let desiredZ = 0;
  if (ai.target && ai.state !== 'alert' && ai.state !== 'freeze') {
    const dx = ai.target.x - body.position.x;
    const dz = ai.target.z - body.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.07) {
      if (ai.state === 'panic' && ai.archetype === 'hider') ai.state = 'hide';
      else if (ai.state === 'wander') {
        ai.target = null;
        ai.stateTime = 0;
        ai.pauseTime = (0.55 + Math.random() * 1.7) * ai.pauseScale;
      }
    } else {
      const panicMul = ai.state === 'panic' ? 1 : ai.state === 'hide' ? 0 : ai.roam;
      desiredX = (dx / dist) * ai.speed * panicMul;
      desiredZ = (dz / dist) * ai.speed * panicMul;
    }
  }

  // Личное пространство и встречный разъезд. Радиус намеренно заметно больше
  // физического коллайдера: персонажи заранее расходятся, а не толкаются телами.
  let crowdSteering = false;
  for (const other of context.toys) {
    if (other === toy || !isActiveCrowdMember(other)) continue;
    const dx = body.position.x - other.body.position.x;
    const dz = body.position.z - other.body.position.z;
    const d2 = dx * dx + dz * dz;
    const personalSpace = (ai.personalSpace + (other.ai.personalSpace ?? 0.25)) * 0.5;
    if (d2 < personalSpace * personalSpace) {
      const distance = Math.sqrt(d2);
      const angle = ai.phase - other.ai.phase;
      const nx = distance > 0.002 ? dx / distance : Math.cos(angle);
      const nz = distance > 0.002 ? dz / distance : Math.sin(angle);
      const pressure = 1 - Math.min(1, distance / personalSpace);
      const push = ai.speed * (0.34 + pressure * 1.1);
      desiredX += nx * push;
      desiredZ += nz * push;
      crowdSteering = true;
    }

    const desiredSpeed = Math.hypot(desiredX, desiredZ);
    if (desiredSpeed > 0.02 && d2 < 0.42 * 0.42) {
      const fx = desiredX / desiredSpeed;
      const fz = desiredZ / desiredSpeed;
      const towardX = -dx;
      const towardZ = -dz;
      const ahead = towardX * fx + towardZ * fz;
      const side = towardX * -fz + towardZ * fx;
      if (ahead > 0 && ahead < 0.4 && Math.abs(side) < 0.16) {
        const avoid = (1 - ahead / 0.4) * (1 - Math.abs(side) / 0.16);
        desiredX += -fz * ai.passSide * ai.speed * avoid * 0.65;
        desiredZ += fx * ai.passSide * ai.speed * avoid * 0.65;
        crowdSteering = true;
      }
    }
  }

  // На финальном смыкании клешни беглец больше не «телепортируется» из захвата.
  if (threat?.state >= 2 && threat?.state <= 3 && threatDist < 0.48) {
    desiredX *= 0.12;
    desiredZ *= 0.12;
  }

  const normalLimit = ai.state === 'panic' ? ai.speed * 1.08 : ai.speed * 0.42;
  const speedLimit = crowdSteering ? Math.max(normalLimit, ai.speed * 0.56) : normalLimit;
  const desiredLength = Math.hypot(desiredX, desiredZ);
  if (desiredLength > speedLimit) {
    desiredX = desiredX / desiredLength * speedLimit;
    desiredZ = desiredZ / desiredLength * speedLimit;
  }

  const predictedX = body.position.x + desiredX * 0.35;
  const predictedZ = body.position.z + desiredZ * 0.35;
  if (!isSafe(context.dims, predictedX, predictedZ, 0.19)) {
    const turnOrder = [ai.passSide, -ai.passSide, ai.passSide * 1.5, -ai.passSide * 1.5, 2];
    const baseX = desiredX;
    const baseZ = desiredZ;
    let steered = false;
    for (const turn of turnOrder) {
      const angle = turn * Math.PI / 3;
      const rx = baseX * Math.cos(angle) - baseZ * Math.sin(angle);
      const rz = baseX * Math.sin(angle) + baseZ * Math.cos(angle);
      if (isSafe(context.dims, body.position.x + rx * 0.35, body.position.z + rz * 0.35, 0.19)) {
        desiredX = rx;
        desiredZ = rz;
        steered = true;
        break;
      }
    }
    if (!steered) desiredX = desiredZ = 0;
    if (ai.state === 'panic') ai.escapeRetargetIn = 0;
    else if (ai.target) ai.retargetAfter = Math.min(ai.retargetAfter, ai.stateTime + 0.25);
  }

  // Think-цикл только выбирает направление. Непосредственное движение идёт
  // каждый кадр в stepFugitiveMotion, иначе ручной шаг получается рывками 10 Гц.
  ai.desiredMoveX = desiredX;
  ai.desiredMoveZ = desiredZ;
}

export function stepFugitiveMotion(toy, context, dt) {
  const ai = toy.ai;
  const body = toy.body;
  if (!ai || !body?.world || toy.floorJourney?.controlled) return;
  const stopped =
    toy.scored || toy.prizeEligible || toy.deliver || toy.onFloor || toy.onStand || toy.autoTransferring
    || body.collisionFilterGroup === 16 || ai.captured;
  const targetX = stopped ? 0 : (ai.desiredMoveX ?? 0);
  const targetZ = stopped ? 0 : (ai.desiredMoveZ ?? 0);
  const blend = 1 - Math.exp(-dt * (stopped ? 11 : 7.5));
  ai.moveX = MathUtils.lerp(ai.moveX, targetX, blend);
  ai.moveZ = MathUtils.lerp(ai.moveZ, targetZ, blend);
  if (body.collisionFilterGroup === 16 || toy.deliver) return;
  body.velocity.x = ai.moveX;
  body.velocity.z = ai.moveZ;
  if (Math.hypot(ai.moveX, ai.moveZ) > 0.025) {
    // Контакт с полом имеет заметное статическое трение. Агент делает небольшой
    // управляемый горизонтальный шаг, а Cannon продолжает отвечать за высоту,
    // столкновения, захват и падения.
    const nextX = body.position.x + ai.moveX * dt * 0.72;
    const nextZ = body.position.z + ai.moveZ * dt * 0.72;
    if (isSafe(context.dims, nextX, nextZ, 0.18)) {
      body.position.x = nextX;
      body.position.z = nextZ;
      body.aabbNeedsUpdate = true;
    }
    body.wakeUp();
  }
}

function lerpAngle(from, to, amount) {
  let delta = (to - from + Math.PI) % (Math.PI * 2) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * amount;
}

export function animateFugitive(toy, dt, elapsed) {
  const ai = toy.ai;
  if (animateDetailedFugitive(toy, dt)) return;
  const refs = toy.mesh?.userData?.fugitiveRig;
  if (!ai || !refs) return;
  const held = !toy.onStand && (toy.body?.collisionFilterGroup === 16 || ai.captured);
  const vx = held ? 0 : (ai.visualMoveX ?? 0);
  const vz = held ? 0 : (ai.visualMoveZ ?? 0);
  const targetSpeed = Math.hypot(vx, vz);
  ai.visualSpeed = toy.onStand ? 0 : MathUtils.lerp(ai.visualSpeed, targetSpeed, Math.min(1, dt * 8));
  const speed = ai.visualSpeed;
  const panic = ['alert', 'freeze', 'panic', 'hide'].includes(ai.state) && !toy.scored;
  const motion = elapsed * (held ? 12 : 7 + speed * 15) + ai.phase;
  const stride = held ? Math.sin(motion) * 0.65 : Math.sin(motion) * Math.min(0.9, speed * 2.7);
  const k = Math.min(1, dt * 12);

  if (toy.onStand) ai.visualYaw = 0;
  else if (speed > 0.025 && !held) {
    const targetYaw = Math.atan2(vx, vz);
    ai.visualYaw = lerpAngle(ai.visualYaw, targetYaw, Math.min(1, dt * 8));
  }
  refs.rig.rotation.y = ai.visualYaw;
  refs.leftLeg.rotation.x = MathUtils.lerp(refs.leftLeg.rotation.x, stride, k);
  refs.rightLeg.rotation.x = MathUtils.lerp(refs.rightLeg.rotation.x, -stride, k);

  if (held) {
    refs.leftArm.rotation.z = MathUtils.lerp(refs.leftArm.rotation.z, -2.55, k);
    refs.rightArm.rotation.z = MathUtils.lerp(refs.rightArm.rotation.z, 2.55, k);
    refs.leftArm.rotation.x = Math.sin(motion) * 0.25;
    refs.rightArm.rotation.x = -Math.sin(motion) * 0.25;
    refs.headPivot.rotation.z = Math.sin(motion * 0.62) * 0.16;
  } else {
    refs.leftArm.rotation.z = MathUtils.lerp(refs.leftArm.rotation.z, panic ? -0.38 : -0.08, k);
    refs.rightArm.rotation.z = MathUtils.lerp(refs.rightArm.rotation.z, panic ? 0.38 : 0.08, k);
    refs.leftArm.rotation.x = MathUtils.lerp(refs.leftArm.rotation.x, -stride * 0.92, k);
    refs.rightArm.rotation.x = MathUtils.lerp(refs.rightArm.rotation.x, stride * 0.92, k);
    refs.headPivot.rotation.z = MathUtils.lerp(refs.headPivot.rotation.z, panic ? Math.sin(motion * 0.43) * 0.08 : 0, k);
  }

  refs.rig.position.y = (held ? 0 : Math.abs(Math.sin(motion)) * Math.min(0.018, speed * 0.045));
  refs.rig.rotation.x = MathUtils.lerp(refs.rig.rotation.x, speed > 0.12 && !held ? -0.1 : 0, k);
  refs.mouth.scale.y = MathUtils.lerp(refs.mouth.scale.y, held ? 1.45 : panic ? 0.95 : 0.34, k);
  refs.mouth.scale.x = MathUtils.lerp(refs.mouth.scale.x, held ? 1.16 : panic ? 0.92 : 1, k);
  refs.panicMark.visible = panic && !held && !toy.onStand;
  refs.panicMark.rotation.z = Math.sin(motion * 0.54) * 0.12;
  refs.panicMark.scale.setScalar(0.92 + Math.sin(motion * 1.4) * 0.08);
}

export function markFugitiveCaptured(toy) {
  if (!toy?.ai) return false;
  toy.ai.captured = true;
  toy.ai.state = 'captured';
  toy.ai.stateTime = 0;
  toy.ai.target = null;
  return true;
}

export function markFugitiveReleased(toy, slipped) {
  if (!toy?.ai) return;
  toy.ai.captured = !slipped;
  if (slipped) {
    toy.ai.state = 'freeze';
    toy.ai.stateTime = Math.max(0, toy.ai.reaction - 0.28);
    toy.ai.target = null;
    toy.ai.panicNotified = false;
  }
}
