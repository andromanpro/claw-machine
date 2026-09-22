import {
  Box3,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { tr, toyName } from './i18n.js';
import { settings } from './settings.js';

const STAND_X = -2.55;
const STAND_Z = 2.92;
const STAND_W = 2.5;
const STAND_D = 0.9;
const AUTO_COLLECT_DELAY = 10;
const AUTO_TRANSFER_DURATION = 1.15;
const FUGITIVE_CLIMB_DURATION = 1.8;
const FLOOR_RUN_BOUNDS = {
  minX: -0.9,
  maxX: 2.45,
  minZ: 1.82,
  maxZ: 4.45,
};
const COLLECTION_KEY = settings.gameMode === 'fugitives'
  ? 'claw-fugitive-collection-v1'
  : 'claw-prize-collection-v1';
let standFinishTexture;

function makeStandFinishTexture() {
  if (standFinishTexture) return standFinishTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const g = canvas.getContext('2d');
  const image = g.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const grainA = ((x * 31 + y * 43 + x * y * 3) % 29) - 14;
      const grainB = ((x * 71 + y * 17 + x * y * 7) % 17) - 8;
      const value = MathUtils.clamp(226 + grainA * 0.72 + grainB * 0.46, 204, 246);
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  standFinishTexture = new CanvasTexture(canvas);
  standFinishTexture.wrapS = RepeatWrapping;
  standFinishTexture.wrapT = RepeatWrapping;
  standFinishTexture.repeat.set(6, 4);
  return standFinishTexture;
}

function standMaterial({ color, roughness, metalness, clearcoat = 0.08, emissive = 0x000000, emissiveIntensity = 0 }) {
  return new MeshPhysicalMaterial({
    color,
    roughness,
    metalness,
    clearcoat,
    clearcoatRoughness: 0.58,
    emissive,
    emissiveIntensity,
    bumpMap: makeStandFinishTexture(),
    bumpScale: 0.003,
    roughnessMap: makeStandFinishTexture(),
    envMapIntensity: 0.82,
  });
}

function meshBox(parent, size, pos, material, radius = 0.025) {
  const mesh = new Mesh(new RoundedBoxGeometry(...size, 3, radius), material);
  mesh.position.set(...pos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeLabelTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 144;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { canvas, texture };
}

function makeCardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 96;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { canvas, texture };
}

export class PrizeStand {
  constructor({ scene, world, physMat, floorY, toys }) {
    this.scene = scene;
    this.world = world;
    this.floorY = floorY;
    this.toys = toys;
    this.enabled = true;
    this.staticBodies = [];
    this.autoCollectDelay = AUTO_COLLECT_DELAY;
    this.autoTransfer = null;
    this.group = new Group();
    this.group.name = 'prizeCollectionStand';
    scene.add(this.group);

    const dark = standMaterial({
      color: 0x07110e, roughness: 0.74, metalness: 0.4, clearcoat: 0.05,
    });
    const green = standMaterial({
      color: 0x123127, roughness: 0.66, metalness: 0.38, clearcoat: 0.2,
    });
    const gold = standMaterial({
      color: 0xc0934d, emissive: 0x261507, emissiveIntensity: 0.14,
      roughness: 0.44, metalness: 0.82, clearcoat: 0.1,
    });
    const red = standMaterial({
      color: 0x72151b, emissive: 0x35070a, emissiveIntensity: 0.24,
      roughness: 0.54, metalness: 0.38, clearcoat: 0.26,
    });

    meshBox(this.group, [STAND_W, 0.14, STAND_D], [STAND_X, floorY + 0.08, STAND_Z], dark, 0.05);
    meshBox(this.group, [STAND_W - 0.1, 0.085, STAND_D - 0.1], [STAND_X, floorY + 0.18, STAND_Z], green, 0.03);
    meshBox(this.group, [STAND_W - 0.04, 0.055, STAND_D - 0.04], [STAND_X, floorY + 0.135, STAND_Z], red, 0.018);

    const backZ = STAND_Z - 0.43;
    meshBox(this.group, [STAND_W - 0.03, 1.82, 0.085], [STAND_X, floorY + 1.0, backZ], dark, 0.04);
    meshBox(this.group, [STAND_W - 0.15, 1.69, 0.035], [STAND_X, floorY + 1.0, backZ + 0.052], green, 0.024);
    meshBox(this.group, [STAND_W - 0.12, 0.035, 0.045], [STAND_X, floorY + 0.28, backZ + 0.068], red, 0.01);
    meshBox(this.group, [STAND_W - 0.1, 0.11, 0.66], [STAND_X, floorY + 0.86, STAND_Z - 0.1], dark, 0.03);
    meshBox(this.group, [STAND_W - 0.18, 0.055, 0.61], [STAND_X, floorY + 0.93, STAND_Z - 0.1], red, 0.018);
    for (const x of [STAND_X - 1.14, STAND_X + 1.14]) {
      meshBox(this.group, [0.045, 1.73, 0.045], [x, floorY + 1.0, backZ + 0.075], gold, 0.01);
    }

    const { canvas, texture } = makeLabelTexture();
    this.labelCanvas = canvas;
    this.labelTexture = texture;
    const label = new Mesh(
      new PlaneGeometry(1.18, 0.28),
      new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
    );
    label.position.set(STAND_X, floorY + 1.82, backZ + 0.096);
    label.renderOrder = 4;
    this.group.add(label);

    const pedestalMat = standMaterial({
      color: 0x101d18, roughness: 0.62, metalness: 0.48, clearcoat: 0.12,
    });
    const slotXs = [-0.87, -0.29, 0.29, 0.87].map((offset) => STAND_X + offset);
    const layout = [
      { y: floorY + 0.305, z: STAND_Z + 0.18, cardY: floorY + 0.18, cardZ: STAND_Z + 0.54 },
      { y: floorY + 1.005, z: STAND_Z - 0.11, cardY: floorY + 0.88, cardZ: STAND_Z + 0.25 },
    ];
    this.slots = layout.flatMap((row, rowIndex) => slotXs.map((x, columnIndex) => {
      const index = rowIndex * slotXs.length + columnIndex;
      const pedestal = new Mesh(new CylinderGeometry(0.19, 0.22, 0.13, 32), pedestalMat);
      pedestal.position.set(x, row.y - 0.065, row.z);
      pedestal.castShadow = true;
      pedestal.receiveShadow = true;
      this.group.add(pedestal);

      const ringMat = new MeshBasicMaterial({
        color: 0xffc247, transparent: true, opacity: 0.28,
        depthWrite: false, side: DoubleSide,
      });
      const ring = new Mesh(new RingGeometry(0.125, 0.16, 40), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, row.y + 0.004, row.z);
      ring.renderOrder = 4;
      this.group.add(ring);

      const { canvas: cardCanvas, texture: cardTexture } = makeCardTexture();
      const card = new Mesh(
        new PlaneGeometry(0.48, 0.12),
        new MeshBasicMaterial({ map: cardTexture, transparent: true, depthWrite: false })
      );
      card.position.set(x, row.cardY, row.cardZ);
      card.renderOrder = 5;
      this.group.add(card);
      return {
        index, row: rowIndex, x, y: row.y, z: row.z,
        toy: null, reservedToy: null, ring, ringMat, card, cardCanvas, cardTexture,
      };
    }));

    const fill = new PointLight(0xffc247, 0.28, 2.1, 1.8);
    fill.position.set(STAND_X, floorY + 1.45, STAND_Z + 0.4);
    this.group.add(fill);

    this.addStaticBox(STAND_W, 0.16, STAND_D, STAND_X, floorY + 0.08, STAND_Z, physMat);
    this.addStaticBox(STAND_W - 0.03, 1.82, 0.1, STAND_X, floorY + 1.0, backZ, physMat);
    this.addStaticBox(STAND_W - 0.1, 0.12, 0.66, STAND_X, floorY + 0.86, STAND_Z - 0.1, physMat);
    this.previewSlot = null;
    this.restore();
    this.refresh();
  }

  addStaticBox(w, h, d, x, y, z, material) {
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)),
      position: new CANNON.Vec3(x, y, z),
      material,
      collisionFilterGroup: 8,
      collisionFilterMask: 1,
    });
    this.world.addBody(body);
    this.staticBodies.push(body);
    return body;
  }

  setEnabled(enabled) {
    const next = !!enabled;
    if (!next) {
      this.cancelAutoTransfer(true);
      for (const toy of this.toys.toys) this.cancelFloorJourney(toy);
    }
    this.enabled = next;
    this.group.visible = next;
    for (const body of this.staticBodies) body.collisionFilterMask = next ? 1 : 0;
    for (const slot of this.slots) {
      if (slot.toy?.mesh) slot.toy.mesh.visible = next;
    }
    if (!next) this.previewSlot = null;
    this.refresh();
  }

  cancelAutoTransfer(restoreOrigin = false) {
    if (!this.autoTransfer) return;
    const { toy, slot, from } = this.autoTransfer;
    slot.reservedToy = null;
    if (toy?.body?.world) {
      toy.autoTransferring = false;
      toy.autoStandAge = 0;
      if (restoreOrigin && from) toy.body.position.copy(from);
      toy.body.type = CANNON.Body.DYNAMIC;
      toy.body.collisionFilterGroup = 1;
      toy.body.collisionFilterMask = -1;
      toy.body.velocity.set(0, 0, 0);
      toy.body.angularVelocity.set(0, 0, 0);
      toy.body.aabbNeedsUpdate = true;
      toy.body.updateMassProperties();
      toy.body.wakeUp();
      if (toy.kind === 'fugitive') this.restartFloorJourney(toy);
    }
    this.autoTransfer = null;
  }

  restartFloorJourney(toy, age = 0) {
    if (!toy?.ai || toy.onStand || !toy.onFloor) return;
    toy.floorJourney = {
      phase: 'run',
      age,
      target: null,
      retargetIn: 0,
      controlled: false,
      slot: null,
    };
    toy.autoStandAge = age;
    toy.ai.captured = false;
    toy.ai.state = 'floor-run';
    toy.ai.stateTime = 0;
    toy.ai.target = null;
    toy.ai.moveX = 0;
    toy.ai.moveZ = 0;
    toy.ai.desiredMoveX = 0;
    toy.ai.desiredMoveZ = 0;
    toy.body.fixedRotation = true;
    toy.body.angularVelocity.set(0, 0, 0);
    toy.body.updateMassProperties();
    toy.body.wakeUp();
  }

  cancelFloorJourney(toy) {
    const journey = toy?.floorJourney;
    if (!journey) return;
    if (journey.slot?.reservedToy === toy) journey.slot.reservedToy = null;
    toy.floorJourney = null;
    toy.autoStandAge = 0;
    if (toy.ai) {
      toy.ai.moveX = 0;
      toy.ai.moveZ = 0;
      toy.ai.state = toy.onStand ? 'stand' : 'idle';
    }
    if (toy.body?.world && !toy.autoTransferring) {
      toy.body.velocity.x = 0;
      toy.body.velocity.z = 0;
      toy.body.wakeUp();
    }
  }

  get count() {
    return this.slots.filter((slot) => slot.toy).length;
  }

  redrawLabel() {
    const c = this.labelCanvas;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(4,9,7,.96)';
    g.fillRect(8, 8, c.width - 16, c.height - 16);
    g.strokeStyle = '#c89b49';
    g.lineWidth = 7;
    g.strokeRect(10, 10, c.width - 20, c.height - 20);
    g.fillStyle = '#ffe7a6';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 42px Arial';
    g.fillText(tr('КОЛЛЕКЦИЯ', 'COLLECTION'), c.width / 2, 53);
    g.fillStyle = '#38f5ff';
    g.font = '700 25px Arial';
    g.fillText(`${tr('ПРИЗЫ', 'PRIZES')}  ${this.count} / ${this.slots.length}`, c.width / 2, 100);
    this.labelTexture.needsUpdate = true;
  }

  redrawSlotCard(slot) {
    const c = slot.cardCanvas;
    const g = c.getContext('2d');
    const toy = slot.toy;
    const accent = toy?.rarity === 'epic' ? '#c4a7ff' : toy?.rarity ? '#ffc247' : '#38f5ff';
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(3,8,6,.97)';
    g.fillRect(4, 4, c.width - 8, c.height - 8);
    g.strokeStyle = toy ? accent : '#5b6d66';
    g.lineWidth = 5;
    g.strokeRect(6, 6, c.width - 12, c.height - 12);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = toy ? '#fff1c9' : '#82938c';
    const rawName = toy ? toyName(toy.name) : tr('СВОБОДНО', 'EMPTY');
    const name = rawName.length > 17 ? `${rawName.slice(0, 16)}…` : rawName;
    g.font = `900 ${name.length > 13 ? 23 : 28}px Arial`;
    g.fillText(name.toUpperCase(), c.width / 2, toy?.rarity ? 39 : 49);
    if (toy?.rarity) {
      g.fillStyle = accent;
      g.font = '700 17px Arial';
      g.fillText(toy.rarity === 'epic' ? tr('ЭПИЧЕСКИЙ', 'EPIC') : tr('РЕДКИЙ', 'RARE'), c.width / 2, 69);
    }
    slot.cardTexture.needsUpdate = true;
  }

  refresh() {
    for (const slot of this.slots) {
      if (slot === this.previewSlot) {
        slot.ringMat.color.setHex(0x38f5ff);
        slot.ringMat.opacity = 0.82;
      } else if (slot.toy) {
        slot.ringMat.color.setHex(0xff3045);
        slot.ringMat.opacity = 0.4;
      } else {
        slot.ringMat.color.setHex(0xffc247);
        slot.ringMat.opacity = 0.28;
      }
      this.redrawSlotCard(slot);
    }
    this.redrawLabel();
    document.body.classList.toggle('stand-has-prize', this.count > 0);
  }

  save() {
    const stored = this.slots
      .filter((slot) => slot.toy)
      .map((slot) => ({
        slot: slot.index,
        name: slot.toy.name,
        rarity: slot.toy.rarity ?? null,
        color: Number.isFinite(slot.toy.variantColor) ? slot.toy.variantColor : null,
      }));
    try { localStorage.setItem(COLLECTION_KEY, JSON.stringify(stored)); } catch { /* storage недоступен */ }
  }

  restore() {
    if (!this.toys) return;
    let stored = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(COLLECTION_KEY) ?? '[]');
      if (Array.isArray(parsed)) stored = parsed;
    } catch { /* повреждённую коллекцию просто игнорируем */ }

    for (const entry of stored.slice(0, this.slots.length)) {
      const slot = this.slots[Number(entry.slot)];
      const tpl = this.toys.templates.find((candidate) => candidate.name === entry.name);
      if (!slot || slot.toy || !tpl) continue;
      const color = Number.isFinite(entry.color) ? entry.color : undefined;
      const toy = this.toys.spawnTemplate(tpl, slot.x, slot.y + tpl.r + 0.015, slot.z, { color, yaw: 0.96 });
      toy.scored = true;
      toy.prizeEligible = false;
      toy.onFloor = true;
      this.toys.floorCount++;
      this.placeInSlot(toy, slot);
    }
  }

  clear() {
    this.cancelAutoTransfer();
    for (const toy of this.toys.toys) this.cancelFloorJourney(toy);
    for (const slot of this.slots) {
      const toy = slot.toy;
      if (!toy) continue;
      this.scene.remove(toy.mesh);
      this.world.removeBody(toy.body);
      const index = this.toys.toys.indexOf(toy);
      if (index >= 0) this.toys.toys.splice(index, 1);
      this.toys.floorCount = Math.max(0, this.toys.floorCount - 1);
      slot.toy = null;
    }
    this.previewSlot = null;
    this.save();
    this.refresh();
  }

  nearestOpenSlot(point, maxDistance = 0.38) {
    if (!this.enabled) return null;
    let best = null;
    for (const slot of this.slots) {
      if (slot.toy || slot.reservedToy) continue;
      const distance = Math.hypot(point.x - slot.x, point.z - slot.z);
      if (distance <= maxDistance && (!best || distance < best.distance)) best = { slot, distance };
    }
    return best?.slot ?? null;
  }

  preview(toy, point) {
    const next = this.enabled && toy ? this.nearestOpenSlot(point, 0.42) : null;
    if (next === this.previewSlot) return;
    this.previewSlot = next;
    this.refresh();
  }

  beginDrag(toy) {
    if (!this.enabled || !toy) return;
    this.cancelFloorJourney(toy);
    if (!toy.onStand) {
      if (toy.ai) {
        toy.body.fixedRotation = false;
        toy.body.updateMassProperties();
      }
      return;
    }
    const slot = this.slots[toy.standSlot];
    if (slot?.toy === toy) slot.toy = null;
    toy.onStand = false;
    toy.standSlot = -1;
    toy.autoStandAge = 0;
    const baseScale = toy.mesh.userData.baseScale;
    if (baseScale) toy.mesh.scale.copy(baseScale);
    toy.standVisualScale = 1;
    toy.standFit = null;
    toy.body.type = CANNON.Body.DYNAMIC;
    toy.body.collisionFilterGroup = 1;
    toy.body.collisionFilterMask = -1;
    if (toy.ai) toy.body.fixedRotation = false;
    toy.body.updateMassProperties();
    toy.body.wakeUp();
    this.save();
    this.refresh();
  }

  placeInSlot(toy, slot) {
    slot.toy = toy;
    slot.reservedToy = null;
    toy.onStand = true;
    toy.standSlot = slot.index;
    toy.autoTransferring = false;
    toy.autoStandAge = 0;
    toy.onFloor = true;
    toy.floorJourney = null;
    if (toy.ai) {
      toy.ai.captured = false;
      toy.ai.state = 'stand';
      toy.ai.target = null;
      toy.ai.moveX = 0;
      toy.ai.moveZ = 0;
      toy.ai.desiredMoveX = 0;
      toy.ai.desiredMoveZ = 0;
      toy.ai.visualMoveX = 0;
      toy.ai.visualMoveZ = 0;
      toy.ai.visualTargetX = 0;
      toy.ai.visualTargetZ = 0;
      toy.ai.visualMotionX = 0;
      toy.ai.visualMotionZ = 0;
      toy.ai.visualMotionAge = 0;
      toy.ai.visualSampleX = slot.x;
      toy.ai.visualSampleZ = slot.z;
      toy.body.fixedRotation = true;
    }
    toy.mesh.visible = this.enabled;
    toy.body.type = CANNON.Body.KINEMATIC;
    toy.body.collisionFilterGroup = 0;
    toy.body.collisionFilterMask = 0;
    toy.body.position.set(slot.x, slot.y, slot.z);
    // Стенд находится слева от автомата, а основной игровой ракурс — справа:
    // небольшой разворот показывает лицо и у плоских подушек, и у зверей.
    toy.body.quaternion.setFromEuler(0, 0.96, 0, 'XYZ');
    this.fitToyInSlot(toy, slot);
    toy.body.velocity.set(0, 0, 0);
    toy.body.angularVelocity.set(0, 0, 0);
    toy.body.updateMassProperties();
    toy.body.wakeUp();
  }

  fitToyInSlot(toy, slot) {
    const mesh = toy.mesh;
    const baseScale = mesh.userData.baseScale ?? mesh.scale.clone();
    mesh.scale.copy(baseScale);
    mesh.position.copy(toy.body.position);
    mesh.quaternion.copy(toy.body.quaternion);
    mesh.updateMatrixWorld(true);

    const size = new Box3().setFromObject(mesh).getSize(new Vector3());
    const maxHeight = slot.row === 0 ? 0.5 : 0.6;
    const maxWidth = 0.5;
    const maxDepth = 0.5;
    const factor = Math.min(
      1,
      maxWidth / Math.max(size.x, 0.001),
      maxHeight / Math.max(size.y, 0.001),
      maxDepth / Math.max(size.z, 0.001)
    );
    mesh.scale.copy(baseScale).multiplyScalar(factor);
    mesh.updateMatrixWorld(true);

    const bounds = new Box3().setFromObject(mesh);
    const seatY = slot.y - (slot.row === 0 ? 0.055 : 0.035);
    const lift = seatY - bounds.min.y;
    toy.body.position.y += lift;
    mesh.position.y += lift;
    mesh.updateMatrixWorld(true);

    const fitted = new Box3().setFromObject(mesh).getSize(new Vector3());
    toy.standVisualScale = factor;
    toy.standFit = {
      width: fitted.x,
      height: fitted.y,
      depth: fitted.z,
      maxWidth,
      maxHeight,
      maxDepth,
    };
  }

  tryPlace(toy, point) {
    if (!this.enabled) return false;
    const slot = this.nearestOpenSlot(point, 0.42);
    this.previewSlot = null;
    if (!slot) {
      this.refresh();
      return false;
    }
    this.placeInSlot(toy, slot);
    this.save();
    this.refresh();
    return true;
  }

  startAutoTransfer(toy, slot) {
    if (!this.enabled || !toy || !slot || this.autoTransfer) return false;
    slot.reservedToy = toy;
    toy.autoTransferring = true;
    toy.body.type = CANNON.Body.KINEMATIC;
    toy.body.collisionFilterGroup = 0;
    toy.body.collisionFilterMask = 0;
    toy.body.velocity.set(0, 0, 0);
    toy.body.angularVelocity.set(0, 0, 0);
    toy.body.updateMassProperties();
    toy.body.wakeUp();
    this.autoTransfer = {
      mode: 'float',
      toy,
      slot,
      t: 0,
      from: new CANNON.Vec3(toy.body.position.x, toy.body.position.y, toy.body.position.z),
      toY: slot.y + (toy.r ?? 0.24) + 0.015,
    };
    this.refresh();
    return true;
  }

  startFugitiveClimb(toy, slot) {
    if (!this.enabled || !toy?.ai || !slot || this.autoTransfer) return false;
    slot.reservedToy = toy;
    toy.autoTransferring = true;
    toy.floorJourney.phase = 'climb';
    toy.floorJourney.slot = slot;
    toy.ai.state = 'stand-climb';
    toy.ai.moveX = 0;
    toy.ai.moveZ = 0;
    toy.body.type = CANNON.Body.KINEMATIC;
    toy.body.collisionFilterGroup = 0;
    toy.body.collisionFilterMask = 0;
    toy.body.velocity.set(0, 0, 0);
    toy.body.angularVelocity.set(0, 0, 0);
    toy.body.updateMassProperties();
    toy.body.wakeUp();
    this.autoTransfer = {
      mode: 'climb',
      toy,
      slot,
      t: 0,
      from: new CANNON.Vec3(toy.body.position.x, toy.body.position.y, toy.body.position.z),
      toY: slot.y + (toy.r ?? 0.24) + 0.015,
    };
    this.refresh();
    return true;
  }

  setTransferPosition(toy, from, to, amount, hop = 0) {
    const k = amount * amount * (3 - 2 * amount);
    toy.body.position.set(
      MathUtils.lerp(from.x, to.x, k),
      MathUtils.lerp(from.y, to.y, k) + Math.sin(Math.PI * amount) * hop,
      MathUtils.lerp(from.z, to.z, k)
    );
  }

  updateFugitiveClimb(transfer, raw) {
    const { toy, slot, from, toY } = transfer;
    const lip = new CANNON.Vec3(slot.x, this.floorY + 0.4, STAND_Z + 0.38);
    const target = new CANNON.Vec3(slot.x, toY, slot.z);
    if (slot.row === 0) {
      if (raw < 0.46) this.setTransferPosition(toy, from, lip, raw / 0.46, 0.11);
      else this.setTransferPosition(toy, lip, target, (raw - 0.46) / 0.54, 0.055);
      return;
    }
    const shelf = new CANNON.Vec3(slot.x, this.floorY + 0.98, STAND_Z + 0.17);
    if (raw < 0.3) this.setTransferPosition(toy, from, lip, raw / 0.3, 0.12);
    else if (raw < 0.72) this.setTransferPosition(toy, lip, shelf, (raw - 0.3) / 0.42, 0.08);
    else this.setTransferPosition(toy, shelf, target, (raw - 0.72) / 0.28, 0.045);
  }

  updateAutoTransfer(dt) {
    const transfer = this.autoTransfer;
    if (!transfer) return;
    const { toy, slot, from, toY } = transfer;
    if (!this.toys.toys.includes(toy) || !toy.body?.world) {
      slot.reservedToy = null;
      if (toy) toy.autoTransferring = false;
      this.autoTransfer = null;
      this.refresh();
      return;
    }
    transfer.t += dt / (transfer.mode === 'climb' ? FUGITIVE_CLIMB_DURATION : AUTO_TRANSFER_DURATION);
    const raw = Math.min(1, transfer.t);
    if (transfer.mode === 'climb') this.updateFugitiveClimb(transfer, raw);
    else this.setTransferPosition(toy, from, new CANNON.Vec3(slot.x, toY, slot.z), raw, 0.42);
    toy.body.aabbNeedsUpdate = true;
    toy.body.wakeUp();
    if (raw < 1) return;
    this.autoTransfer = null;
    this.placeInSlot(toy, slot);
    this.save();
    this.refresh();
  }

  randomFloorTarget() {
    return {
      x: MathUtils.lerp(FLOOR_RUN_BOUNDS.minX, FLOOR_RUN_BOUNDS.maxX, Math.random()),
      z: MathUtils.lerp(FLOOR_RUN_BOUNDS.minZ, FLOOR_RUN_BOUNDS.maxZ, Math.random()),
    };
  }

  moveFugitive(toy, target, speed, dt) {
    const body = toy.body;
    const dx = target.x - body.position.x;
    const dz = target.z - body.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.001) {
      toy.ai.moveX = 0;
      toy.ai.moveZ = 0;
      body.velocity.x = 0;
      body.velocity.z = 0;
      return distance;
    }
    const vx = (dx / distance) * speed;
    const vz = (dz / distance) * speed;
    const blend = 1 - Math.exp(-dt * 8);
    toy.ai.moveX = MathUtils.lerp(toy.ai.moveX, vx, blend);
    toy.ai.moveZ = MathUtils.lerp(toy.ai.moveZ, vz, blend);
    body.velocity.x = toy.ai.moveX;
    body.velocity.z = toy.ai.moveZ;
    // Небольшой управляемый шаг компенсирует статическое трение пола: без него
    // персонаж визуально перебирает ногами быстрее, чем реально продвигается.
    body.position.x += toy.ai.moveX * dt * 0.85;
    body.position.z += toy.ai.moveZ * dt * 0.85;
    body.aabbNeedsUpdate = true;
    body.wakeUp();
    return distance;
  }

  updateFloorFugitive(toy, dt, activeToy) {
    if (toy === activeToy) return;
    if (!toy.floorJourney) this.restartFloorJourney(toy, toy.autoStandAge ?? 0);
    const journey = toy.floorJourney;
    if (!journey) return;
    journey.controlled = true;
    toy.body.fixedRotation = true;
    toy.body.angularVelocity.set(0, 0, 0);

    const landedY = this.floorY + (toy.r ?? 0.22) + 0.18;
    if (toy.body.position.y > landedY && journey.phase === 'run') {
      toy.ai.moveX *= 0.75;
      toy.ai.moveZ *= 0.75;
      return;
    }

    if (journey.phase === 'run') {
      journey.age += dt;
      toy.autoStandAge = journey.age;
      journey.retargetIn -= dt;
      const distance = journey.target
        ? Math.hypot(journey.target.x - toy.body.position.x, journey.target.z - toy.body.position.z)
        : 0;
      if (!journey.target || journey.retargetIn <= 0 || distance < 0.15) {
        journey.target = this.randomFloorTarget();
        journey.retargetIn = MathUtils.lerp(1.25, 2.35, Math.random());
      }
      toy.ai.state = 'floor-run';
      this.moveFugitive(toy, journey.target, 0.78, dt);
      if (journey.age < this.autoCollectDelay) return;
      const slot = this.slots.find((candidate) => !candidate.toy && !candidate.reservedToy);
      if (!slot) return;
      slot.reservedToy = toy;
      journey.phase = 'approach';
      journey.slot = slot;
      // Останавливаемся перед физическим основанием, а не пытаемся протолкнуть
      // сферу-коллайдер в цоколь. Сначала обходим правый угол основания,
      // затем идём вдоль фасада к своей ячейке.
      const clearance = (toy.colliderR ?? toy.r ?? 0.24) + 0.075;
      journey.approachStage = 'corner';
      journey.target = {
        x: STAND_X + STAND_W * 0.5 + clearance,
        z: STAND_Z + STAND_D * 0.5 + clearance,
      };
      this.refresh();
    }

    if (journey.phase === 'approach') {
      const slot = journey.slot;
      if (!slot || slot.toy || (slot.reservedToy && slot.reservedToy !== toy)) {
        this.restartFloorJourney(toy, this.autoCollectDelay);
        return;
      }
      toy.ai.state = 'stand-approach';
      const distance = this.moveFugitive(toy, journey.target, 0.62, dt);
      if (distance >= 0.09) return;
      if (journey.approachStage === 'corner') {
        journey.approachStage = 'front';
        journey.target = { x: slot.x, z: journey.target.z };
        return;
      }
      if (!this.autoTransfer) this.startFugitiveClimb(toy, slot);
    }
  }

  updateAutoCollection(dt, activeToy) {
    if (!this.enabled) return;
    for (const toy of this.toys.toys) {
      if (
        toy.kind !== 'fugitive'
        || !toy.onFloor
        || toy.onStand
        || toy.deliver
        || toy.autoTransferring
        || !toy.body?.world
      ) continue;
      this.updateFloorFugitive(toy, dt, activeToy);
    }
    if (this.autoTransfer || !this.slots.some((slot) => !slot.toy && !slot.reservedToy)) return;
    for (const toy of this.toys.toys) {
      if (toy.kind === 'fugitive' || !toy.onFloor || toy.onStand || toy.deliver || toy.autoTransferring || toy === activeToy || !toy.body?.world) continue;
      toy.autoStandAge = (toy.autoStandAge ?? 0) + dt;
      if (toy.autoStandAge < this.autoCollectDelay) continue;
      const slot = this.slots.find((candidate) => !candidate.toy && !candidate.reservedToy);
      if (slot) this.startAutoTransfer(toy, slot);
      break;
    }
  }

  update(elapsed, dt = 0, activeToy = null) {
    if (!this.enabled) return;
    this.updateAutoTransfer(dt);
    this.updateAutoCollection(dt, activeToy);
    for (const slot of this.slots) {
      const base = slot === this.previewSlot ? 0.76 : slot.toy ? 0.36 : 0.22;
      slot.ringMat.opacity = base + Math.sin(elapsed * 4.2 + slot.index) * (slot === this.previewSlot ? 0.1 : 0.035);
    }
  }
}
