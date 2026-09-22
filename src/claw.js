// Клешня: физическая верёвка (цепь тел на DistanceConstraint), голова — динамическое
// тело, пальцы — КИНЕМАТИЧЕСКИЕ тела с коллайдерами: движутся по анимации (гладко),
// толкают игрушки, при закрытии останавливаются по контакту («обхватил — стоп»),
// при ослабшем хвате приоткрываются и игрушка выпадает. Динамические пальцы на
// шарнирах выброшены: итеративный солвер такую цепь масс без дрожи не решает.
import {
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as ui from './ui.js';
import { settings } from './settings.js';
import { sfx } from './audio.js';
import { pollGamepad, vibrate } from './gamepad.js';
import { CABINET_SPEC } from './machine.js';
import { tr, toyName } from './i18n.js';

const CFG = {
  boundX: Math.min(1.02, CABINET_SPEC.innerX - 0.16),
  boundZ: Math.min(1.02, CABINET_SPEC.innerZ - 0.12),
  speed: 1.8,
  accel: 9,
  pivotY: 2.38,
  ropeSegs: 7,
  // длины верёвки — до МАКУШКИ головы (точка подвеса), не до центра
  ropeIdle: 0.36,
  ropeLift: 0.34,       // короткий трос при переносе — иначе маятниковый занос
                       // уносит приз в другой угол мимо дыры (потолок group32
                       // голову не трогает, длинить ради него больше не нужно)
  ropeMax: 1.86,
  headDrop: 0.26,       // центр головы ниже точки подвеса на столько
  dropSpeed: 1.4,
  liftSpeed: 1.25,
  carrySpeed: 1.25,
  carryPalmTolerance: 0.035,
  carryPalmSpeed: 0.28,
  carrySettleTime: 0.14,
  ropeVisualHz: 45,
  ropeVisualSmooth: 22,
  settleTime: 1.0,
  closeTime: 0.55,
  releaseScoreWait: 2.2,
  grabReach: 0.5,       // мягкий радиус ладони: выбираем ближайшую игрушку в куче
  dropSenseRadius: 0.34,
  dropPalmDefaultY: 0.18,
  dropPalmMinY: 0.16,
  dropPalmMaxY: 1.08,
  dropPalmClearance: 0.025,
  dropSlowZone: 0.24,
  dropMinSpeedMul: 0.35,
  swingCenterDamping: 4.6,
  captureScanLimit: 6,
  captureHorizMin: 0.085,
  captureHorizMax: 0.23,
  captureHorizRadius: 0.65,
  captureVertTolerance: 0.3,
  captureSnapMin: 0.1,
  captureSnapMax: 0.36,
  captureLatchSlack: 0.075,
  pileBlockOverlap: 0.5,
  pileBlockLift: 0.1,
  grabMax: 1,
  gripMin: 30,
  gripMax: 85,
  slipCheckEvery: 0.35,
  weakGripPct: 50,
  slipChance: 0.25,
  breakDist: 0.72,
  swingDamping: 1.35,
  swingSettleDamping: 4.2,
  heldDrop: 0.21,       // где в ладони висит центр игрушки
  gripPosKWeak: 5.5,
  gripPosKStrong: 11.5,
  gripForceWeak: 14,
  gripForceStrong: 108,
  gripMaxSpeed: 3.6,
  gripCatchup: 0.34,
  gripLateralSlackWeak: 0.105,
  gripLateralSlackStrong: 0.055,
  gripLateralReturn: 0.9,
  gripRotDamping: 8.5,
  gripRotFollow: 4.5,
  // пальцы (кинематика): три позы — покой (расслабленно полусомкнуты),
  // раскрытие на спуске, смыкание при хвате
  fingerRest: 0.04,
  elbowRest: -0.4,
  fingerOpen: 0.62,     // угол верхней фаланги наружу, рад
  fingerClose: 0.18,
  fingerCloseBig: 0.44,
  elbowOpen: 0.05,
  elbowClose: -0.48,
  elbowCloseBig: -0.34,
  fingerSpeed: 2.6,     // скорость анимации, рад/с
  fingerRelaxMax: 0.45, // насколько приоткрываются при полностью ослабшем хвате
  toyPivot: 0.22,       // подвес игрушки под куполом — «в ладони», на кончиках пальцев
};

function makeMechanismLabel(title, subtitle, w = 0.16, h = 0.045, accent = '#ffc247') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#07120f';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = accent;
  g.lineWidth = 10;
  g.strokeRect(16, 16, c.width - 32, c.height - 32);
  g.fillStyle = accent;
  g.font = '800 56px "Arial Narrow", "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(title, c.width / 2, 62);
  if (subtitle) {
    g.fillStyle = '#f3ddb2';
    g.font = '700 34px "Arial Narrow", "Segoe UI", Arial, sans-serif';
    g.fillText(subtitle, c.width / 2, 112);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const label = new Mesh(new PlaneGeometry(w, h), mat);
  label.renderOrder = 7;
  return label;
}

let cableWeaveTexture;
function makeCableWeaveTexture() {
  if (cableWeaveTexture) return cableWeaveTexture;
  const c = document.createElement('canvas');
  c.width = 96; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#b8ad88';
  g.fillRect(0, 0, c.width, c.height);
  g.lineWidth = 11;
  for (let y = -96; y < c.height + 96; y += 28) {
    g.strokeStyle = '#786f58';
    g.beginPath();
    g.moveTo(-20, y);
    g.lineTo(c.width + 20, y + 70);
    g.stroke();
    g.strokeStyle = '#ded4ad';
    g.beginPath();
    g.moveTo(-20, y + 9);
    g.lineTo(c.width + 20, y + 79);
    g.stroke();
  }
  cableWeaveTexture = new CanvasTexture(c);
  cableWeaveTexture.colorSpace = SRGBColorSpace;
  cableWeaveTexture.wrapS = RepeatWrapping;
  cableWeaveTexture.wrapT = RepeatWrapping;
  cableWeaveTexture.repeat.set(1, 12);
  cableWeaveTexture.anisotropy = 4;
  return cableWeaveTexture;
}

function makeFingerLinkGeometry(length, topWidth, bottomWidth, depth) {
  const h = length * 0.5;
  const shape = new Shape();
  shape.moveTo(-topWidth, h);
  shape.quadraticCurveTo(0, h + 0.012, topWidth, h);
  shape.bezierCurveTo(topWidth + 0.008, h * 0.35, bottomWidth + 0.008, -h * 0.55, bottomWidth, -h);
  shape.quadraticCurveTo(0, -h - 0.012, -bottomWidth, -h);
  shape.bezierCurveTo(-bottomWidth - 0.008, -h * 0.55, -topWidth - 0.008, h * 0.35, -topWidth, h);
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments: 12,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.005,
    bevelThickness: 0.005,
  });
  geometry.translate(0, 0, -depth * 0.5);
  return geometry;
}

const STATE = { IDLE: 0, DESCEND: 1, SETTLE: 2, GRAB: 3, LIFT: 4, CARRY: 5, RELEASE: 6 };

export class Claw {
  constructor(scene, world, toys, dropPoint) {
    this.world = world;
    this.toys = toys;
    this.dropPoint = dropPoint;
    this.state = STATE.IDLE;
    this.pos = new Vector2(-0.5, -0.3);
    this.vel = new Vector2();
    this.ropeLen = CFG.ropeIdle;
    this.tries = 0;
    this.wins = 0;
    this.held = [];
    this.grip = 0;
    this.gripPct = 0;
    this.weakStreak = 0;
    this.fingerMode = 'rest';    // rest | open | close
    this.fingerHold = false;     // констрейнт создан: пальцы замирают, не выдавливают
    this.fingerForceMul = 1;     // «усталость» пальцев: <1 → приоткрываются
    this.gripFitRadius = 0.24;    // визуальный обхват под радиус текущего приза
    this.slipTimer = 0;
    this.settleT = 0;
    this.grabT = 0;
    this.dropStopY = CFG.dropPalmDefaultY;
    this.pendingCapture = null;
    this.keys = new Set();
    this.panelInput = new Vector2();
    this.enabled = false;
    this.releaseWaitForPrize = false;
    this.releaseStartWins = 0;
    this.carrySettleT = 0;
    this.carryAimT = 0;
    this.hooks = {};
    this._tmpA = new Vector3();
    this._tmpB = new Vector3();
    this._up = new Vector3(0, 1, 0);
    this._headQuat = new Quaternion();
    this._headPhysQuat = new Quaternion();
    this._q0 = new Quaternion();
    this._qL = new Quaternion();
    this._qW = new Quaternion();
    this._axis = new Vector3();
    this._cvA = new CANNON.Vec3();
    this._cvB = new CANNON.Vec3();
    this._cvC = new CANNON.Vec3();
    this._cvD = new CANNON.Vec3();
    this._cqA = new CANNON.Quaternion();
    this._cqB = new CANNON.Quaternion();
    this.ropeMeshUpdateT = 0;
    this.visualHead = null; // сглаженная позиция головы для рендера
    this.visualPalmPos = new CANNON.Vec3();
    this.visualPalmVel = new CANNON.Vec3();
    this.visualPalmQuat = new CANNON.Quaternion();
    this.visualPalmReady = false;

    this.buildRope(world);
    this.buildFingerBodies(world);
    this.buildMeshes(scene);

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  // === верёвка ===
  buildRope(world) {
    const N = CFG.ropeSegs;
    const links = N + 1;
    const segLen = this.ropeLen / links;

    this.anchor = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
    this.anchor.addShape(new CANNON.Sphere(0.02));
    this.anchor.collisionFilterGroup = 0;
    this.anchor.collisionFilterMask = 0;
    this.anchor.position.set(this.pos.x, CFG.pivotY, this.pos.y);
    world.addBody(this.anchor);

    this.ropeBodies = [];
    for (let i = 0; i < N; i++) {
      const b = new CANNON.Body({ mass: 0.22, linearDamping: 0.45, angularDamping: 0.9 });
      b.addShape(new CANNON.Sphere(0.02));
      b.collisionFilterGroup = 0;
      b.collisionFilterMask = 0;
      b.allowSleep = false; // спящую цепь не разбудить сменой длины констрейнта
      b.position.set(this.pos.x, CFG.pivotY - segLen * (i + 1), this.pos.y);
      world.addBody(b);
      this.ropeBodies.push(b);
    }

    // fixedRotation: сфере вращение не нужно, а стабильные оси упрощают всё;
    // масса умеренная — тяжёлая голова при спуске раскидывала кучу.
    // body.position = ТОЧКА ПОДВЕСА (макушка): верёвка тянет за верх,
    // сфера-коллайдер смещена вниз — голова висит и качается как положено
    this.headBody = new CANNON.Body({ mass: 0.8, linearDamping: 0.25, fixedRotation: true });
    this.headBody.addShape(new CANNON.Sphere(0.1), new CANNON.Vec3(0, -CFG.headDrop, 0));
    this.headBody.collisionFilterGroup = 2;
    this.headBody.collisionFilterMask = 1 | 8; // игрушки+пол и стены; не пальцы
    this.headBody.allowSleep = false;
    this.headBody.position.set(this.pos.x, CFG.pivotY - this.ropeLen, this.pos.y);
    this.headBody.updateMassProperties();
    world.addBody(this.headBody);

    this.ropeCons = [];
    const chain = [this.anchor, ...this.ropeBodies, this.headBody];
    for (let i = 0; i < chain.length - 1; i++) {
      const c = new CANNON.DistanceConstraint(chain[i], chain[i + 1], segLen);
      world.addConstraint(c);
      this.ropeCons.push(c);
    }
    this.chain = chain;

    this.palmBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
    this.palmBody.addShape(new CANNON.Sphere(0.025));
    this.palmBody.collisionFilterGroup = 0;
    this.palmBody.collisionFilterMask = 0;
    this.palmBody.position.copy(this.cradleWorldPoint(new CANNON.Vec3()));
    world.addBody(this.palmBody);
  }

  headQuaternionFromChain(headPos, out) {
    if (!this.anchor) return out.identity();
    const toAnchor = this._tmpB.set(
      this.anchor.position.x - headPos.x,
      this.anchor.position.y - headPos.y,
      this.anchor.position.z - headPos.z
    );
    if (toAnchor.lengthSq() <= 1e-6) return out.identity();
    toAnchor.normalize();
    // Никогда не даём голове переворачиваться по локальному звену цепи:
    // купол может только наклоняться как маятник, а пальцы всегда остаются снизу.
    if (toAnchor.y < 0.72) {
      const horiz = Math.hypot(toAnchor.x, toAnchor.z) || 1;
      const h = Math.sqrt(1 - 0.72 * 0.72);
      toAnchor.set((toAnchor.x / horiz) * h, 0.72, (toAnchor.z / horiz) * h);
    }
    return out.setFromUnitVectors(this._up, toAnchor);
  }

  cradleWorldPoint(out = new CANNON.Vec3()) {
    const hp = this.headBody.position;
    const headQ = this.headQuaternionFromChain(hp, this._headPhysQuat);
    const p = this._tmpA.set(0, -CFG.headDrop - CFG.toyPivot, 0).applyQuaternion(headQ);
    return out.set(hp.x + p.x, hp.y + p.y, hp.z + p.z);
  }

  palmAnchor(index, total) {
    if (total <= 1) return new CANNON.Vec3(0, 0, 0);
    const spread = 0.09;
    const a = (index / total) * Math.PI * 2;
    return new CANNON.Vec3(Math.cos(a) * spread, 0, Math.sin(a) * spread);
  }

  toySurfacePivot(toy, worldPoint) {
    const p = toy.body.position;
    let dx = worldPoint.x - p.x, dy = worldPoint.y - p.y, dz = worldPoint.z - p.z;
    let len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) { dx = 0; dy = 1; dz = 0; len = 1; }
    const r = toy.r * 0.55;
    const contact = new CANNON.Vec3(
      p.x + (dx / len) * r,
      p.y + (dy / len) * r,
      p.z + (dz / len) * r
    );
    return toy.body.pointToLocalFrame(contact, new CANNON.Vec3());
  }

  updatePalmBody(dt) {
    const hp = this.headBody.position;
    const headQ = this.headQuaternionFromChain(hp, this._headPhysQuat);
    const p = this._tmpA.set(0, -CFG.headDrop - CFG.toyPivot, 0).applyQuaternion(headQ);
    const x = hp.x + p.x, y = hp.y + p.y, z = hp.z + p.z;
    if (dt > 0) this.palmBody.velocity.set(
      (x - this.palmBody.position.x) / dt,
      (y - this.palmBody.position.y) / dt,
      (z - this.palmBody.position.z) / dt
    );
    this.palmBody.position.set(x, y, z);
    this.palmBody.quaternion.set(headQ.x, headQ.y, headQ.z, headQ.w);
  }

  dampSwing(dt) {
    const settle =
      this.state === STATE.IDLE || this.state === STATE.SETTLE || this.state === STATE.GRAB ||
      this.state === STATE.LIFT || this.state === STATE.CARRY || this.state === STATE.RELEASE;
    const k = Math.exp(-(settle ? CFG.swingSettleDamping : CFG.swingDamping) * dt);
    const av = this.anchor.velocity;
    for (const b of [...this.ropeBodies, this.headBody]) {
      b.velocity.x = av.x + (b.velocity.x - av.x) * k;
      b.velocity.z = av.z + (b.velocity.z - av.z) * k;
      b.velocity.y *= Math.exp(-0.35 * dt);
    }
  }

  centerChainUnderAnchor(dt, strength = CFG.swingCenterDamping) {
    const k = 1 - Math.exp(-strength * dt);
    const ax = this.anchor.position.x;
    const az = this.anchor.position.z;
    const bodies = [...this.ropeBodies, this.headBody];
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      const weight = (i + 1) / bodies.length;
      const pull = k * weight;
      b.position.x += (ax - b.position.x) * pull;
      b.position.z += (az - b.position.z) * pull;
      b.velocity.x *= Math.exp(-strength * 0.8 * dt);
      b.velocity.z *= Math.exp(-strength * 0.8 * dt);
    }
  }

  gripRadius(toy) {
    return toy?.grip?.radius ?? toy?.r ?? 0.24;
  }

  gripDrop(toy) {
    const radius = this.gripRadius(toy);
    return toy?.grip?.drop ?? Math.max(CFG.heldDrop, radius * 0.78);
  }

  toyTopY(toy) {
    return toy.body.position.y + this.gripRadius(toy) * 0.92;
  }

  findToyUnderClaw(radiusMul = 1) {
    const cx = this.pos.x;
    const cz = this.pos.y;
    let best = null;
    for (const toy of this.toys.toys) {
      if (toy.scored || !this.isToyAccessible(toy)) continue;
      const dx = toy.body.position.x - cx;
      const dz = toy.body.position.z - cz;
      const horizontal = Math.hypot(dx, dz);
      const maxHorizontal = Math.max(CFG.dropSenseRadius, this.gripRadius(toy) * 1.25) * radiusMul;
      if (horizontal > maxHorizontal) continue;
      const score = this.toyTopY(toy) - horizontal * 0.5;
      if (!best || score > best.score) best = { toy, score };
    }
    return best?.toy ?? null;
  }

  isToyAccessible(toy) {
    const tr = this.gripRadius(toy);
    for (const other of this.toys.toys) {
      if (other === toy || other.scored) continue;
      const dx = other.body.position.x - toy.body.position.x;
      const dz = other.body.position.z - toy.body.position.z;
      const horizontal = Math.hypot(dx, dz);
      const or = this.gripRadius(other);
      const overlap = Math.min(0.36, Math.max(0.13, Math.min(tr, or) + (tr + or) * CFG.pileBlockOverlap * 0.28));
      const above = other.body.position.y - toy.body.position.y;
      const coversTop = this.toyTopY(other) > toy.body.position.y + tr * 0.35;
      if (horizontal < overlap && above > Math.min(CFG.pileBlockLift, tr * 0.42) && coversTop) return false;
    }
    return true;
  }

  estimateDropStopY() {
    const toy = this.findToyUnderClaw(1);
    if (!toy) return CFG.dropPalmDefaultY;
    const target = toy.body.position.y + this.gripDrop(toy) + CFG.dropPalmClearance;
    return MathUtils.clamp(target, CFG.dropPalmMinY, CFG.dropPalmMaxY);
  }

  updateVisualPalmPose(dt) {
    if (!this.visualHead) return;
    const prevX = this.visualPalmPos.x;
    const prevY = this.visualPalmPos.y;
    const prevZ = this.visualPalmPos.z;
    const q = this.head.quaternion;
    const p = this._tmpA.set(0, -CFG.headDrop - CFG.toyPivot, 0).applyQuaternion(q);
    const x = this.visualHead.x + p.x;
    const y = this.visualHead.y + p.y;
    const z = this.visualHead.z + p.z;
    const safeDt = Math.max(dt, 1 / 120);
    if (this.visualPalmReady) {
      this.visualPalmVel.set((x - prevX) / safeDt, (y - prevY) / safeDt, (z - prevZ) / safeDt);
    } else {
      const v = this.palmBody?.velocity;
      this.visualPalmVel.set(v?.x ?? 0, v?.y ?? 0, v?.z ?? 0);
    }
    this.visualPalmPos.set(x, y, z);
    this.visualPalmQuat.set(q.x, q.y, q.z, q.w);
    this.visualPalmReady = true;
  }

  applyHeldSquash(h, error, grip01, dt) {
    const base = h.baseScale;
    if (!base || !h.toy?.mesh) return;
    const grip = h.grip ?? {};
    const amount = (grip.squish ?? 0.035) * (0.35 + grip01 * 0.65) *
      MathUtils.clamp(1 - error / CFG.breakDist, 0, 1);
    const sx = base.x * (1 + amount * 0.3);
    const sy = base.y * (1 - amount);
    const sz = base.z * (1 + amount * 0.3);
    const k = Math.min(1, 10 * dt);
    h.toy.mesh.scale.x += (sx - h.toy.mesh.scale.x) * k;
    h.toy.mesh.scale.y += (sy - h.toy.mesh.scale.y) * k;
    h.toy.mesh.scale.z += (sz - h.toy.mesh.scale.z) * k;
  }

  lateralSlack(toy, grip, grip01) {
    if (grip?.lateralSlack !== undefined) return grip.lateralSlack;
    const radius = this.gripRadius(toy);
    const weak = Math.min(CFG.gripLateralSlackWeak, radius * 0.42);
    const strong = Math.min(CFG.gripLateralSlackStrong, radius * 0.25);
    return MathUtils.lerp(weak, strong, grip01);
  }

  containHeldLaterally(h, grip01) {
    const body = h.toy.body;
    const local = this.palmBody.pointToLocalFrame(body.position, this._cvB);
    const lx = local.x - h.offset.x;
    const lz = local.z - h.offset.z;
    const lat = Math.hypot(lx, lz);
    const slack = this.lateralSlack(h.toy, h.grip, grip01);
    h.lateralError = lat;
    if (lat <= slack || lat <= 1e-5) return;

    const nx = lx / lat;
    const nz = lz / lat;
    const desiredLocal = this._cvC.set(h.offset.x + nx * slack, local.y, h.offset.z + nz * slack);
    const desiredWorld = this.palmBody.pointToWorldFrame(desiredLocal, this._cvD);
    const excess = lat - slack;
    const correction = Math.min(0.9, (excess / lat) * (0.62 + grip01 * 0.3));
    body.position.x += (desiredWorld.x - body.position.x) * correction;
    body.position.y += (desiredWorld.y - body.position.y) * correction;
    body.position.z += (desiredWorld.z - body.position.z) * correction;

    const relV = this._cvC.set(
      body.velocity.x - this.palmBody.velocity.x,
      body.velocity.y - this.palmBody.velocity.y,
      body.velocity.z - this.palmBody.velocity.z
    );
    const localV = this.palmBody.vectorToLocalFrame(relV, this._cvD);
    const outward = localV.x * nx + localV.z * nz;
    if (outward > 0) {
      const kill = CFG.gripLateralReturn + grip01 * 0.16;
      localV.x -= nx * outward * kill;
      localV.z -= nz * outward * kill;
      const worldV = this.palmBody.vectorToWorldFrame(localV, this._cvD);
      body.velocity.set(
        worldV.x + this.palmBody.velocity.x,
        worldV.y + this.palmBody.velocity.y,
        worldV.z + this.palmBody.velocity.z
      );
    }
    const corrected = this.palmBody.pointToLocalFrame(body.position, this._cvB);
    h.lateralError = Math.hypot(corrected.x - h.offset.x, corrected.z - h.offset.z);
  }

  lockHeldToy(h, dt) {
    const body = h.toy.body;
    const useVisual = this.visualPalmReady;
    let target;
    if (useVisual) {
      this.visualPalmQuat.vmult(h.offset, this._cvA);
      target = this._cvA;
      target.vadd(this.visualPalmPos, target);
    } else {
      target = this.palmBody.pointToWorldFrame(h.offset, this._cvA);
    }
    const safeDt = Math.max(dt, 1 / 120);
    const fallbackVel = useVisual ? this.visualPalmVel : this.palmBody.velocity;
    let vx = h.lastTarget ? (target.x - h.lastTarget.x) / safeDt : fallbackVel.x;
    let vy = h.lastTarget ? (target.y - h.lastTarget.y) / safeDt : fallbackVel.y;
    let vz = h.lastTarget ? (target.z - h.lastTarget.z) / safeDt : fallbackVel.z;
    const speed = Math.hypot(vx, vy, vz);
    if (speed > CFG.gripMaxSpeed) {
      const k = CFG.gripMaxSpeed / speed;
      vx *= k; vy *= k; vz *= k;
    }

    body.position.copy(target);
    body.velocity.set(vx, vy, vz);
    const palmQuat = useVisual ? this.visualPalmQuat : this.palmBody.quaternion;
    palmQuat.mult(h.localQuat, this._cqA);
    body.quaternion.copy(this._cqA);
    body.angularVelocity.set(0, 0, 0);
    body.force.set(0, 0, 0);
    body.torque.set(0, 0, 0);
    body.aabbNeedsUpdate = true;
    body.wakeUp();
    h.error = 0;
    h.lateralError = 0;
    h.lastTarget.copy(target);
    this.applyHeldSquash(h, 0, MathUtils.clamp(this.gripPct / 100, 0, 1), safeDt);
  }

  syncHeldToys(dt) {
    if (!this.held.length) return;
    const safeDt = Math.max(dt, 1 / 120);
    const grip01 = MathUtils.clamp(this.gripPct / 100, 0, 1);
    for (const h of this.held) {
      if (h.locked) {
        this.lockHeldToy(h, safeDt);
        continue;
      }
      const body = h.toy.body;
      const target = this.palmBody.pointToWorldFrame(h.offset, this._cvA);
      const tvx = h.lastTarget ? (target.x - h.lastTarget.x) / safeDt : this.palmBody.velocity.x;
      const tvy = h.lastTarget ? (target.y - h.lastTarget.y) / safeDt : this.palmBody.velocity.y;
      const tvz = h.lastTarget ? (target.z - h.lastTarget.z) / safeDt : this.palmBody.velocity.z;
      const dx = target.x - body.position.x;
      const dy = target.y - body.position.y;
      const dz = target.z - body.position.z;
      const error = Math.hypot(dx, dy, dz);

      const grip = h.grip ?? {};
      const posK = grip.posK ?? MathUtils.lerp(CFG.gripPosKWeak, CFG.gripPosKStrong, grip01);
      let vx = tvx + dx * posK;
      let vy = tvy + dy * posK;
      let vz = tvz + dz * posK;
      const maxSpeed = grip.maxSpeed ?? CFG.gripMaxSpeed;
      const speed = Math.hypot(vx, vy, vz);
      if (speed > maxSpeed) {
        const s = maxSpeed / speed;
        vx *= s; vy *= s; vz *= s;
      }

      const maxForce = MathUtils.lerp(CFG.gripForceWeak, CFG.gripForceStrong, grip01) *
        (grip.forceMul ?? 1);
      const maxAccel = maxForce / Math.max(0.6, body.mass || 1);
      let dvx = vx - body.velocity.x;
      let dvy = vy - body.velocity.y;
      let dvz = vz - body.velocity.z;
      const dv = Math.hypot(dvx, dvy, dvz);
      const maxDv = Math.max(0.04, maxAccel * safeDt);
      if (dv > maxDv) {
        const s = maxDv / dv;
        dvx *= s; dvy *= s; dvz *= s;
      }

      body.velocity.x += dvx;
      body.velocity.y += dvy;
      body.velocity.z += dvz;

      const catchup = grip.catchup ?? CFG.gripCatchup;
      if (error > catchup) {
        const nudge = Math.min(0.45, (error - catchup) / Math.max(error, 0.001)) * 0.35;
        body.position.x += dx * nudge;
        body.position.y += dy * nudge;
        body.position.z += dz * nudge;
      }
      this.containHeldLaterally(h, grip01);

      const rotDamp = Math.exp(-(grip.rotDamping ?? CFG.gripRotDamping) * safeDt);
      body.angularVelocity.x *= rotDamp;
      body.angularVelocity.y *= rotDamp;
      body.angularVelocity.z *= rotDamp;
      const rotFollow = Math.min(0.16, (grip.rotFollow ?? CFG.gripRotFollow) * safeDt * (0.35 + grip01 * 0.65));
      body.quaternion.slerp(h.quat, rotFollow, body.quaternion);
      body.quaternion.normalize();
      body.force.set(0, 0, 0);
      body.torque.set(0, 0, 0);
      body.aabbNeedsUpdate = true;
      body.wakeUp();
      h.error = Math.hypot(target.x - body.position.x, target.y - body.position.y, target.z - body.position.z);
      h.lastTarget.copy(target);
      this.applyHeldSquash(h, h.error, grip01, safeDt);
    }
  }

  applyRopeLen() {
    const segLen = this.ropeLen / this.ropeCons.length;
    for (const c of this.ropeCons) c.distance = segLen;
  }

  // Предохранитель численного взрыва верёвки. DistanceConstraint-цепь с
  // kinematic-якорем при резких рывках каретки накапливает энергию и
  // «выстреливает» голову вверх на десятки метров (а с ней срывается приз,
  // игрушку кидает сквозь стекло). Два жёстких инварианта каждый кадр:
  // 1) голова физически ВСЕГДА ниже точки подвеса — выше якоря она быть не может;
  // 2) ни одно тело цепи не движется быстрее разумного.
  stabilizeRope() {
    const MAX_V = 7;
    for (let i = 0; i < this.ropeBodies.length; i++) {
      const v = this.ropeBodies[i].velocity;
      const s = v.length();
      if (s > MAX_V) { const k = MAX_V / s; v.x *= k; v.y *= k; v.z *= k; }
    }
    const hb = this.headBody;
    const hv = hb.velocity;
    const s = hv.length();
    if (s > MAX_V) { const k = MAX_V / s; hv.x *= k; hv.y *= k; hv.z *= k; }
    // потолок подвеса: голова не выше якоря (с запасом на толщину)
    const ceilY = CFG.pivotY - 0.02;
    if (hb.position.y > ceilY) {
      hb.position.y = ceilY;
      if (hv.y > 0) hv.y = 0;
    }
  }

  // === пальцы: кинематические тела, углы — программная анимация ===
  buildFingerBodies(world) {
    this.fingerPhys = [];
    this._fingerIndex = new Map(); // body → индекс пальца (для контактов)
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const dir = new Vector3(Math.cos(a), 0, Math.sin(a));
      const tang = new Vector3(-Math.sin(a), 0, Math.cos(a));

      const upper = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
      upper.addShape(new CANNON.Box(new CANNON.Vec3(0.026, 0.17, 0.026)));
      upper.collisionFilterGroup = 4;
      upper.collisionFilterMask = 1; // игрушки + пол; не стены, не голова
      upper.allowSleep = false;
      world.addBody(upper);

      const lower = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
      lower.addShape(new CANNON.Box(new CANNON.Vec3(0.022, 0.115, 0.022)));
      lower.collisionFilterGroup = 4;
      lower.collisionFilterMask = 1;
      lower.allowSleep = false;
      world.addBody(lower);

      const f = { upper, lower, dir, tang, phi: CFG.fingerRest, psi: CFG.elbowRest, contact: false };
      this.fingerPhys.push(f);
      this._fingerIndex.set(upper, i);
      this._fingerIndex.set(lower, i);
      this.poseFinger(f, this.headBody.position, 0);
    }
  }

  // поза фаланг из углов (phi, psi) относительно точки головы.
  // dt > 0 — выставить телам разностную скорость (для честных толчков игрушек)
  poseFinger(f, headPos, dt) {
    const headQ = this.headQuaternionFromChain(headPos, this._headPhysQuat);
    const q0 = this._q0.setFromAxisAngle(f.tang, f.phi);
    const pivX = f.dir.x * 0.12;
    const pivY = -CFG.headDrop - 0.04;
    const pivZ = f.dir.z * 0.12;

    const upOff = this._tmpA.set(0, -0.17, 0).applyQuaternion(q0);
    const upper = this._tmpA.set(pivX + upOff.x, pivY + upOff.y, pivZ + upOff.z).applyQuaternion(headQ);
    const ux = headPos.x + upper.x, uy = headPos.y + upper.y, uz = headPos.z + upper.z;
    const elOff = this._tmpB.set(0, -0.34, 0).applyQuaternion(q0);
    const qL = this._qL.setFromAxisAngle(f.tang, f.phi + f.psi);
    const loOff = this._tmpA.set(0, -0.115, 0).applyQuaternion(qL);
    const lower = this._tmpA
      .set(pivX + elOff.x + loOff.x, pivY + elOff.y + loOff.y, pivZ + elOff.z + loOff.z)
      .applyQuaternion(headQ);
    const lx = headPos.x + lower.x, ly = headPos.y + lower.y, lz = headPos.z + lower.z;

    if (dt > 0) {
      f.upper.velocity.set((ux - f.upper.position.x) / dt, (uy - f.upper.position.y) / dt, (uz - f.upper.position.z) / dt);
      f.lower.velocity.set((lx - f.lower.position.x) / dt, (ly - f.lower.position.y) / dt, (lz - f.lower.position.z) / dt);
    }
    f.upper.position.set(ux, uy, uz);
    this._qW.copy(headQ).multiply(q0);
    f.upper.quaternion.set(this._qW.x, this._qW.y, this._qW.z, this._qW.w);
    f.lower.position.set(lx, ly, lz);
    this._qW.copy(headQ).multiply(qL);
    f.lower.quaternion.set(this._qW.x, this._qW.y, this._qW.z, this._qW.w);
  }

  // та же геометрия для мешей, но в локальной системе головы:
  // так пальцы наследуют наклон купола при раскачке.
  poseFingerMeshes(fm) {
    const f = fm.phys;
    const q0 = this._q0.setFromAxisAngle(f.tang, f.phi);
    const pivX = f.dir.x * 0.12;
    const pivY = -CFG.headDrop - 0.04;
    const pivZ = f.dir.z * 0.12;
    const upOff = this._tmpA.set(0, -0.17, 0).applyQuaternion(q0);
    fm.upperM.position.set(pivX + upOff.x, pivY + upOff.y, pivZ + upOff.z);
    fm.upperM.quaternion.copy(q0);
    const elOff = this._tmpB.set(0, -0.34, 0).applyQuaternion(q0);
    const qL = this._qL.setFromAxisAngle(f.tang, f.phi + f.psi);
    const loOff = this._tmpA.set(0, -0.115, 0).applyQuaternion(qL);
    fm.lowerM.position.set(
      pivX + elOff.x + loOff.x, pivY + elOff.y + loOff.y, pivZ + elOff.z + loOff.z
    );
    fm.lowerM.quaternion.copy(qL);
  }

  // контакты пальцев за прошедший шаг физики (world.contacts живёт до следующего step)
  collectFingerContacts() {
    for (const f of this.fingerPhys) f.contact = false;
    for (const eq of this.world.contacts) {
      let idx = this._fingerIndex.get(eq.bi);
      if (idx === undefined) idx = this._fingerIndex.get(eq.bj);
      if (idx !== undefined) this.fingerPhys[idx].contact = true;
    }
  }

  setFingerCollision(enabled) {
    const mask = enabled ? 1 : 0;
    for (const f of this.fingerPhys) {
      f.upper.collisionFilterMask = mask;
      f.lower.collisionFilterMask = mask;
    }
  }

  updateFingers(dt) {
    this.collectFingerContacts();
    const relax = (1 - this.fingerForceMul) * CFG.fingerRelaxMax;
    for (const f of this.fingerPhys) {
      let phiT, psiT, speedMul = 1;
      if (this.fingerMode === 'rest') {
        phiT = CFG.fingerRest;
        psiT = CFG.elbowRest;
      } else if (this.fingerMode === 'open') {
        phiT = CFG.fingerOpen;
        psiT = CFG.elbowOpen;
      } else {
        // Пальцы закрываются под объём выбранной игрушки, не в фиксированную
        // позу: крупный плюш оставляет широкий обхват, мелкий — более плотный.
        const fit = MathUtils.clamp((this.gripFitRadius - 0.18) / 0.22, 0, 1);
        phiT = MathUtils.lerp(CFG.fingerClose, CFG.fingerCloseBig, fit) + relax * 0.85;
        psiT = MathUtils.lerp(CFG.elbowClose, CFG.elbowCloseBig, fit) + relax * 0.65;
        if (f.contact && relax === 0) speedMul = 0.35;
      }
      const step = CFG.fingerSpeed * speedMul * dt;
      f.phi += MathUtils.clamp(phiT - f.phi, -step, step);
      f.psi += MathUtils.clamp(psiT - f.psi, -step, step);
      this.poseFinger(f, this.headBody.position, dt);
    }
  }

  // === меши ===
  buildMeshes(scene) {
    const chrome = new MeshStandardMaterial({ color: 0xb8c1b4, roughness: 0.34, metalness: 1 });
    const chromeDark = new MeshStandardMaterial({ color: 0x32483d, roughness: 0.48, metalness: 0.86 });
    const dark = new MeshStandardMaterial({ color: 0x3b1118, roughness: 0.55, metalness: 0.72 });
    const brushed = new MeshStandardMaterial({ color: 0x8e9a91, roughness: 0.46, metalness: 0.95 });
    const boltMat = new MeshStandardMaterial({ color: 0x111816, roughness: 0.35, metalness: 0.9 });
    const rubberMat = new MeshStandardMaterial({ color: 0x070a08, roughness: 0.72, metalness: 0.18 });
    const railAccent = new MeshStandardMaterial({ color: 0xff3045, roughness: 0.34, metalness: 0.65 });
    const sensorMat = new MeshStandardMaterial({
      color: 0x102521, emissive: 0x38f5ff, emissiveIntensity: 0.28, roughness: 0.44, metalness: 0.6,
    });
    const warningMat = new MeshStandardMaterial({
      color: 0x2a1b08, emissive: 0xffc247, emissiveIntensity: 0.18, roughness: 0.46, metalness: 0.5,
    });
    const amberGlass = new MeshStandardMaterial({
      color: 0xffd38a, emissive: 0xffb13b, emissiveIntensity: 0.35, roughness: 0.2, metalness: 0.05,
      transparent: true, opacity: 0.72,
    });
    this.ringMat = new MeshStandardMaterial({
      color: 0x120806, emissive: 0xff3045, emissiveIntensity: 2.0, roughness: 0.42,
    });

    this.group = new Group();
    scene.add(this.group);

    const railGeo = new RoundedBoxGeometry(0.07, 0.07, CABINET_SPEC.innerZ * 2, 2, 0.012);
    const railCapGeo = new RoundedBoxGeometry(0.024, 0.026, CABINET_SPEC.innerZ * 2 - 0.22, 2, 0.006);
    const railStopGeo = new RoundedBoxGeometry(0.145, 0.09, 0.048, 2, 0.012);
    const limitBoxGeo = new BoxGeometry(0.062, 0.04, 0.088);
    const limitLeverGeo = new CylinderGeometry(0.006, 0.006, 0.095, 8);
    for (const x of [-CABINET_SPEC.innerX + 0.08, CABINET_SPEC.innerX - 0.08]) {
      const rail = new Mesh(railGeo, dark);
      rail.position.set(x, CFG.pivotY + 0.03, 0);
      this.group.add(rail);
      const sx = Math.sign(x);
      const railCap = new Mesh(railCapGeo, brushed);
      railCap.position.set(x - sx * 0.044, CFG.pivotY + 0.087, 0);
      railCap.castShadow = true;
      this.group.add(railCap);
      for (const z of [-CABINET_SPEC.innerZ + 0.11, CABINET_SPEC.innerZ - 0.11]) {
        const stop = new Mesh(railStopGeo, boltMat);
        stop.position.set(x - sx * 0.032, CFG.pivotY + 0.07, z);
        stop.castShadow = true;
        this.group.add(stop);
      }
      for (const z of [-CABINET_SPEC.innerZ + 0.26, CABINET_SPEC.innerZ - 0.26]) {
        const sensor = new Mesh(limitBoxGeo, sensorMat);
        sensor.position.set(x - sx * 0.075, CFG.pivotY + 0.12, z);
        sensor.castShadow = true;
        const lever = new Mesh(limitLeverGeo, warningMat);
        lever.rotation.z = Math.PI / 2;
        lever.position.set(x - sx * 0.118, CFG.pivotY + 0.115, z + Math.sign(z) * 0.052);
        this.group.add(sensor, lever);
      }
    }
    this.bridge = new Group();
    this.bridge.position.set(0, CFG.pivotY + 0.03, this.pos.y);
    const bridgeBeam = new Mesh(new RoundedBoxGeometry(CABINET_SPEC.innerX * 2 - 0.08, 0.08, 0.09, 2, 0.014), dark);
    const bridgeFace = new Mesh(new RoundedBoxGeometry(CABINET_SPEC.innerX * 2 - 0.26, 0.035, 0.035, 2, 0.008), chrome);
    bridgeFace.position.set(0, 0.065, 0.05);
    const bridgeBackFace = bridgeFace.clone();
    bridgeBackFace.position.z = -0.05;
    const bridgeGuideGeo = new BoxGeometry(CABINET_SPEC.innerX * 2 - 0.28, 0.022, 0.018);
    const bridgeGuideFront = new Mesh(bridgeGuideGeo, brushed);
    bridgeGuideFront.position.set(0, 0.104, 0.062);
    const bridgeGuideBack = bridgeGuideFront.clone();
    bridgeGuideBack.position.z = -0.062;
    const bridgeStripe = new Mesh(new BoxGeometry(CABINET_SPEC.innerX * 2 - 0.34, 0.014, 0.012), railAccent);
    bridgeStripe.position.set(0, 0.026, 0.053);
    const bridgeCableTray = new Mesh(new BoxGeometry(CABINET_SPEC.innerX * 2 - 0.44, 0.018, 0.045), rubberMat);
    bridgeCableTray.position.set(0, 0.126, -0.125);
    const bridgeCableLip = new Mesh(new BoxGeometry(CABINET_SPEC.innerX * 2 - 0.48, 0.016, 0.014), brushed);
    bridgeCableLip.position.set(0, 0.145, -0.095);
    const bridgeCableLipBack = bridgeCableLip.clone();
    bridgeCableLipBack.position.z = -0.154;
    const bridgeDatumGeo = new BoxGeometry(0.06, 0.05, 0.024);
    for (const x of [-0.42, 0.42]) {
      const datum = new Mesh(bridgeDatumGeo, sensorMat);
      datum.position.set(x, 0.13, -0.088);
      this.bridge.add(datum);
    }
    const homeLabel = makeMechanismLabel('HOME', 'SENSOR', 0.15, 0.047, '#38f5ff');
    homeLabel.position.set(-0.42, 0.166, -0.073);
    const chainLabel = makeMechanismLabel('CHAIN', 'CABLE', 0.16, 0.046, '#ffc247');
    chainLabel.position.set(-CABINET_SPEC.innerX + 0.42, 0.156, -0.092);
    this.bridge.add(homeLabel, chainLabel);
    const travelTicksGeo = new BoxGeometry(0.018, 0.012, 0.011);
    for (const x of [-0.72, -0.54, -0.36, -0.18, 0, 0.18, 0.36, 0.54, 0.72]) {
      const tick = new Mesh(travelTicksGeo, warningMat);
      tick.position.set(x, 0.129, 0.071);
      this.bridge.add(tick);
    }
    const bridgeStopGeo = new RoundedBoxGeometry(0.07, 0.105, 0.16, 2, 0.014);
    for (const x of [-CABINET_SPEC.innerX + 0.14, CABINET_SPEC.innerX - 0.14]) {
      const stop = new Mesh(bridgeStopGeo, boltMat);
      stop.position.set(x, 0.03, 0);
      stop.castShadow = true;
      this.bridge.add(stop);
    }
    const bridgeBoltGeo = new SphereGeometry(0.012, 8, 5);
    for (const x of [-0.88, -0.44, 0, 0.44, 0.88]) {
      for (const z of [-0.052, 0.052]) {
        const bolt = new Mesh(bridgeBoltGeo, boltMat);
        bolt.position.set(x, 0.088, z);
        this.bridge.add(bolt);
      }
    }
    const cableAnchorBracket = new Mesh(new BoxGeometry(0.105, 0.072, 0.06), chromeDark);
    cableAnchorBracket.position.set(-CABINET_SPEC.innerX + 0.23, 0.14, -0.128);
    cableAnchorBracket.castShadow = true;
    const bridgeAnchorBoltGeo = new SphereGeometry(0.01, 8, 5);
    for (const y of [0.118, 0.162]) {
      const anchorBolt = new Mesh(bridgeAnchorBoltGeo, boltMat);
      anchorBolt.position.set(-CABINET_SPEC.innerX + 0.23, y, -0.092);
      this.bridge.add(anchorBolt);
    }
    this.bridge.add(
      bridgeBeam, bridgeFace, bridgeBackFace, bridgeGuideFront, bridgeGuideBack, bridgeStripe,
      bridgeCableTray, bridgeCableLip, bridgeCableLipBack, cableAnchorBracket
    );
    this.group.add(this.bridge);
    this.trolley = new Group();
    this.trolley.position.set(this.pos.x, CFG.pivotY - 0.055, this.pos.y);
    const trolleyBody = new Mesh(new RoundedBoxGeometry(0.3, 0.17, 0.3, 4, 0.035), chromeDark);
    trolleyBody.castShadow = true;
    const trolleyCover = new Mesh(new RoundedBoxGeometry(0.22, 0.035, 0.34, 3, 0.014), chrome);
    trolleyCover.position.y = 0.102;
    const trolleyPulley = new Mesh(new TorusGeometry(0.075, 0.012, 8, 24), boltMat);
    trolleyPulley.rotation.x = Math.PI / 2;
    trolleyPulley.position.y = -0.01;
    const trolleyMotor = new Mesh(new CylinderGeometry(0.047, 0.047, 0.15, 24), brushed);
    trolleyMotor.rotation.z = Math.PI / 2;
    trolleyMotor.position.set(-0.055, 0.145, -0.035);
    trolleyMotor.castShadow = true;
    const trolleyCap = new Mesh(new CylinderGeometry(0.052, 0.052, 0.018, 20), boltMat);
    trolleyCap.rotation.z = Math.PI / 2;
    trolleyCap.position.set(0.028, 0.145, -0.035);
    const trolleyRearCap = trolleyCap.clone();
    trolleyRearCap.position.x = -0.138;
    const motorFinGeo = new TorusGeometry(0.05, 0.004, 6, 20);
    for (const x of [-0.105, -0.065, -0.025]) {
      const fin = new Mesh(motorFinGeo, chromeDark);
      fin.rotation.y = Math.PI / 2;
      fin.position.set(x, 0.145, -0.035);
      this.trolley.add(fin);
    }
    const trolleySocket = new Mesh(new BoxGeometry(0.09, 0.055, 0.05), rubberMat);
    trolleySocket.position.set(-0.125, 0.065, -0.19);
    const trolleySidePlate = new Mesh(new RoundedBoxGeometry(0.24, 0.115, 0.018, 2, 0.007), chromeDark);
    trolleySidePlate.position.set(0, 0.0, 0.164);
    const trolleyBackPlate = trolleySidePlate.clone();
    trolleyBackPlate.position.z = -0.164;
    const trolleyRedStripe = new Mesh(new BoxGeometry(0.19, 0.018, 0.021), railAccent);
    trolleyRedStripe.position.set(0, 0.026, 0.178);
    const trolleyBackStripe = trolleyRedStripe.clone();
    trolleyBackStripe.position.z = -0.178;
    const saddleTop = new Mesh(new RoundedBoxGeometry(0.34, 0.026, 0.112, 2, 0.009), brushed);
    saddleTop.position.y = 0.188;
    saddleTop.castShadow = true;
    const saddleJawGeo = new BoxGeometry(0.035, 0.13, 0.024);
    const saddleBoltGeo = new SphereGeometry(0.011, 8, 5);
    for (const x of [-0.145, 0.145]) {
      for (const z of [-0.064, 0.064]) {
        const jaw = new Mesh(saddleJawGeo, chromeDark);
        jaw.position.set(x, 0.116, z);
        jaw.castShadow = true;
        this.trolley.add(jaw);
        const bolt = new Mesh(saddleBoltGeo, boltMat);
        bolt.position.set(x, 0.188, z);
        this.trolley.add(bolt);
      }
    }
    const sideRollerGeo = new CylinderGeometry(0.032, 0.032, 0.03, 16);
    const axleGeo = new CylinderGeometry(0.01, 0.01, 0.245, 10);
    for (const y of [0.105, 0.17]) {
      const axle = new Mesh(axleGeo, boltMat);
      axle.rotation.x = Math.PI / 2;
      axle.position.set(0, y, 0);
      this.trolley.add(axle);
      for (const z of [-0.142, 0.142]) {
        const roller = new Mesh(sideRollerGeo, rubberMat);
        roller.rotation.x = Math.PI / 2;
        roller.position.set(0, y, z);
        roller.castShadow = true;
        this.trolley.add(roller);
      }
    }
    const trolleyFlag = new Mesh(new BoxGeometry(0.026, 0.092, 0.018), warningMat);
    trolleyFlag.position.set(0.165, 0.1, -0.08);
    trolleyFlag.castShadow = true;
    const trolleyLimitLabel = makeMechanismLabel('X', 'LIMIT', 0.1, 0.042, '#ff3045');
    trolleyLimitLabel.position.set(0.0, 0.058, 0.176);
    const winchDrum = new Mesh(new CylinderGeometry(0.04, 0.04, 0.12, 24), brushed);
    winchDrum.rotation.z = Math.PI / 2;
    winchDrum.position.set(0, -0.105, 0);
    winchDrum.castShadow = true;
    const winchFlangeGeo = new CylinderGeometry(0.052, 0.052, 0.012, 24);
    const winchFlangeL = new Mesh(winchFlangeGeo, chromeDark);
    winchFlangeL.rotation.z = Math.PI / 2;
    winchFlangeL.position.set(-0.066, -0.105, 0);
    const winchFlangeR = winchFlangeL.clone();
    winchFlangeR.position.x = 0.066;
    const winchAxle = new Mesh(new CylinderGeometry(0.012, 0.012, 0.175, 12), boltMat);
    winchAxle.rotation.z = Math.PI / 2;
    winchAxle.position.set(0, -0.105, 0);
    const bottomPlate = new Mesh(new RoundedBoxGeometry(0.21, 0.024, 0.17, 2, 0.008), brushed);
    bottomPlate.position.y = -0.092;
    const fairlead = new Mesh(new TorusGeometry(0.025, 0.007, 8, 22), boltMat);
    fairlead.rotation.x = Math.PI / 2;
    fairlead.position.y = -0.16;
    const wheelGeo = new CylinderGeometry(0.043, 0.043, 0.026, 18);
    for (const x of [-0.105, 0.105]) {
      for (const z of [-0.16, 0.16]) {
        const wheel = new Mesh(wheelGeo, rubberMat);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x, 0.055, z);
        wheel.castShadow = true;
        this.trolley.add(wheel);
      }
    }
    this.trolley.add(
      trolleyBody, trolleyCover, trolleyPulley, trolleyMotor, trolleyCap, trolleyRearCap, trolleySocket,
      trolleySidePlate, trolleyBackPlate, trolleyRedStripe, trolleyBackStripe, saddleTop, trolleyFlag,
      trolleyLimitLabel, winchDrum, winchFlangeL, winchFlangeR, winchAxle, bottomPlate, fairlead
    );
    this.group.add(this.trolley);

    this.cableChain = [];
    const cableLinkGeo = new RoundedBoxGeometry(0.055, 0.022, 0.032, 2, 0.006);
    for (let i = 0; i < 18; i++) {
      const link = new Mesh(cableLinkGeo, i % 2 ? rubberMat : boltMat);
      link.castShadow = true;
      this.group.add(link);
      this.cableChain.push(link);
    }

    this.ropePoints = this.chain.map((body) => new Vector3(body.position.x, body.position.y, body.position.z));
    this.ropeTargetPoints = this.ropePoints.map((p) => p.clone());
    this.ropeCurve = new CatmullRomCurve3(this.ropePoints, false, 'centripetal', 0.28);
    const ropeWeave = makeCableWeaveTexture();
    const ropeMat = new MeshStandardMaterial({
      color: 0xd2c7a4,
      map: ropeWeave,
      bumpMap: ropeWeave,
      bumpScale: 0.01,
      roughness: 0.62,
      metalness: 0.3,
    });
    this.ropeMesh = new Mesh(new TubeGeometry(this.ropeCurve, 32, 0.014, 8, false), ropeMat);
    this.ropeMesh.castShadow = true;
    this.group.add(this.ropeMesh);

    // origin группы = МАКУШКА (точка подвеса): наклон вращает голову вокруг
    // точки крепления троса, а не вокруг центра купола
    this.head = new Group();
    const headInner = new Group();
    headInner.position.y = -CFG.headDrop;
    const neck = new Mesh(new CylinderGeometry(0.035, 0.05, 0.12, 10), chromeDark);
    neck.position.y = 0.2;
    const neckBoot = new Mesh(new CylinderGeometry(0.033, 0.047, 0.075, 16), rubberMat);
    neckBoot.position.y = 0.235;
    const strainRingGeo = new TorusGeometry(0.039, 0.0045, 6, 20);
    const strainRingA = new Mesh(strainRingGeo, boltMat);
    strainRingA.rotation.x = Math.PI / 2;
    strainRingA.position.y = 0.22;
    const strainRingB = strainRingA.clone();
    strainRingB.position.y = 0.247;
    const cableCollar = new Mesh(new TorusGeometry(0.046, 0.007, 8, 24), boltMat);
    cableCollar.rotation.x = Math.PI / 2;
    cableCollar.position.y = 0.145;
    const topCap = new Mesh(new CylinderGeometry(0.085, 0.07, 0.045, 20), brushed);
    topCap.position.y = 0.105;
    const dome = new Mesh(new SphereGeometry(0.17, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), chrome);
    dome.position.y = 0.02;
    dome.castShadow = true;
    const visor = new Mesh(new TorusGeometry(0.118, 0.008, 8, 28), amberGlass);
    visor.rotation.x = Math.PI / 2;
    visor.position.y = 0.034;
    const skirt = new Mesh(new CylinderGeometry(0.17, 0.115, 0.1, 24), chrome);
    skirt.position.y = -0.03;
    skirt.castShadow = true;
    const ring = new Mesh(new TorusGeometry(0.155, 0.013, 8, 32), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    const hub = new Mesh(new CylinderGeometry(0.06, 0.075, 0.06, 12), chromeDark);
    hub.position.y = -0.09;
    const hubBand = new Mesh(new TorusGeometry(0.064, 0.006, 8, 20), boltMat);
    hubBand.rotation.x = Math.PI / 2;
    hubBand.position.y = -0.062;
    const boltGeo = new SphereGeometry(0.014, 10, 6);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const bolt = new Mesh(boltGeo, boltMat);
      bolt.position.set(Math.cos(a) * 0.132, -0.025, Math.sin(a) * 0.132);
      bolt.castShadow = true;
      headInner.add(bolt);
    }
    const statusLampGeo = new SphereGeometry(0.011, 10, 7);
    for (let i = -1; i <= 1; i++) {
      const lamp = new Mesh(statusLampGeo, i === 0 ? warningMat : sensorMat);
      lamp.position.set(i * 0.04, -0.042, 0.148);
      headInner.add(lamp);
    }
    headInner.add(neck, neckBoot, strainRingA, strainRingB, cableCollar, topCap, dome, visor, skirt, ring, hub, hubBand);
    this.head.add(headInner);
    this.group.add(this.head);

    this.fingerMeshes = [];
    const f1Geo = makeFingerLinkGeometry(0.31, 0.031, 0.04, 0.048);
    const f2Geo = makeFingerLinkGeometry(0.21, 0.037, 0.026, 0.044);
    const jointGeo = new SphereGeometry(0.036, 12, 8);
    const tipGeo = new ConeGeometry(0.024, 0.1, 10);
    const upperRailGeo = new RoundedBoxGeometry(0.011, 0.22, 0.012, 2, 0.004);
    const lowerRailGeo = new RoundedBoxGeometry(0.01, 0.145, 0.011, 2, 0.0035);
    const bandGeo = new TorusGeometry(0.034, 0.0045, 6, 18);
    const lowerBandGeo = new TorusGeometry(0.028, 0.004, 6, 18);
    const pinGeo = new CylinderGeometry(0.014, 0.014, 0.11, 12);
    const rubberTipGeo = new RoundedBoxGeometry(0.06, 0.032, 0.068, 3, 0.012);
    const screwGeo = new SphereGeometry(0.008, 8, 5);
    for (const f of this.fingerPhys) {
      const mount = new Group();
      mount.position.set(f.dir.x * 0.12, -CFG.headDrop - 0.04, f.dir.z * 0.12);
      const mountBlock = new Mesh(new RoundedBoxGeometry(0.09, 0.04, 0.055, 2, 0.012), chromeDark);
      const mountPin = new Mesh(pinGeo, boltMat);
      mountPin.quaternion.setFromUnitVectors(this._up, f.tang);
      const mountPlate = new Mesh(new RoundedBoxGeometry(0.072, 0.018, 0.072, 2, 0.009), brushed);
      mountPlate.position.y = 0.026;
      mount.add(mountBlock, mountPin, mountPlate);
      this.head.add(mount);

      const upperM = new Group();
      const c1 = new Mesh(f1Geo, brushed);
      c1.castShadow = true;
      const joint = new Mesh(jointGeo, chromeDark);
      joint.position.y = -0.17;
      const upperRailL = new Mesh(upperRailGeo, brushed);
      upperRailL.position.set(-0.026, -0.005, 0.031);
      const upperRailR = upperRailL.clone();
      upperRailR.position.x = 0.026;
      const upperBandTop = new Mesh(bandGeo, boltMat);
      upperBandTop.rotation.x = Math.PI / 2;
      upperBandTop.position.y = 0.08;
      const upperBandBottom = upperBandTop.clone();
      upperBandBottom.position.y = -0.095;
      const jointPin = new Mesh(pinGeo, boltMat);
      jointPin.rotation.z = Math.PI / 2;
      jointPin.position.y = -0.17;
      const jointScrewA = new Mesh(screwGeo, boltMat);
      jointScrewA.position.set(-0.048, -0.17, 0.006);
      const jointScrewB = jointScrewA.clone();
      jointScrewB.position.x = 0.048;
      upperM.add(c1, upperRailL, upperRailR, upperBandTop, upperBandBottom, joint, jointPin, jointScrewA, jointScrewB);

      const lowerM = new Group();
      const c2 = new Mesh(f2Geo, chrome);
      c2.castShadow = true;
      const lowerRailL = new Mesh(lowerRailGeo, brushed);
      lowerRailL.position.set(-0.022, -0.002, 0.029);
      const lowerRailR = lowerRailL.clone();
      lowerRailR.position.x = 0.022;
      const lowerBand = new Mesh(lowerBandGeo, boltMat);
      lowerBand.rotation.x = Math.PI / 2;
      lowerBand.position.y = 0.045;
      const tip = new Mesh(tipGeo, chromeDark);
      tip.position.y = -0.14;
      tip.rotation.x = Math.PI;
      const rubberTip = new Mesh(rubberTipGeo, rubberMat);
      rubberTip.position.y = -0.19;
      rubberTip.rotation.x = 0.18;
      rubberTip.castShadow = true;
      lowerM.add(c2, lowerRailL, lowerRailR, lowerBand, tip, rubberTip);
      this.head.add(upperM, lowerM);
      this.fingerMeshes.push({ upperM, lowerM, phys: f });
    }
  }

  onKey(e, down) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) {
      e.preventDefault();
      if (!this.enabled) return;
      if (down) this.keys.add(e.code); else this.keys.delete(e.code);
      if (down && e.code === 'Space') this.tryStart();
    }
  }

  updateRopeMesh(dt) {
    if (!this.ropeMesh || !this.ropeCurve || !this.ropePoints) return;
    const k = 1 - Math.exp(-CFG.ropeVisualSmooth * dt);
    for (let i = 0; i < this.ropePoints.length; i++) {
      const p = i === this.ropePoints.length - 1 ? this.visualHead : this.chain[i].position;
      const target = this.ropeTargetPoints?.[i] ?? this.ropePoints[i];
      target.set(p.x, p.y, p.z);
      if (i === this.ropePoints.length - 1 || i === 0) {
        this.ropePoints[i].copy(target);
      } else {
        this.ropePoints[i].lerp(target, k);
      }
    }
    this.ropeMeshUpdateT += dt;
    if (this.ropeMeshUpdateT < 1 / CFG.ropeVisualHz) return;
    this.ropeMeshUpdateT = 0;
    const previousGeometry = this.ropeMesh.geometry;
    this.ropeMesh.geometry = new TubeGeometry(
      this.ropeCurve,
      Math.max(28, (this.ropePoints.length - 1) * 4),
      0.014,
      8,
      false
    );
    previousGeometry.dispose();
  }

  updateCableChain() {
    if (!this.cableChain?.length) return;
    const startX = -CABINET_SPEC.innerX + 0.23;
    const endX = Math.max(startX + 0.12, this.pos.x - 0.09);
    const z = this.pos.y - 0.2;
    const baseY = CFG.pivotY + 0.115;
    const span = endX - startX;
    const sag = Math.min(0.09, 0.018 + span * 0.03);
    const count = this.cableChain.length;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const x = MathUtils.lerp(startX, endX, t);
      const curveY = baseY - Math.sin(Math.PI * t) * sag;
      const curveZ = z - Math.sin(Math.PI * t) * 0.018;
      const slope = -Math.cos(Math.PI * t) * sag * Math.PI / Math.max(span, 0.12);
      const link = this.cableChain[i];
      link.position.set(x, curveY, curveZ);
      link.rotation.set(0, Math.sin(t * Math.PI * 2) * 0.08, Math.atan(slope));
      link.scale.x = Math.max(0.62, Math.min(1.22, span / 1.15));
      link.visible = span > 0.08 || i < 3;
    }
  }

  tryStart() {
    if (!this.enabled || this.state !== STATE.IDLE) return;
    if (this.hooks.gate && !this.hooks.gate()) return;
    this.hooks.onSpend?.();
    this.hooks.onAttempt?.();
    this.pendingCapture = null;
    this.dropStopY = this.estimateDropStopY();
    this.state = STATE.DESCEND;
    this.tries++;
    ui.setTries(this.tries);
    ui.setStatus('descend');
  }

  estimateGrabRadius() {
    const target = this.latchCaptureCandidate(0.02);
    return target ? this.gripRadius(target) : 0.24;
  }

  latchCaptureCandidate(slack = 0) {
    const palm = this.cradleWorldPoint(this._cvA);
    const grabPoint = this._tmpA.set(palm.x, palm.y, palm.z);
    const target = this.captureCandidates(grabPoint, 1, slack)[0] ?? null;
    this.pendingCapture = target;
    return target;
  }

  canCaptureToy(toy, grabPoint, slack = 0) {
    if (toy.scored) return false;
    if (!this.isToyAccessible(toy)) return false;
    const radius = this.gripRadius(toy);
    const drop = this.gripDrop(toy);
    const dx = toy.body.position.x - grabPoint.x;
    const dz = toy.body.position.z - grabPoint.z;
    const horizontal = Math.hypot(dx, dz);
    const vertical = grabPoint.y - toy.body.position.y;
    const maxHorizontal = Math.min(
      CFG.captureHorizMax,
      Math.max(CFG.captureHorizMin, radius * CFG.captureHorizRadius)
    ) + slack;
    const vertTolerance = Math.max(CFG.captureVertTolerance, radius * 0.55) + slack * 1.35;
    const maxSnap = Math.min(
      CFG.captureSnapMax,
      Math.max(CFG.captureSnapMin, radius * 0.68)
    ) + slack * 1.35;
    const snap = Math.hypot(dx, vertical - drop, dz);
    return (
      horizontal <= maxHorizontal &&
      vertical > 0.02 &&
      Math.abs(vertical - drop) <= vertTolerance &&
      snap <= maxSnap
    );
  }

  captureCandidates(grabPoint, limit = CFG.grabMax, slack = 0) {
    const candidates = [];
    for (const toy of this.toys.toys) {
      if (!this.canCaptureToy(toy, grabPoint, slack)) continue;
      const dx = toy.body.position.x - grabPoint.x;
      const dz = toy.body.position.z - grabPoint.z;
      const horizontal = Math.hypot(dx, dz);
      const vertical = grabPoint.y - toy.body.position.y;
      const top = this.toyTopY(toy);
      candidates.push({
        toy,
        score: horizontal * 2.3 + Math.abs(vertical - this.gripDrop(toy)) * 0.85 - top * 0.18,
      });
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates.slice(0, limit).map((c) => c.toy);
  }

  get jackpotCharged() {
    const n = Math.round(settings.jackpotN);
    return n > 0 && this.weakStreak >= n;
  }

  rollGrip() {
    if (this.jackpotCharged) {
      this.gripPct = 85 + Math.round(Math.random() * 15);
      this.weakStreak = 0;
      this.jackpotHit = true;
      sfx.jackpotReady();
      vibrate('jackpot');
    } else {
      this.jackpotHit = false;
      const g = settings.generosity ?? 50;
      const exp = (105 - g) / 55;
      this.gripPct = Math.round(100 * Math.pow(Math.random(), exp));
      if (this.gripPct < 60) this.weakStreak++;
      else this.weakStreak = 0;
    }
    this.grip = CFG.gripMin + (this.gripPct / 100) * (CFG.gripMax - CFG.gripMin);
  }

  attemptGrab() {
    const palm = this.cradleWorldPoint(this._cvA);
    const grabPoint = this._tmpA.set(palm.x, palm.y, palm.z);
    let targets = [];
    if (this.pendingCapture && this.canCaptureToy(this.pendingCapture, grabPoint, CFG.captureLatchSlack)) {
      targets = [this.pendingCapture];
    } else {
      targets = this.captureCandidates(grabPoint, CFG.grabMax);
    }
    if (!targets.length) {
      this.pendingCapture = null;
      ui.setStatus('grabEmpty');
      sfx.empty();
      return;
    }
    this.rollGrip();
    sfx.grabClick();
    vibrate('grab');
    targets.forEach((toy, i) => {
      toy.body.wakeUp();
      const oldLinearDamping = toy.body.linearDamping;
      const oldAngularDamping = toy.body.angularDamping;
      const oldGroup = toy.body.collisionFilterGroup;
      const oldMask = toy.body.collisionFilterMask;
      toy.body.collisionFilterGroup = 16;
      toy.body.collisionFilterMask = 8 | 32;
      toy.body.linearDamping = Math.max(toy.body.linearDamping, 0.38);
      toy.body.angularDamping = Math.max(toy.body.angularDamping, 0.82);
      const palmVel = this.visualPalmReady ? this.visualPalmVel : this.palmBody.velocity;
      toy.body.velocity.set(palmVel.x, palmVel.y, palmVel.z);
      toy.body.angularVelocity.set(0, 0, 0);
      toy.regroupAt = 0;
      const grip = toy.grip ?? {};
      const offset = new CANNON.Vec3(0, -this.gripDrop(toy), 0);
      const initialTarget = new CANNON.Vec3();
      if (this.visualPalmReady) {
        this.visualPalmQuat.vmult(offset, initialTarget);
        initialTarget.vadd(this.visualPalmPos, initialTarget);
      } else {
        this.palmBody.pointToWorldFrame(offset, initialTarget);
      }
      const baseScale = toy.mesh.userData.baseScale?.clone?.() ?? toy.mesh.scale.clone();
      const palmQuat = this.visualPalmReady ? this.visualPalmQuat : this.palmBody.quaternion;
      palmQuat.inverse(this._cqA);
      this._cqA.mult(toy.body.quaternion, this._cqB);
      const localQuat = new CANNON.Quaternion(this._cqB.x, this._cqB.y, this._cqB.z, this._cqB.w);
      toy.body.position.copy(initialTarget);
      this.held.push({
        toy,
        offset,
        grip,
        baseScale,
        locked: true,
        localQuat,
        quat: new CANNON.Quaternion(
          toy.body.quaternion.x, toy.body.quaternion.y, toy.body.quaternion.z, toy.body.quaternion.w
        ),
        lastTarget: initialTarget,
        error: 0,
        oldLinearDamping, oldAngularDamping, oldGroup, oldMask,
      });
      this.toys.onCaptured?.(toy);
    });
    this.pendingCapture = null;
    this.gripFitRadius = Math.max(...targets.map((toy) => this.gripRadius(toy)), this.gripFitRadius);
    ui.showGrip(this.gripPct);
    this.fingerHold = true;
    const n = targets.length;
    const fugitiveMode = settings.gameMode === 'fugitives';
    const msg = this.jackpotHit
      ? tr(`ДЖЕКПОТ-ХВАТ ${this.gripPct}%! Держит как родную.`, `JACKPOT GRIP ${this.gripPct}%! Holding tight.`)
      : n > 1
        ? fugitiveMode
          ? tr(`Хват ${this.gripPct}% — поймали сразу ${n}! Паника усиливается.`, `${this.gripPct}% grip — caught ${n} at once! Panic intensifies.`)
          : tr(`Хват ${this.gripPct}% на ${n} штуки — жадность…`, `${this.gripPct}% grip on ${n} toys — greedy…`)
        : this.gripPct > 60
          ? fugitiveMode
            ? tr(`Хват ${this.gripPct}% — беглец пойман крепко!`, `${this.gripPct}% grip — fugitive secured!`)
            : tr(`Хват ${this.gripPct}% — взяли крепко!`, `${this.gripPct}% grip — looking strong!`)
          : fugitiveMode
            ? tr(`Хват ${this.gripPct}% — ещё может вырваться…`, `${this.gripPct}% grip — they may still escape…`)
            : tr(`Хват ${this.gripPct}% — ну, попробуем…`, `${this.gripPct}% grip — let us see…`);
    ui.setStatus('carry', msg);
  }

  dropOne(idx, slipped) {
    const h = this.held[idx];
    if (!h) return;
    // полсекунды без коллизий с клешнёй: выпадает вертикально сквозь пальцы,
    // иначе раскрытие отбивает её мимо дыры, а rest-смыкание зажимает обратно
    h.toy.body.collisionFilterGroup = 16;
    h.toy.body.collisionFilterMask = h.oldMask ?? -1;
    h.toy.body.linearDamping = h.oldLinearDamping ?? 0.15;
    h.toy.body.angularDamping = h.oldAngularDamping ?? 0.6;
    if (h.baseScale) h.toy.mesh.scale.copy(h.baseScale);
    const bv = h.toy.body.velocity;
    h.toy.body.velocity.set(
      bv.x * 0.45 + this.palmBody.velocity.x * 0.55,
      Math.min(bv.y * 0.35 + this.palmBody.velocity.y * 0.55, 0) - (slipped ? 0.45 : 0.15),
      bv.z * 0.45 + this.palmBody.velocity.z * 0.55
    );
    h.toy.body.angularVelocity.set(
      (Math.random() - 0.5) * 1.2,
      (Math.random() - 0.5) * 0.7,
      (Math.random() - 0.5) * 1.2
    );
    h.toy.regroupAt = performance.now() / 1000 + 0.6;
    h.toy.restoreGroup = h.oldGroup ?? 1;
    h.toy.prizeEligible = !slipped && this.state === STATE.RELEASE && this.releaseWaitForPrize;
    this.toys.onReleased?.(h.toy, slipped);
    this.held.splice(idx, 1);
    if (slipped) {
      ui.setStatus('slip');
      sfx.slip();
      vibrate('slip');
    }
    if (!this.held.length) ui.showGrip(null);
  }

  dropAll(slipped) {
    while (this.held.length) this.dropOne(0, slipped);
    if (slipped) ui.setStatus('slip');
    ui.showGrip(null);
  }

  weakenCheck(dt) {
    if (!this.held.length) return;
    for (let i = this.held.length - 1; i >= 0; i--) {
      const holdPoint = this.palmBody.pointToWorldFrame(this.held[i].offset, this._cvA);
      const t = this.held[i].toy.body.position;
      const dx = holdPoint.x - t.x, dy = holdPoint.y - t.y, dz = holdPoint.z - t.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > CFG.breakDist) this.dropOne(i, true);
    }
    if (!this.held.length) return;

    this.slipTimer += dt;
    if (this.slipTimer < CFG.slipCheckEvery) return;
    this.slipTimer = 0;
    if (settings.meanClaw && this.gripPct < CFG.weakGripPct) {
      const chance = CFG.slipChance * (1 - this.gripPct / CFG.weakGripPct);
      if (Math.random() < chance) {
        // клешня «устала»: слабеет страховка и приоткрываются пальцы
        const victimIndex = this.held.length - 1;
        const victim = this.held[victimIndex];
        this.fingerForceMul = Math.max(0.2, this.fingerForceMul * 0.5);
        if (victim.locked) {
          this.dropOne(victimIndex, true);
          return;
        }
        victim.offset.y -= 0.08;
        const slipLimit = Math.max(0.38, this.gripDrop(victim.toy) + this.gripRadius(victim.toy) * 0.75);
        if (victim.offset.y < -slipLimit) this.dropOne(victimIndex, true);
      }
    }
  }

  update(dt) {
    const gp = pollGamepad();
    if (gp?.grabPressed && this.enabled) this.tryStart();

    let motor = 0.12;
    switch (this.state) {
      case STATE.IDLE: {
        this.setFingerCollision(true);
        let ix = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);
        let iz = (this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('ArrowUp') ? 1 : 0);
        if (gp && this.enabled) { ix += gp.x; iz += gp.z; }
        ix += this.panelInput.x;
        iz += this.panelInput.y;
        const target = new Vector2(ix, iz);
        if (target.lengthSq() > 1) target.normalize();
        target.multiplyScalar(CFG.speed);
        this.vel.lerp(target, Math.min(1, CFG.accel * dt));
        this.pos.addScaledVector(this.vel, dt);
        this.pos.x = MathUtils.clamp(this.pos.x, -CFG.boundX, CFG.boundX);
        this.pos.y = MathUtils.clamp(this.pos.y, -CFG.boundZ, CFG.boundZ);
        this.fingerMode = 'rest'; // в покое клешня расслабленно полусомкнута
        this.fingerForceMul = 1;
        this.gripFitRadius = 0.24;
        motor = (this.vel.length() / CFG.speed) * 0.8;
        break;
      }
      case STATE.DESCEND: {
        this.setFingerCollision(false);
        this.vel.lerp(new Vector2(0, 0), Math.min(1, 12 * dt));
        const palmBefore = this.cradleWorldPoint(this._cvA);
        const remaining = Math.max(0, palmBefore.y - this.dropStopY);
        const slowMul = MathUtils.clamp(remaining / CFG.dropSlowZone, CFG.dropMinSpeedMul, 1);
        this.ropeLen = Math.min(CFG.ropeMax, this.ropeLen + CFG.dropSpeed * slowMul * dt);
        this.applyRopeLen();
        this.centerChainUnderAnchor(dt, CFG.swingCenterDamping * 0.55);
        this.fingerMode = 'open'; // на спуске раскрывается, готовясь хватать
        motor = 0.55;
        const palm = this.cradleWorldPoint(this._cvA);
        if (this.ropeLen >= CFG.ropeMax || palm.y <= this.dropStopY) {
          this.state = STATE.SETTLE;
          this.settleT = 0;
        }
        break;
      }
      case STATE.SETTLE: {
        this.setFingerCollision(false);
        this.settleT += dt;
        this.centerChainUnderAnchor(dt, CFG.swingCenterDamping);
        motor = 0.2;
        if (this.settleT >= CFG.settleTime) {
          this.state = STATE.GRAB;
          this.grabT = 0;
          this.gripFitRadius = this.estimateGrabRadius();
          this.fingerMode = 'close';
        }
        break;
      }
      case STATE.GRAB: {
        this.setFingerCollision(false);
        this.grabT += dt;
        this.centerChainUnderAnchor(dt, CFG.swingCenterDamping * 0.65);
        motor = 0.3;
        if (this.grabT >= CFG.closeTime) {
          this.attemptGrab();
          this.state = STATE.LIFT;
        }
        break;
      }
      case STATE.LIFT: {
        this.setFingerCollision(false);
        this.ropeLen = Math.max(CFG.ropeLift, this.ropeLen - CFG.liftSpeed * dt);
        this.applyRopeLen();
        this.weakenCheck(dt);
        motor = 0.6;
        if (this.ropeLen <= CFG.ropeLift) {
          if (this.held.length) {
            // В переносе держим игрушку в локальной позе ладони.
            // Коллизии с пальцами вернутся после сброса, иначе будет дрожь.
            this.state = STATE.CARRY;
            this.carrySettleT = 0;
            this.carryAimT = 0;
          } else {
            this.state = STATE.RELEASE;
            this.releaseWaitForPrize = false;
            this.releaseStartWins = this.wins;
          }
          this.releaseT = 0.8;
        }
        break;
      }
      case STATE.CARRY: {
        this.setFingerCollision(false);
        const dir = new Vector2(this.dropPoint.x - this.pos.x, this.dropPoint.z - this.pos.y);
        const dist = dir.length();
        motor = 0.7;
        if (dist < 0.04) {
          this.pos.set(this.dropPoint.x, this.dropPoint.z);
          this.carryAimT += dt;
          this.centerChainUnderAnchor(dt, CFG.swingCenterDamping * 2.4);
          const palm = this.cradleWorldPoint(this._cvA);
          const palmDist = Math.hypot(this.dropPoint.x - palm.x, this.dropPoint.z - palm.z);
          const swaySpeed = Math.hypot(
            this.headBody.velocity.x - this.anchor.velocity.x,
            this.headBody.velocity.z - this.anchor.velocity.z
          );
          if (palmDist <= CFG.carryPalmTolerance && swaySpeed <= CFG.carryPalmSpeed) this.carrySettleT += dt;
          else this.carrySettleT = 0;
          if (this.carrySettleT >= CFG.carrySettleTime || this.carryAimT >= 1.8) {
            this.state = STATE.RELEASE;
            this.releaseT = 0.8;
            this.releaseWaitForPrize = this.held.length > 0;
            this.releaseStartWins = this.wins;
          }
        } else {
          this.carrySettleT = 0;
          this.carryAimT = 0;
          dir.normalize().multiplyScalar(Math.min(CFG.carrySpeed, dist / dt));
          this.pos.addScaledVector(dir, dt);
        }
        this.weakenCheck(dt);
        break;
      }
      case STATE.RELEASE: {
        this.setFingerCollision(false);
        this.releaseT -= dt;
        motor = 0.2;
        // фаза 1: приспуститься над лотком (качание гаснет, падать ближе —
        // гроздь не разлетается мимо дыры); фаза 2: раскрыть и отпустить
        if (this.releaseT > 0.2 && this.held.length) {
          this.ropeLen = Math.min(1.05, this.ropeLen + CFG.dropSpeed * dt);
          this.applyRopeLen();
          this.centerChainUnderAnchor(dt, CFG.swingCenterDamping * 2.1);
          motor = 0.5;
        }
        if (this.releaseT <= 0.2) {
          this.fingerMode = 'open';
          if (this.held.length) this.dropAll(false);
        }
        const idleThreshold = this.releaseWaitForPrize ? -CFG.releaseScoreWait : 0;
        if (this.releaseT <= idleThreshold) {
          const prizeWasScored = this.wins > this.releaseStartWins;
          this.ropeLen = CFG.ropeIdle;
          this.applyRopeLen();
          this.fingerForceMul = 1;
          this.fingerHold = false;
          this.releaseWaitForPrize = false;
          this.fingerMode = 'rest';
          this.setFingerCollision(true);
          this.state = STATE.IDLE;
          if (!prizeWasScored) ui.setStatus('idle');
        }
        break;
      }
    }

    sfx.setMotor(this.enabled ? motor : 0);
    this.updateFingers(dt);
    this.updatePalmBody(dt);

    // якорь верёвки
    const a = this.anchor;
    a.velocity.set((this.pos.x - a.position.x) / dt, 0, (this.pos.y - a.position.z) / dt);
    a.position.set(this.pos.x, CFG.pivotY, this.pos.y);
    this.dampSwing(dt);
    this.stabilizeRope();

    // меши портала
    this.bridge.position.z = this.pos.y;
    this.trolley.position.set(this.pos.x, CFG.pivotY - 0.055, this.pos.y);
    this.updateCableChain();

    // голова и пальцы рисуются от СГЛАЖЕННОЙ позиции — микродрожь физики не видна
    const hb = this.headBody.position;
    if (!this.visualHead) this.visualHead = new Vector3(hb.x, hb.y, hb.z);
    const k = Math.min(1, 14 * dt);
    this.visualHead.x += (hb.x - this.visualHead.x) * k;
    this.visualHead.y += (hb.y - this.visualHead.y) * k;
    this.visualHead.z += (hb.z - this.visualHead.z) * k;

    this.head.position.copy(this.visualHead);
    this.headQuaternionFromChain(this.visualHead, this._headQuat);
    this.head.quaternion.slerp(this._headQuat, Math.min(1, 10 * dt));
    this.updateVisualPalmPose(dt);
    this.syncHeldToys(dt);

    // Визуальный трос сглаживаем отдельной кривой поверх физической цепи: физика остается устойчивой,
    // а на движении не видно ломаных цилиндров между звеньями.
    this.updateRopeMesh(dt);

    // джекпот-телл
    if (this.jackpotCharged) {
      this.ringMat.emissive.setHex(0xfbbf24);
      this.ringMat.emissiveIntensity = 1.8 + Math.sin(performance.now() * 0.008) * 0.9;
    } else {
      this.ringMat.emissive.setHex(0xff3045);
      this.ringMat.emissiveIntensity = 2.0;
    }

    for (const fm of this.fingerMeshes) this.poseFingerMeshes(fm);
  }

  onPrizeWin(name, rarity, trick = false) {
    this.wins++;
    ui.setWins(this.wins);
    const displayName = toyName(name);
    const fugitiveMode = settings.gameMode === 'fugitives';
    const label = trick
      ? tr(`ХИТРЮГА! ${displayName} тоже засчитан.`, `SNEAKY! ${displayName} still counts.`)
      : rarity
        ? tr(`РЕДКИЙ ПРИЗ: ${displayName}!`, `RARE PRIZE: ${displayName}!`)
        : name
          ? fugitiveMode
            ? tr(`ПОЙМАН: ${displayName}! Забирай внизу!`, `CAUGHT: ${displayName}! Pick them up below!`)
            : tr(`ПРИЗ: ${displayName}! Забирай внизу!`, `PRIZE: ${displayName}! Pick it up below!`)
          : undefined;
    ui.setStatus('win', label);
    ui.prizeToast(name, rarity, trick);
    sfx.fanfare(!!rarity);
    vibrate('win');
  }
}
