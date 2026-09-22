// Корпус автомата: витрина, тумба, шапка, неон, дыра приза + статическая физика
import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  GridHelper,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { tr } from './i18n.js';
import { settings } from './settings.js';

export const CABINET_SPEC = (() => {
  const refMm = { height: 2300, width: 1280, depth: 930 };
  const baseH = 1.5;
  const wallH = 2.6;
  const headH = 0.86;
  const totalH = baseH + wallH + headH;
  const unitPerMm = totalH / refMm.height;
  const outerW = refMm.width * unitPerMm;
  const outerD = refMm.depth * unitPerMm;
  const halfW = outerW / 2;
  const halfD = outerD / 2;
  const innerX = halfW - 0.2;
  const innerZ = halfD - 0.12;

  return {
    refMm,
    unitPerMm,
    outerW,
    outerD,
    halfW,
    halfD,
    baseH,
    wallH,
    headH,
    innerX,
    innerZ,
    frontZ: halfD + 0.075,
    frontGlassZ: innerZ + 0.04,
    sideX: halfW + 0.035,
    postX: halfW - 0.055,
    postZ: halfD - 0.055,
    holeMinX: 0.38,
    holeMinZ: 0.24,
    panel: {
      x: -0.16,
      width: outerW * 0.86,
      depth: 0.58,
      tilt: 0.34,
    },
  };
})();

export const DIMS = {
  INNER: CABINET_SPEC.innerX, // legacy: square-era callers use this as X half-span
  INNER_X: CABINET_SPEC.innerX,
  INNER_Z: CABINET_SPEC.innerZ,
  WALL_H: CABINET_SPEC.wallH,
  BASE_H: CABINET_SPEC.baseH,
  HOLE_MIN: CABINET_SPEC.holeMinX,
  HOLE_MIN_X: CABINET_SPEC.holeMinX,
  HOLE_MIN_Z: CABINET_SPEC.holeMinZ,
  CHUTE_BOTTOM: -2.45,
};

const NEON_CYAN = 0x38f5ff;
const NEON_MAGENTA = 0xe879f9;
const NEON_RED = 0xff3045;
const NEON_AMBER = 0xffc247;
const BODY_GREEN = 0x172c24;
const BODY_DARK = 0x08100e;
const PANEL_GREEN = 0x223b31;
let metalBumpTexture;
let metalRoughnessTexture;

function makeMetalBumpTexture() {
  if (metalBumpTexture) return metalBumpTexture;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const image = g.createImageData(c.width, c.height);
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const grain = Math.sin(x * 0.73 + y * 0.11) * 7 + Math.sin(y * 1.91) * 3;
      const speck = ((x * 37 + y * 73 + x * y * 3) % 17) - 8;
      const v = MathUtils.clamp(128 + grain + speck, 88, 168);
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  g.globalAlpha = 0.22;
  g.strokeStyle = '#e8e8e8';
  g.lineWidth = 1;
  for (let y = 7; y < 128; y += 17) {
    g.beginPath();
    g.moveTo(5 + (y % 13), y);
    g.lineTo(76 + (y % 31), y + 1);
    g.stroke();
  }
  metalBumpTexture = new CanvasTexture(c);
  metalBumpTexture.wrapS = RepeatWrapping;
  metalBumpTexture.wrapT = RepeatWrapping;
  metalBumpTexture.repeat.set(3, 5);
  return metalBumpTexture;
}

function makeMetalRoughnessTexture() {
  if (metalRoughnessTexture) return metalRoughnessTexture;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const image = g.createImageData(c.width, c.height);
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const broad = Math.sin(x * 0.19 + y * 0.13) * 9 + Math.cos(y * 0.31) * 6;
      const grain = ((x * 29 + y * 47 + x * y * 5) % 23) - 11;
      const v = MathUtils.clamp(224 + broad + grain, 188, 252);
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  metalRoughnessTexture = new CanvasTexture(c);
  metalRoughnessTexture.wrapS = RepeatWrapping;
  metalRoughnessTexture.wrapT = RepeatWrapping;
  metalRoughnessTexture.repeat.set(3, 5);
  return metalRoughnessTexture;
}

function coatedMetalMat({
  name,
  color,
  emissive = 0x000000,
  emissiveIntensity = 0,
  roughness = 0.62,
  metalness = 0.32,
  bumpScale = 0.012,
  clearcoat = 0.12,
  clearcoatRoughness = 0.58,
  anisotropy = 0,
}) {
  const mat = new MeshPhysicalMaterial({
    color,
    emissive,
    emissiveIntensity,
    roughness,
    metalness,
    bumpMap: makeMetalBumpTexture(),
    bumpScale,
    roughnessMap: makeMetalRoughnessTexture(),
    clearcoat,
    clearcoatRoughness,
    anisotropy,
    envMapIntensity: 0.82,
  });
  mat.name = name;
  return mat;
}

function neonMat(color, intensity = 2.5) {
  return new MeshStandardMaterial({
    color: 0x0b1220, emissive: color, emissiveIntensity: intensity,
    roughness: 0.4, metalness: 0.1,
  });
}

function bodyMat() {
  return coatedMetalMat({
    name: 'cabinet-green-enamel',
    color: BODY_GREEN,
    roughness: 0.66,
    metalness: 0.3,
    bumpScale: 0.014,
    clearcoat: 0.2,
    clearcoatRoughness: 0.52,
  });
}

function addStaticBox(world, material, cx, cy, cz, hx, hy, hz) {
  const body = new CANNON.Body({ mass: 0, material });
  body.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
  body.position.set(cx, cy, cz);
  world.addBody(body);
  return body;
}

function makeSignTexture() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#07120f';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#2a3b30';
  g.fillRect(20, 20, c.width - 40, c.height - 40);
  g.fillStyle = '#f1d99a';
  g.fillRect(104, 74, c.width - 208, c.height - 148);
  g.strokeStyle = '#ff3045';
  g.lineWidth = 18;
  g.strokeRect(84, 54, c.width - 168, c.height - 108);
  g.strokeStyle = '#ffc247';
  g.lineWidth = 6;
  g.strokeRect(46, 32, c.width - 92, c.height - 64);
  const title = settings.gameMode === 'fugitives'
    ? tr('ПАНИКА-67', 'PANIC-67')
    : tr('ХВАТАЙКА-67', 'CLAW-67');
  let fontSize = 250;
  do {
    g.font = `900 ${fontSize}px "Arial Narrow", "Impact", "Segoe UI", Arial, sans-serif`;
    fontSize -= 6;
  } while (g.measureText(title).width > c.width - 360 && fontSize > 180);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(255,48,69,.35)';
  g.shadowBlur = 12;
  g.fillStyle = '#8f1d1f';
  g.fillText(title, c.width / 2, c.height / 2 + 16);
  g.shadowBlur = 0;
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makePlateTexture(title, subtitle, accent = '#ffc247') {
  const c = document.createElement('canvas');
  c.width = 768; c.height = 220;
  const g = c.getContext('2d');
  g.fillStyle = '#09120f';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#20382f';
  g.fillRect(14, 14, c.width - 28, c.height - 28);
  g.strokeStyle = accent;
  g.lineWidth = 8;
  g.strokeRect(28, 28, c.width - 56, c.height - 56);
  g.font = '900 72px "Arial Narrow", Consolas, "Segoe UI", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#f8f0c0';
  g.shadowColor = accent; g.shadowBlur = 10;
  g.fillText(title, c.width / 2, 88);
  g.shadowBlur = 0;
  if (subtitle) {
    g.font = 'bold 34px Consolas, monospace';
    g.fillStyle = accent;
    g.fillText(subtitle, c.width / 2, 150);
  } else {
    g.fillStyle = accent;
    for (let i = 0; i < 4; i++) g.fillRect(260 + i * 52, 142, 34, 14);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeWarningTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#090908';
  g.fillRect(0, 0, c.width, c.height);
  for (let x = -80; x < c.width + 80; x += 64) {
    g.fillStyle = '#ffc247';
    g.beginPath();
    g.moveTo(x, c.height);
    g.lineTo(x + 34, 0);
    g.lineTo(x + 68, 0);
    g.lineTo(x + 34, c.height);
    g.closePath();
    g.fill();
  }
  g.fillStyle = 'rgba(255,48,69,.75)';
  g.fillRect(0, 0, c.width, 5);
  g.fillRect(0, c.height - 5, c.width, 5);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  return tex;
}

function makeGlassStickerTexture(title, subtitle, accent = '#38f5ff') {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 220;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(5, 12, 10, .72)';
  g.fillRect(20, 20, c.width - 40, c.height - 40);
  g.strokeStyle = 'rgba(241, 217, 154, .86)';
  g.lineWidth = 10;
  g.strokeRect(34, 34, c.width - 68, c.height - 68);
  g.strokeStyle = accent;
  g.lineWidth = 5;
  g.strokeRect(52, 52, c.width - 104, c.height - 104);
  g.font = '900 58px "Arial Narrow", "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = accent;
  g.shadowBlur = 9;
  g.fillStyle = '#f8f0c0';
  g.fillText(title, c.width / 2, 92);
  g.shadowBlur = 0;
  if (subtitle) {
    g.font = 'bold 28px Consolas, "Segoe UI", sans-serif';
    g.fillStyle = accent;
    g.fillText(subtitle, c.width / 2, 146);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makePlate(title, subtitle, w, h, accent = '#ffc247') {
  const tex = makePlateTexture(title, subtitle, accent);
  return new Mesh(
    new PlaneGeometry(w, h),
    new MeshBasicMaterial({ map: tex, transparent: true })
  );
}

function makeGlassSticker(title, subtitle, w, h, accent = '#38f5ff') {
  const tex = makeGlassStickerTexture(title, subtitle, accent);
  return new Mesh(
    new PlaneGeometry(w, h),
    new MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: DoubleSide,
    })
  );
}

function makeStarGeometry(size = 0.18) {
  const shape = new Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? size : size * 0.42;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new ShapeGeometry(shape);
}

function addBox(group, size, pos, material, rotation = null) {
  const mesh = new Mesh(new BoxGeometry(...size), material);
  mesh.position.set(...pos);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addRoundedBox(group, size, pos, material, radius = 0.035, rotation = null, segments = 2) {
  const safeRadius = Math.min(radius, Math.min(...size) * 0.45);
  const mesh = new Mesh(new RoundedBoxGeometry(...size, segments, safeRadius), material);
  mesh.position.set(...pos);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addFrontScrew(group, x, y, z, material, r = 0.022) {
  const screw = new Mesh(new CylinderGeometry(r, r, 0.012, 16), material);
  screw.rotation.x = Math.PI / 2;
  screw.position.set(x, y, z);
  screw.castShadow = true;
  group.add(screw);
  return screw;
}

function addFrontPlane(group, w, h, x, y, z, material) {
  const mesh = new Mesh(new PlaneGeometry(w, h), material);
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

function addSidePlane(group, w, h, x, y, z, material, sideSign = 1) {
  const mesh = new Mesh(new PlaneGeometry(w, h), material);
  mesh.rotation.y = sideSign * Math.PI / 2;
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

function addFrontPanel(group, x, y, z, w, h, panelMat, trimMat, screwMat) {
  addRoundedBox(group, [w, h, 0.05], [x, y, z], panelMat, 0.022);
  addBox(group, [w + 0.08, 0.035, 0.05], [x, y + h / 2 + 0.035, z + 0.012], trimMat);
  addBox(group, [w + 0.08, 0.035, 0.05], [x, y - h / 2 - 0.035, z + 0.012], trimMat);
  addBox(group, [0.035, h + 0.08, 0.05], [x - w / 2 - 0.035, y, z + 0.012], trimMat);
  addBox(group, [0.035, h + 0.08, 0.05], [x + w / 2 + 0.035, y, z + 0.012], trimMat);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      addFrontScrew(group, x + sx * (w / 2 - 0.06), y + sy * (h / 2 - 0.06), z + 0.035, screwMat, 0.018);
    }
  }
}

function addVentStack(group, x, y, z, w, slots, material) {
  for (let i = 0; i < slots; i++) {
    addBox(group, [w, 0.016, 0.022], [x, y - i * 0.055, z], material);
  }
}

function addSidePanel(group, x, y, z, w, h, panelMat, trimMat, screwMat, sideSign = 1) {
  addRoundedBox(group, [0.05, h, w], [x, y, z], panelMat, 0.022);
  addBox(group, [0.055, 0.035, w + 0.08], [x + sideSign * 0.012, y + h / 2 + 0.035, z], trimMat);
  addBox(group, [0.055, 0.035, w + 0.08], [x + sideSign * 0.012, y - h / 2 - 0.035, z], trimMat);
  addBox(group, [0.055, h + 0.08, 0.035], [x + sideSign * 0.012, y, z - w / 2 - 0.035], trimMat);
  addBox(group, [0.055, h + 0.08, 0.035], [x + sideSign * 0.012, y, z + w / 2 + 0.035], trimMat);
  for (const sz of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const screw = new Mesh(new CylinderGeometry(0.016, 0.016, 0.012, 16), screwMat);
      screw.rotation.z = Math.PI / 2;
      screw.position.set(x + sideSign * 0.04, y + sy * (h / 2 - 0.06), z + sz * (w / 2 - 0.06));
      screw.castShadow = true;
      group.add(screw);
    }
  }
}

function addSideVentStack(group, x, y, z, w, slots, material) {
  for (let i = 0; i < slots; i++) {
    addBox(group, [0.052, 0.018, w], [x, y - i * 0.06, z], material);
  }
}

function addSideStarBadge(group, x, y, z, starMat, panelMat, trimMat, screwMat, sideSign = 1) {
  addRoundedBox(group, [0.058, 0.62, 0.86], [x, y, z], panelMat, 0.026);
  addBox(group, [0.064, 0.05, 0.96], [x + sideSign * 0.014, y + 0.34, z], trimMat);
  addBox(group, [0.064, 0.05, 0.96], [x + sideSign * 0.014, y - 0.34, z], trimMat);
  addBox(group, [0.064, 0.72, 0.045], [x + sideSign * 0.014, y, z - 0.48], trimMat);
  addBox(group, [0.064, 0.72, 0.045], [x + sideSign * 0.014, y, z + 0.48], trimMat);
  const sideStarMat = starMat.clone();
  sideStarMat.side = DoubleSide;
  const star = new Mesh(makeStarGeometry(0.26), sideStarMat);
  star.rotation.y = -sideSign * Math.PI / 2;
  star.rotation.z = Math.PI;
  star.position.set(x + sideSign * 0.05, y + 0.02, z);
  group.add(star);
  addBox(group, [0.066, 0.026, 0.25], [x + sideSign * 0.058, y - 0.12, z - 0.33], trimMat);
  addBox(group, [0.066, 0.026, 0.25], [x + sideSign * 0.058, y - 0.12, z + 0.33], trimMat);
  addBox(group, [0.066, 0.026, 0.18], [x + sideSign * 0.058, y - 0.2, z - 0.31], trimMat);
  addBox(group, [0.066, 0.026, 0.18], [x + sideSign * 0.058, y - 0.2, z + 0.31], trimMat);
  for (const sz of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const screw = new Mesh(new CylinderGeometry(0.016, 0.016, 0.012, 16), screwMat);
      screw.rotation.z = Math.PI / 2;
      screw.position.set(x + sideSign * 0.062, y + sy * 0.27, z + sz * 0.39);
      screw.castShadow = true;
      group.add(screw);
    }
  }
}

function addSidePlate(group, x, y, z, title, subtitle, w, h, accent, sideSign = 1) {
  addBox(group, [0.022, h + 0.045, w + 0.045], [x - sideSign * 0.012, y, z], new MeshStandardMaterial({
    color: 0x07120f,
    roughness: 0.72,
    metalness: 0.36,
  }));
  const plate = makePlate(title, subtitle, w, h, accent);
  plate.material.side = DoubleSide;
  plate.rotation.y = sideSign * Math.PI / 2;
  plate.position.set(x, y, z);
  group.add(plate);
  return plate;
}

function makeRocketTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#070908';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#ff3045';
  g.lineWidth = 10;
  g.strokeRect(34, 34, c.width - 68, c.height - 68);
  g.fillStyle = '#ff3045';
  g.beginPath();
  g.moveTo(256, 80);
  g.lineTo(308, 238);
  g.lineTo(274, 224);
  g.lineTo(274, 334);
  g.lineTo(238, 334);
  g.lineTo(238, 224);
  g.lineTo(204, 238);
  g.closePath();
  g.fill();
  g.fillStyle = '#ffc247';
  g.beginPath();
  g.moveTo(238, 346);
  g.lineTo(256, 426);
  g.lineTo(274, 346);
  g.closePath();
  g.fill();
  g.fillStyle = '#ff3045';
  g.fillRect(164, 394, 184, 8);
  g.fillRect(186, 420, 140, 6);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function makeTerminalTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#031112';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#38f5ff';
  g.lineWidth = 8;
  g.strokeRect(28, 28, c.width - 56, c.height - 56);
  g.globalAlpha = 0.75;
  for (let y = 70; y < c.height - 60; y += 48) {
    g.strokeStyle = y % 96 === 70 ? '#38f5ff' : '#196b74';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(72, y);
    g.lineTo(c.width - 72, y);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.strokeStyle = '#38f5ff';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(256, 250, 94, 0, Math.PI * 2);
  g.moveTo(256, 156);
  g.lineTo(256, 344);
  g.moveTo(162, 250);
  g.lineTo(350, 250);
  g.stroke();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function addRoomEnvironment(group, baseY) {
  const floor = new Mesh(
    new PlaneGeometry(32, 32),
    new MeshStandardMaterial({ color: 0x080a09, roughness: 0.82, metalness: 0.16 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = baseY + 0.012;
  floor.receiveShadow = true;
  group.add(floor);

  // Фон сцены задают цвет и туман из main.js. Цилиндрическая циклорама здесь
  // выглядела как полукруглая стена вокруг автомата и добавляла лишнюю заливку.
}

export function buildMachine(scene, world, physMat) {
  const { INNER_X, INNER_Z, WALL_H, BASE_H, HOLE_MIN_X, HOLE_MIN_Z, CHUTE_BOTTOM } = DIMS;
  const spec = CABINET_SPEC;
  const group = new Group();
  scene.add(group);
  const metal = bodyMat();
  const trimGold = coatedMetalMat({
    name: 'cabinet-aged-brass',
    color: 0xc0934d,
    emissive: 0x261507,
    emissiveIntensity: 0.12,
    roughness: 0.44,
    metalness: 0.82,
    bumpScale: 0.006,
    clearcoat: 0.1,
    clearcoatRoughness: 0.46,
    anisotropy: 0.18,
  });
  const redTrim = coatedMetalMat({
    name: 'cabinet-red-enamel',
    color: 0x781a21,
    emissive: 0x3a0709,
    emissiveIntensity: 0.22,
    roughness: 0.54,
    metalness: 0.38,
    bumpScale: 0.009,
    clearcoat: 0.28,
    clearcoatRoughness: 0.38,
  });
  const blackPanel = coatedMetalMat({
    name: 'cabinet-black-powdercoat',
    color: 0x050907,
    roughness: 0.74,
    metalness: 0.42,
    bumpScale: 0.012,
    clearcoat: 0.06,
    clearcoatRoughness: 0.78,
  });
  const insetPanel = coatedMetalMat({
    name: 'cabinet-inset-powdercoat',
    color: 0x11231d,
    roughness: 0.78,
    metalness: 0.3,
    bumpScale: 0.016,
    clearcoat: 0.05,
    clearcoatRoughness: 0.82,
  });
  const screwMat = new MeshStandardMaterial({
    color: 0xc19a55,
    roughness: 0.3,
    metalness: 0.88,
  });
  const starMat = new MeshStandardMaterial({
    color: 0x9f1239,
    emissive: 0x7f1d1d,
    emissiveIntensity: 0.7,
    roughness: 0.42,
    metalness: 0.2,
  });
  const edgeWearMat = new MeshBasicMaterial({
    color: 0xf6d58b,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: DoubleSide,
  });
  const darkScratchMat = new MeshBasicMaterial({
    color: 0x020403,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: DoubleSide,
  });
  const paleScratchMat = new MeshBasicMaterial({
    color: 0xffefc2,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    side: DoubleSide,
  });
  addRoomEnvironment(group, -BASE_H);

  // === Комната ===
  // Визуальный пол уже создан как большая плоскость в addRoomEnvironment.
  // Круглый диск здесь давал заметную полукруглую границу вокруг автомата.
  // физический пол зала: выкаченные из лючка призы на нём лежат и катятся
  // (раньше пол был чисто визуальным — игрушки проваливались бы сквозь него)
  addStaticBox(world, physMat, 0, -BASE_H - 0.4, 0, 12, 0.4, 12);

  const grid = new GridHelper(32, 32, 0x7f1d1d, 0x1f3a30);
  grid.position.y = -BASE_H + 0.012;
  grid.material.transparent = true;
  grid.material.opacity = 0.45;
  grid.material.depthWrite = false;
  grid.renderOrder = 1;
  group.add(grid);

  // === Тумба и шапка ===
  const base = new Mesh(new RoundedBoxGeometry(spec.outerW, BASE_H, spec.outerD, 3, 0.065), metal);
  base.position.y = -BASE_H / 2;
  base.receiveShadow = true; base.castShadow = true;
  group.add(base);

  const head = new Mesh(new RoundedBoxGeometry(spec.outerW, spec.headH, spec.outerD, 3, 0.065), metal);
  head.position.y = WALL_H + spec.headH / 2;
  head.castShadow = true;
  group.add(head);

  const frontZ = spec.frontZ;
  const outerZ = spec.frontZ + 0.105;
  const frontPostX = spec.postX;
  for (const sx of [-1, 1]) {
    addRoundedBox(group, [0.2, 4.15, 0.16], [sx * frontPostX, 1.02, outerZ], metal, 0.034);
    addBox(group, [0.04, 3.82, 0.035], [sx * frontPostX, 1.07, outerZ + 0.085], trimGold);
    addBox(group, [0.055, 1.18, 0.026], [sx * frontPostX, 1.18, outerZ + 0.105], neonMat(NEON_AMBER, 1.65));
    addRoundedBox(group, [0.24, 0.16, 0.22], [sx * frontPostX, -1.37, outerZ], redTrim, 0.034);
    addRoundedBox(group, [0.2, 0.1, 0.16], [sx * frontPostX, -1.5, outerZ + 0.02], blackPanel, 0.026);
  }

  addRoundedBox(group, [spec.outerW + 0.2, 0.16, 0.16], [0, -1.32, outerZ], redTrim, 0.04);
  addBox(group, [spec.outerW + 0.08, 0.07, 0.08], [0, -1.18, outerZ + 0.045], trimGold);
  addBox(group, [spec.outerW + 0.14, 0.08, 0.12], [0, 0.02, outerZ], trimGold);
  addBox(group, [spec.outerW + 0.08, 0.08, 0.12], [0, WALL_H + 0.03, outerZ], redTrim);
  addBox(group, [spec.outerW * 0.74, 0.06, 0.08], [0, WALL_H + 0.18, outerZ + 0.02], trimGold);

  addFrontPanel(group, -0.47, -0.72, frontZ + 0.02, 0.98, 0.48, insetPanel, trimGold, screwMat);
  addFrontPanel(group, 0.88, -0.78, frontZ + 0.02, 0.78, 0.62, blackPanel, redTrim, screwMat);
  addVentStack(group, -1.02, -0.38, frontZ + 0.07, 0.42, 6, blackPanel);

  addBox(group, [0.58, 0.035, 0.065], [-0.43, -0.73, frontZ + 0.078], trimGold);
  addBox(group, [0.58, 0.035, 0.065], [-0.43, -0.82, frontZ + 0.078], trimGold);
  addBox(group, [0.12, 0.46, 0.035], [-spec.postX + 0.08, -0.75, frontZ + 0.09], neonMat(NEON_AMBER, 2.2));
  addBox(group, [0.12, 0.46, 0.035], [spec.postX - 0.08, -0.75, frontZ + 0.09], neonMat(NEON_AMBER, 2.2));

  const sideSign = -1;
  const sideX = spec.sideX * sideSign;
  const sidePanelDepth = spec.outerD * 0.78;
  addRoundedBox(group, [0.06, 2.9, sidePanelDepth], [sideX, 0.48, 0.02], insetPanel, 0.026);
  addBox(group, [0.07, 0.085, sidePanelDepth + 0.02], [sideX + sideSign * 0.028, 1.88, 0.02], redTrim);
  addBox(group, [0.07, 0.07, sidePanelDepth + 0.02], [sideX + sideSign * 0.03, 0.06, 0.02], trimGold);
  addBox(group, [0.07, 0.11, sidePanelDepth + 0.02], [sideX + sideSign * 0.035, -1.22, 0.02], redTrim);
  addBox(group, [0.064, 2.72, 0.05], [sideX + sideSign * 0.028, 0.42, -spec.halfD + 0.18], trimGold);
  addBox(group, [0.064, 2.72, 0.05], [sideX + sideSign * 0.028, 0.42, spec.halfD - 0.18], trimGold);
  addSidePanel(group, sideX + sideSign * 0.045, WALL_H + 0.48, 0.02, spec.outerD * 0.72, 0.46, insetPanel, trimGold, screwMat, sideSign);
  addSideStarBadge(group, sideX + sideSign * 0.065, 1.12, 0.18, starMat, insetPanel, trimGold, screwMat, sideSign);
  addSidePanel(group, sideX + sideSign * 0.052, -0.58, 0.08, spec.outerD * 0.58, 0.78, insetPanel, redTrim, screwMat, sideSign);
  addSidePlate(group, sideX + sideSign * 0.095, 0.1, spec.halfD * 0.48, tr('СЕКТОР', 'SECTOR'), tr('ПРИЗ', 'PRIZE'), 0.48, 0.15, '#ff3045', sideSign);
  addBox(group, [0.074, 0.54, spec.outerD * 0.3], [sideX + sideSign * 0.08, 0.58, -spec.halfD * 0.36], blackPanel);
  addSideVentStack(group, sideX + sideSign * 0.122, 0.78, -spec.halfD * 0.36, 0.42, 8, trimGold);
  addBox(group, [0.074, 0.36, spec.outerD * 0.26], [sideX + sideSign * 0.08, -0.62, spec.halfD * 0.2], blackPanel);
  addSideVentStack(group, sideX + sideSign * 0.122, -0.5, spec.halfD * 0.2, 0.36, 5, trimGold);

  // Дальняя сервисная сторона: закрытая панель как на референсе, но игровую стеклянную сторону не перекрываем.
  const serviceSkinX = sideX + sideSign * 0.13;
  addRoundedBox(group, [0.12, 2.76, spec.outerD * 0.74], [sideX + sideSign * 0.068, 0.42, 0.0], new MeshStandardMaterial({
    color: 0x0b1713,
    roughness: 0.74,
    metalness: 0.32,
    bumpMap: makeMetalBumpTexture(),
    bumpScale: 0.02,
  }), 0.04);
  addSidePanel(group, serviceSkinX, 0.86, 0.0, spec.outerD * 0.66, 1.52, insetPanel, trimGold, screwMat, sideSign);
  const serviceFaceMat = new MeshStandardMaterial({
    color: 0x14271f,
    roughness: 0.58,
    metalness: 0.44,
    bumpMap: makeMetalBumpTexture(),
    bumpScale: 0.022,
  });
  addRoundedBox(
    group,
    [0.03, 1.24, spec.outerD * 0.54],
    [serviceSkinX + sideSign * 0.032, 0.98, 0.0],
    serviceFaceMat,
    0.013
  );
  addBox(group, [0.085, 0.07, spec.outerD * 0.72], [serviceSkinX + sideSign * 0.016, 1.68, 0.0], redTrim);
  addBox(group, [0.085, 0.055, spec.outerD * 0.68], [serviceSkinX + sideSign * 0.018, 0.08, 0.0], trimGold);
  const serviceStarBack = addBox(
    group,
    [0.026, 0.48, 0.5],
    [serviceSkinX + sideSign * 0.026, 1.24, -0.18],
    new MeshStandardMaterial({ color: 0x060b08, roughness: 0.66, metalness: 0.48 })
  );
  serviceStarBack.name = 'serviceStarBackPlate';
  const serviceStarMat = starMat.clone();
  serviceStarMat.side = DoubleSide;
  const serviceStar = new Mesh(makeStarGeometry(0.29), serviceStarMat);
  serviceStar.name = 'serviceSideStar';
  serviceStar.rotation.y = -sideSign * Math.PI / 2;
  serviceStar.rotation.z = Math.PI;
  serviceStar.position.set(serviceSkinX + sideSign * 0.054, 1.24, -0.18);
  serviceStar.renderOrder = 3;
  group.add(serviceStar);
  addBox(group, [0.088, 0.024, 0.26], [serviceSkinX + sideSign * 0.062, 1.08, -0.52], trimGold);
  addBox(group, [0.088, 0.024, 0.26], [serviceSkinX + sideSign * 0.062, 1.08, 0.16], trimGold);
  addBox(group, [0.075, 0.48, spec.outerD * 0.3], [serviceSkinX + sideSign * 0.04, 0.5, 0.34], blackPanel);
  addSideVentStack(group, serviceSkinX + sideSign * 0.065, 0.68, 0.34, 0.38, 7, trimGold);
  addSidePanel(group, serviceSkinX + sideSign * 0.005, -0.78, 0.04, spec.outerD * 0.54, 0.62, insetPanel, redTrim, screwMat, sideSign);
  addBox(group, [0.075, 0.22, spec.outerD * 0.36], [serviceSkinX + sideSign * 0.04, -0.74, 0.04], blackPanel);
  addSideVentStack(group, serviceSkinX + sideSign * 0.065, -0.7, 0.04, 0.34, 4, trimGold);
  addSidePlate(group, serviceSkinX + sideSign * 0.054, 1.54, 0.46, '220V', tr('СЕРВИС', 'SERVICE'), 0.36, 0.105, '#ffc247', sideSign);
  addSidePlate(group, serviceSkinX + sideSign * 0.054, -1.08, -0.38, '67', tr('ИНВ.', 'INV.'), 0.28, 0.095, '#38f5ff', sideSign);
  for (const z of [-0.62, 0.62]) {
    addBox(group, [0.022, 0.34, 0.026], [serviceSkinX + sideSign * 0.062, 0.98, z], trimGold);
    addBox(group, [0.022, 0.22, 0.024], [serviceSkinX + sideSign * 0.062, -0.8, z * 0.68], redTrim);
  }

  const rearZ = -spec.innerZ - 0.085;
  addBox(group, [spec.outerW - 0.22, 2.72, 0.055], [0, 0.42, rearZ], insetPanel);
  addBox(group, [spec.outerW - 0.08, 0.085, 0.07], [0, 1.84, rearZ - 0.018], redTrim);
  addBox(group, [spec.outerW - 0.14, 0.065, 0.07], [0, 0.08, rearZ - 0.018], trimGold);
  addBox(group, [spec.outerW - 0.02, 0.12, 0.09], [0, -1.22, rearZ - 0.02], redTrim);
  addBox(group, [spec.outerW - 0.18, 0.56, 0.04], [0, -0.74, rearZ - 0.05], blackPanel);
  addVentStack(group, 0, -0.64, rearZ - 0.078, 0.56, 6, trimGold);
  for (const sx of [-1, 1]) {
    addBox(group, [0.09, 2.92, 0.085], [sx * (spec.postX - 0.02), 0.36, rearZ - 0.025], blackPanel);
    addBox(group, [0.035, 2.58, 0.045], [sx * (spec.postX - 0.08), 0.42, rearZ - 0.075], trimGold);
  }

  const baseBeltMat = new MeshStandardMaterial({
    color: 0x4b1118, emissive: 0x2f0609, emissiveIntensity: 0.35,
    roughness: 0.5, metalness: 0.34,
  });
  const baseBelt = new Mesh(new RoundedBoxGeometry(spec.outerW + 0.04, 0.18, 0.05, 2, 0.022), baseBeltMat);
  baseBelt.position.set(0, -0.18, frontZ - 0.045);
  group.add(baseBelt);
  const lowerBelt = baseBelt.clone();
  lowerBelt.position.y = -1.21;
  group.add(lowerBelt);

  const seamMat = new MeshStandardMaterial({ color: 0x030604, roughness: 0.82, metalness: 0.2 });
  const lockMat = new MeshStandardMaterial({ color: 0xc7b276, roughness: 0.32, metalness: 0.92 });
  for (const x of [-0.02, 0.55]) {
    addBox(group, [0.018, 0.86, 0.018], [x, -0.75, frontZ + 0.128], seamMat);
  }
  addBox(group, [spec.outerW - 0.34, 0.018, 0.018], [0, -0.38, frontZ + 0.13], seamMat);
  addBox(group, [spec.outerW - 0.34, 0.018, 0.018], [0, -1.04, frontZ + 0.13], seamMat);
  addFrontPanel(group, 0.18, -0.18, frontZ + 0.018, 0.54, 0.22, insetPanel, trimGold, screwMat);
  const servicePlate = makePlate(tr('СЕРВИС', 'SERVICE'), tr('ЗАМОК', 'LOCK'), 0.36, 0.105, '#38f5ff');
  servicePlate.position.set(0.18, -0.18, frontZ + 0.048);
  group.add(servicePlate);
  for (const [x, y] of [[0.55, -0.48], [0.55, -0.92], [-0.02, -0.48], [-0.02, -0.92]]) {
    addFrontScrew(group, x, y, frontZ + 0.15, screwMat, 0.014);
  }
  for (const [x, y] of [[0.56, -0.68], [-0.02, -0.68], [1.14, -0.7]]) {
    const lock = new Mesh(new CylinderGeometry(0.032, 0.032, 0.018, 18), lockMat);
    lock.rotation.x = Math.PI / 2;
    lock.position.set(x, y, frontZ + 0.152);
    group.add(lock);
    addBox(group, [0.05, 0.009, 0.04], [x, y, frontZ + 0.147], seamMat);
  }
  const frontServiceTag = makePlate(tr('ИНВ-67', 'INV-67'), tr('ОСМОТР', 'CHECK'), 0.34, 0.1, '#ffc247');
  frontServiceTag.position.set(-0.74, -1.08, frontZ + 0.172);
  frontServiceTag.renderOrder = 3;
  group.add(frontServiceTag);
  for (const [x, y, w] of [[-0.82, -0.51, 0.22], [-0.28, -0.94, 0.18], [0.94, -1.02, 0.2], [1.18, -0.5, 0.13]]) {
    const wear = addFrontPlane(group, w, 0.018, x, y, frontZ + 0.184, edgeWearMat);
    wear.rotation.z = x < 0 ? -0.05 : 0.06;
    wear.renderOrder = 3;
  }
  for (const [x, y, h] of [[-1.18, -0.7, 0.24], [-0.12, -0.73, 0.2], [0.48, -0.68, 0.18], [1.25, -0.88, 0.22]]) {
    const scratch = addFrontPlane(group, 0.012, h, x, y, frontZ + 0.185, darkScratchMat);
    scratch.rotation.z = 0.18;
    scratch.renderOrder = 3;
  }
  for (const x of [-1.22, -0.18, 0.42, 1.25]) {
    addFrontScrew(group, x, -1.13, frontZ + 0.18, screwMat, 0.012);
  }

  // потолок витрины (низ шапки)
  const ceiling = new Mesh(
    new BoxGeometry(spec.innerX * 2 + 0.16, 0.04, spec.innerZ * 2 + 0.16),
    new MeshStandardMaterial({ color: BODY_DARK, roughness: 0.82, metalness: 0.22 })
  );
  ceiling.position.y = WALL_H - 0.02;
  group.add(ceiling);

  // вывеска
  const signBack = new Mesh(
    new RoundedBoxGeometry(spec.outerW - 0.16, 0.7, 0.1, 3, 0.04),
    new MeshStandardMaterial({ color: 0x09110e, roughness: 0.46, metalness: 0.42 })
  );
  signBack.position.set(0, WALL_H + 0.5, frontZ - 0.04);
  group.add(signBack);
  const sign = new Mesh(
    new PlaneGeometry(spec.outerW - 0.32, 0.6),
    new MeshBasicMaterial({ map: makeSignTexture(), transparent: true })
  );
  // Передняя грань signBack выступает до frontZ + 0.01. Раньше плоскость
  // лежала на +0.005 и была утоплена внутрь, поэтому снаружи виделся чёрный щит.
  sign.position.set(0, WALL_H + 0.5, frontZ + 0.024);
  sign.name = 'cabinetMarquee';
  sign.renderOrder = 4;
  group.add(sign);

  addBox(group, [spec.outerW + 0.04, 0.055, 0.052], [0, WALL_H + 0.86, frontZ + 0.025], trimGold);
  addBox(group, [spec.outerW + 0.04, 0.055, 0.052], [0, WALL_H + 0.14, frontZ + 0.025], trimGold);
  addBox(group, [0.055, 0.68, 0.052], [-spec.postX, WALL_H + 0.5, frontZ + 0.025], trimGold);
  addBox(group, [0.055, 0.68, 0.052], [spec.postX, WALL_H + 0.5, frontZ + 0.025], trimGold);
  addBox(group, [spec.outerW - 0.12, 0.045, 0.045], [0, WALL_H + 0.78, frontZ + 0.032], redTrim);
  addBox(group, [spec.outerW - 0.12, 0.045, 0.045], [0, WALL_H + 0.22, frontZ + 0.032], redTrim);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      addFrontScrew(group, sx * (spec.postX - 0.03), WALL_H + 0.5 + sy * 0.31, frontZ + 0.064, screwMat, 0.018);
    }
  }

  const signGlow = new Mesh(new BoxGeometry(2.68, 0.035, 0.035), neonMat(NEON_RED, 1.6));
  signGlow.scale.x = (spec.outerW - 0.28) / 2.68;
  signGlow.position.set(0, WALL_H + 0.14, frontZ + 0.005);
  group.add(signGlow);

  const visor = new Mesh(
    new RoundedBoxGeometry(spec.outerW - 0.08, 0.12, 0.24, 3, 0.04),
    new MeshStandardMaterial({ color: BODY_DARK, roughness: 0.58, metalness: 0.4 })
  );
  visor.position.set(0, WALL_H + 0.02, spec.frontGlassZ - 0.14);
  group.add(visor);

  const lampMat = new MeshStandardMaterial({
    color: 0xffdd9a, emissive: NEON_AMBER, emissiveIntensity: 1.4,
    roughness: 0.28, metalness: 0.12,
  });
  const lampHousingMat = new MeshStandardMaterial({
    color: 0x07100d, roughness: 0.58, metalness: 0.62,
  });
  for (const x of [-0.66, 0.66]) {
    addRoundedBox(group, [0.46, 0.028, 0.22], [x, WALL_H - 0.035, 1.23], lampHousingMat, 0.012);
    addRoundedBox(group, [0.38, 0.026, 0.17], [x, WALL_H - 0.055, 1.23], lampMat, 0.011);
    const lampTrimFront = addBox(group, [0.29, 0.008, 0.012], [x, WALL_H - 0.071, 1.155], trimGold);
    const lampTrimBack = addBox(group, [0.29, 0.008, 0.012], [x, WALL_H - 0.071, 1.305], trimGold);
    lampTrimFront.name = 'interiorLampTrim';
    lampTrimBack.name = 'interiorLampTrim';
  }

  // === Пол витрины (два сегмента, дыра в углу +x+z) ===
  const floorMatV = new MeshStandardMaterial({
    color: 0x10251f,
    roughness: 0.82,
    metalness: 0.2,
  });
  // сегмент A: x ∈ [-INNER_X, HOLE_MIN_X], вся глубина
  const segAw = HOLE_MIN_X + INNER_X;
  const segA = new Mesh(new BoxGeometry(segAw, 0.12, INNER_Z * 2), floorMatV);
  segA.position.set(-INNER_X + segAw / 2, -0.065, 0);
  segA.receiveShadow = true;
  group.add(segA);
  // сегмент B: x ∈ [HOLE_MIN_X, INNER_X], z ∈ [-INNER_Z, HOLE_MIN_Z]
  const segBw = INNER_X - HOLE_MIN_X;
  const segBd = HOLE_MIN_Z + INNER_Z;
  const segB = new Mesh(new BoxGeometry(segBw, 0.12, segBd), floorMatV);
  segB.position.set(HOLE_MIN_X + segBw / 2, -0.065, -INNER_Z + segBd / 2);
  segB.receiveShadow = true;
  group.add(segB);

  // Тонкие инкрустированные канавки дают полу масштаб, но не меняют физическую высоту.
  const floorGrooveMat = new MeshStandardMaterial({
    color: 0x050a08, roughness: 0.9, metalness: 0.18,
  });
  for (const x of [-0.92, -0.46, 0, 0.46]) {
    addRoundedBox(group, [0.016, 0.004, INNER_Z * 2 - 0.12], [x, -0.002, 0], floorGrooveMat, 0.002, null, 1);
  }
  for (const z of [-0.72, -0.24, 0.24, 0.72]) {
    addRoundedBox(group, [segAw - 0.12, 0.004, 0.016], [segA.position.x, -0.001, z], floorGrooveMat, 0.002, null, 1);
  }

  addStaticBox(world, physMat, segA.position.x, -0.1, 0, segAw / 2, 0.1, INNER_Z);
  addStaticBox(world, physMat, segB.position.x, -0.1, segB.position.z, segBw / 2, 0.1, segBd / 2);

  // === Бортики дыры (чтобы куча сама не сыпалась в лоток) ===
  const rimMat = new MeshStandardMaterial({ color: PANEL_GREEN, roughness: 0.72, metalness: 0.24 });
  const rimH = 0.4;
  const rimT = 0.16;
  const holeCx = (HOLE_MIN_X + INNER_X) / 2;
  const holeCz = (HOLE_MIN_Z + INNER_Z) / 2;
  const glassPlane = spec.frontGlassZ;
  const glassClear = 0.045;
  const rimZStart = HOLE_MIN_Z - rimT / 2;
  const rimZEnd = glassPlane - glassClear;
  const rimZLen = rimZEnd - rimZStart;
  const rimZCenter = (rimZStart + rimZEnd) / 2;
  const rimXStart = HOLE_MIN_X - rimT / 2;
  const rimXEnd = INNER_X;
  const rimXLen = rimXEnd - rimXStart;
  const rimXCenter = (rimXStart + rimXEnd) / 2;
  const rimA = new Mesh(new BoxGeometry(rimT, rimH, rimZLen), rimMat);
  rimA.position.set(HOLE_MIN_X, rimH / 2, rimZCenter);
  group.add(rimA);
  const rimB = new Mesh(new BoxGeometry(rimXLen, rimH, rimT), rimMat);
  rimB.position.set(rimXCenter, rimH / 2, HOLE_MIN_Z);
  group.add(rimB);
  const capAGeo = new CylinderGeometry(0.035, 0.035, rimZLen, 14);
  const capBGeo = new CylinderGeometry(0.035, 0.035, rimXLen, 14);
  const capA = new Mesh(capAGeo, rimMat);
  capA.position.set(HOLE_MIN_X, rimH + 0.035, rimZCenter);
  capA.rotation.x = Math.PI / 2;
  const capB = new Mesh(capBGeo, rimMat);
  capB.position.set(rimXCenter, rimH + 0.035, HOLE_MIN_Z);
  capB.rotation.z = Math.PI / 2;
  group.add(capA, capB);
  // неон-кромки бортиков
  const rimGlowZLen = Math.max(0.1, rimZLen - 0.06);
  const rimGlowXLen = Math.max(0.1, rimXLen - 0.06);
  const rimGlowA = new Mesh(new BoxGeometry(0.065, 0.025, rimGlowZLen), neonMat(NEON_AMBER, 2.1));
  rimGlowA.position.set(HOLE_MIN_X, rimH + 0.01, rimZCenter);
  group.add(rimGlowA);
  const rimGlowB = new Mesh(new BoxGeometry(rimGlowXLen, 0.025, 0.065), neonMat(NEON_AMBER, 2.1));
  rimGlowB.position.set(rimXCenter, rimH + 0.01, HOLE_MIN_Z);
  group.add(rimGlowB);
  for (const glow of [rimGlowA, rimGlowB]) {
    glow.material.depthWrite = false;
    glow.material.polygonOffset = true;
    glow.material.polygonOffsetFactor = -2;
    glow.material.polygonOffsetUnits = -2;
    glow.renderOrder = 2;
  }

  addStaticBox(world, physMat, HOLE_MIN_X, rimH / 2, holeCz, rimT / 2, rimH / 2, (INNER_Z - HOLE_MIN_Z) / 2 + rimT / 2);
  addStaticBox(world, physMat, holeCx, rimH / 2, HOLE_MIN_Z, segBw / 2 + rimT / 2, rimH / 2, rimT / 2);

  // === Шахта приза (вниз внутри тумбы) ===
  const chuteMat = new MeshStandardMaterial({ color: 0x020603, roughness: 0.96, metalness: 0.08 });
  const chuteDepth = -CHUTE_BOTTOM;
  const chuteWallT = 0.12;
  const chuteWallA = new Mesh(new BoxGeometry(chuteWallT, chuteDepth, rimZLen), chuteMat);
  chuteWallA.position.set(HOLE_MIN_X - chuteWallT / 2, CHUTE_BOTTOM / 2, rimZCenter);
  group.add(chuteWallA);
  const chuteWallB = new Mesh(new BoxGeometry(rimXLen, chuteDepth, chuteWallT), chuteMat);
  chuteWallB.position.set(rimXCenter, CHUTE_BOTTOM / 2, HOLE_MIN_Z - chuteWallT / 2);
  const chuteOuterVisualT = 0.04;
  const chuteOuterX = INNER_X + chuteOuterVisualT / 2;
  const chuteOuterZ = glassPlane + chuteOuterVisualT / 2;
  const chuteWallC = new Mesh(new BoxGeometry(chuteOuterVisualT, chuteDepth, rimZLen), chuteMat);
  chuteWallC.position.set(chuteOuterX, CHUTE_BOTTOM / 2, rimZCenter);
  const chuteWallD = new Mesh(new BoxGeometry(rimXLen, chuteDepth, chuteOuterVisualT), chuteMat);
  chuteWallD.position.set(rimXCenter, CHUTE_BOTTOM / 2, chuteOuterZ);
  group.add(chuteWallB, chuteWallC, chuteWallD);

  addStaticBox(world, physMat, HOLE_MIN_X - chuteWallT / 2, CHUTE_BOTTOM / 2, holeCz, chuteWallT / 2, chuteDepth / 2, (INNER_Z - HOLE_MIN_Z) / 2 + chuteWallT / 2);
  addStaticBox(world, physMat, holeCx, CHUTE_BOTTOM / 2, HOLE_MIN_Z - chuteWallT / 2, segBw / 2 + chuteWallT / 2, chuteDepth / 2, chuteWallT / 2);
  addStaticBox(world, physMat, INNER_X + chuteWallT / 2, CHUTE_BOTTOM / 2, holeCz, chuteWallT / 2, chuteDepth / 2, (INNER_Z - HOLE_MIN_Z) / 2 + chuteWallT / 2);
  addStaticBox(world, physMat, holeCx, CHUTE_BOTTOM / 2, glassPlane + chuteWallT / 2, segBw / 2 + chuteWallT / 2, chuteDepth / 2, chuteWallT / 2);

  const abyss = new Mesh(
    new PlaneGeometry(segBw + 0.12, INNER_Z - HOLE_MIN_Z + 0.12),
    new MeshBasicMaterial({ color: 0x000000 })
  );
  abyss.rotation.x = -Math.PI / 2;
  abyss.position.set(holeCx, CHUTE_BOTTOM - 1.4, holeCz);
  group.add(abyss);

  // подсветка приёмника изнутри
  const prizeLight = new PointLight(NEON_AMBER, 0.95, 1.2);
  prizeLight.position.set(holeCx, -0.85, holeCz);
  group.add(prizeLight);

  // === Окно выдачи на фронте тумбы ===
  const deliveryX = holeCx + 0.02;
  const deliveryY = -0.78;
  const deliveryZ = frontZ + 0.045;
  const deliveryPortalW = 0.9;
  const deliveryPortalH = 0.94;
  const deliveryOpeningW = 0.58;
  const deliveryOpeningH = 0.48;
  const deliveryDark = new MeshBasicMaterial({ color: 0x000000 });
  const deliveryInnerMat = new MeshStandardMaterial({
    color: 0x07100c,
    roughness: 0.78,
    metalness: 0.22,
    bumpMap: makeMetalBumpTexture(),
    bumpScale: 0.018,
  });
  addRoundedBox(group, [deliveryPortalW, deliveryPortalH, 0.06], [deliveryX, deliveryY, deliveryZ], blackPanel, 0.032);
  addRoundedBox(group, [0.82, 0.86, 0.06], [deliveryX, deliveryY, deliveryZ + 0.026], redTrim, 0.03);
  addRoundedBox(group, [0.74, 0.78, 0.065], [deliveryX, deliveryY, deliveryZ + 0.055], trimGold, 0.03);
  addRoundedBox(group, [0.66, 0.64, 0.07], [deliveryX, deliveryY - 0.035, deliveryZ + 0.085], deliveryInnerMat, 0.032);
  addRoundedBox(group, [deliveryOpeningW, deliveryOpeningH, 0.045], [deliveryX, deliveryY - 0.065, deliveryZ + 0.13], deliveryDark, 0.02);
  addBox(group, [0.61, 0.036, 0.2], [deliveryX, deliveryY + 0.185, deliveryZ + 0.14], deliveryInnerMat);
  addBox(group, [0.61, 0.04, 0.2], [deliveryX, deliveryY - 0.34, deliveryZ + 0.145], deliveryInnerMat, [0.1, 0, 0]);
  addBox(group, [0.035, 0.54, 0.2], [deliveryX - 0.325, deliveryY - 0.06, deliveryZ + 0.13], deliveryInnerMat);
  addBox(group, [0.035, 0.54, 0.2], [deliveryX + 0.325, deliveryY - 0.06, deliveryZ + 0.13], deliveryInnerMat);
  addBox(group, [0.48, 0.024, 0.17], [deliveryX, deliveryY - 0.315, deliveryZ + 0.13], trimGold, [0.12, 0, 0]);
  addBox(group, [0.4, 0.018, 0.14], [deliveryX, deliveryY - 0.338, deliveryZ + 0.148], redTrim, [0.12, 0, 0]);
  const deliveryRubberMat = new MeshStandardMaterial({
    color: 0x050806,
    roughness: 0.92,
    metalness: 0.04,
  });
  const deliveryAmberMat = new MeshStandardMaterial({
    color: 0xffefc2,
    emissive: NEON_AMBER,
    emissiveIntensity: 1.05,
    roughness: 0.24,
    metalness: 0.1,
  });
  for (let i = 0; i < 5; i++) {
    const strip = addBox(
      group,
      [0.06, 0.16, 0.08],
      [deliveryX + (i - 2) * 0.076, deliveryY + 0.13, deliveryZ + 0.13],
      deliveryRubberMat
    );
    strip.rotation.z = (i - 2) * 0.025;
  }
  for (const x of [-0.23, 0, 0.23]) {
    addBox(group, [0.095, 0.014, 0.07], [deliveryX + x, deliveryY + 0.345, deliveryZ + 0.115], deliveryAmberMat);
  }
  for (const x of [-0.2, 0, 0.2]) {
    addBox(group, [0.018, 0.018, 0.2], [deliveryX + x, deliveryY - 0.285, deliveryZ + 0.16], deliveryRubberMat, [0.12, 0, 0]);
  }
  addBox(group, [0.18, 0.022, 0.028], [deliveryX, deliveryY - 0.49, deliveryZ + 0.15], trimGold, [0.08, 0, 0]);
  addBox(group, [0.25, 0.018, 0.024], [deliveryX, deliveryY - 0.445, deliveryZ + 0.14], redTrim, [0.08, 0, 0]);
  const deliveryPlate = makePlate(
    tr('ЗАБРАТЬ', 'COLLECT'),
    settings.gameMode === 'fugitives' ? tr('ПОЙМАН', 'CAPTIVE') : tr('ПРИЗ', 'PRIZE'),
    0.5, 0.14, '#ffc247'
  );
  deliveryPlate.position.set(deliveryX, deliveryY + 0.455, deliveryZ + 0.07);
  deliveryPlate.renderOrder = 3;
  group.add(deliveryPlate);
  const arrowShape = new Shape();
  arrowShape.moveTo(0, -0.042);
  arrowShape.lineTo(-0.038, 0.032);
  arrowShape.lineTo(0.038, 0.032);
  arrowShape.closePath();
  const arrowGeo = new ShapeGeometry(arrowShape);
  const arrowMat = new MeshBasicMaterial({ color: 0xffc247, side: DoubleSide });
  for (const x of [-0.28, 0.28]) {
    const arrow = new Mesh(arrowGeo, arrowMat);
    arrow.position.set(deliveryX + x, deliveryY + 0.365, deliveryZ + 0.075);
    arrow.renderOrder = 3;
    group.add(arrow);
  }
  const deliveryLight = new PointLight(NEON_AMBER, 0.48, 0.8);
  deliveryLight.position.set(deliveryX, deliveryY + 0.02, deliveryZ + 0.22);
  group.add(deliveryLight);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      addFrontScrew(group, deliveryX + sx * 0.39, deliveryY + sy * 0.42, deliveryZ + 0.08, screwMat, 0.014);
    }
  }

  // === Откидная крышка лючка ===
  // pivot по верхнему краю проёма выдачи; закрыто rot.x=0 (заслонка вертикальна),
  // открыто низ уходит наружу-вверх. Приз выкатывается когда крышка откинута.
  const hatchW = deliveryOpeningW - 0.02, hatchH = deliveryOpeningH - 0.02;
  const hatchTopY = deliveryY - 0.065 + hatchH / 2;   // верхний край проёма
  const hatchZ = deliveryZ + 0.12;
  const lidPivot = new Group();
  lidPivot.position.set(deliveryX, hatchTopY, hatchZ);
  const lidMat = new MeshStandardMaterial({
    color: 0x0a1512,
    roughness: 0.5,
    metalness: 0.55,
    bumpMap: makeMetalBumpTexture(),
    bumpScale: 0.015,
  });
  const lidPanel = addRoundedBox(lidPivot, [hatchW, hatchH, 0.035], [0, -hatchH / 2, 0.01], lidMat, 0.015);
  lidPanel.castShadow = true;
  addRoundedBox(lidPivot, [hatchW - 0.055, hatchH - 0.055, 0.016], [0, -hatchH / 2, 0.032], blackPanel, 0.007);
  addBox(lidPivot, [hatchW + 0.03, 0.02, 0.026], [0, -0.012, 0.014], trimGold); // ребро верх
  addBox(lidPivot, [hatchW + 0.03, 0.018, 0.024], [0, -hatchH + 0.01, 0.016], redTrim); // ребро низ
  for (let i = 0; i < 4; i++) {
    addBox(lidPivot, [0.02, hatchH - 0.06, 0.022], [(i - 1.5) * 0.14, -hatchH / 2, 0.016], deliveryRubberMat);
  }
  addBox(lidPivot, [0.11, 0.03, 0.024], [0, -hatchH + 0.05, 0.02], deliveryAmberMat); // подсветка-ручка
  group.add(lidPivot);

  const frontStar = new Mesh(makeStarGeometry(0.24), starMat);
  frontStar.rotation.z = Math.PI;
  frontStar.position.set(-0.58, -0.62, frontZ + 0.07);
  group.add(frontStar);
  addBox(group, [0.32, 0.026, 0.026], [-0.88, -0.69, frontZ + 0.075], trimGold);
  addBox(group, [0.32, 0.026, 0.026], [-0.28, -0.69, frontZ + 0.075], trimGold);
  addBox(group, [0.22, 0.026, 0.026], [-0.83, -0.78, frontZ + 0.075], trimGold);
  addBox(group, [0.22, 0.026, 0.026], [-0.33, -0.78, frontZ + 0.075], trimGold);
  const serialPlate = makePlate('7-67', tr('СЕРИЯ', 'SERIES'), 0.44, 0.14, '#38f5ff');
  serialPlate.position.set(0.04, -0.38, frontZ + 0.012);
  group.add(serialPlate);

  const ventMat = new MeshStandardMaterial({ color: 0x050806, roughness: 0.8, metalness: 0.35 });
  for (let i = 0; i < 7; i++) {
    const vent = new Mesh(new BoxGeometry(0.52, 0.018, 0.025), ventMat);
    vent.position.set(-1.0, -0.28 - i * 0.055, frontZ + 0.012);
    group.add(vent);
  }

  // === Вынесенная консоль управления ===
  const panelSpec = {
    x: spec.panel.x,
    backZ: outerZ + 0.02,
    deckZ: outerZ + 0.28,
    deckY: 0.17,
    width: spec.panel.width,
    depth: spec.panel.depth,
    tilt: spec.panel.tilt,
  };
  addRoundedBox(group, [panelSpec.width + 0.18, 0.24, 0.42], [panelSpec.x, -0.08, panelSpec.backZ + 0.03], metal, 0.055);
  addBox(group, [panelSpec.width + 0.02, 0.055, 0.07], [panelSpec.x, 0.09, panelSpec.backZ + 0.2], trimGold);
  addBox(group, [panelSpec.width + 0.02, 0.04, 0.055], [panelSpec.x, -0.25, panelSpec.backZ + 0.19], redTrim);
  addRoundedBox(group, [0.08, 0.38, 0.5], [panelSpec.x - panelSpec.width / 2 + 0.08, -0.02, panelSpec.backZ + 0.21], metal, 0.018, [panelSpec.tilt * 0.45, 0, 0]);
  addRoundedBox(group, [0.08, 0.38, 0.5], [panelSpec.x + panelSpec.width / 2 - 0.08, -0.02, panelSpec.backZ + 0.21], metal, 0.018, [panelSpec.tilt * 0.45, 0, 0]);
  addRoundedBox(group, [0.11, 0.48, 0.34], [panelSpec.x - panelSpec.width / 2 + 0.03, -0.2, panelSpec.backZ + 0.14], metal, 0.022, [panelSpec.tilt * 0.32, 0, 0]);
  addRoundedBox(group, [0.11, 0.48, 0.34], [panelSpec.x + panelSpec.width / 2 - 0.03, -0.2, panelSpec.backZ + 0.14], metal, 0.022, [panelSpec.tilt * 0.32, 0, 0]);
  addRoundedBox(group, [panelSpec.width + 0.02, 0.28, 0.18], [panelSpec.x, -0.25, panelSpec.backZ + 0.12], metal, 0.045, [panelSpec.tilt * 0.18, 0, 0]);
  addBox(group, [panelSpec.width + 0.04, 0.07, 0.06], [panelSpec.x, -0.23, panelSpec.deckZ + 0.12], redTrim, [0.12, 0, 0]);
  addBox(group, [panelSpec.width - 0.06, 0.048, 0.05], [panelSpec.x, -0.29, panelSpec.deckZ + 0.08], trimGold, [0.12, 0, 0]);
  const controlDeck = new Mesh(
    new RoundedBoxGeometry(panelSpec.width, 0.1, panelSpec.depth, 3, 0.038),
    new MeshStandardMaterial({
      color: 0x111714,
      roughness: 0.52,
      metalness: 0.46,
      bumpMap: makeMetalBumpTexture(),
      bumpScale: 0.014,
    })
  );
  controlDeck.position.set(panelSpec.x, panelSpec.deckY, panelSpec.deckZ);
  controlDeck.rotation.x = panelSpec.tilt;
  group.add(controlDeck);
  const cheekMat = new MeshStandardMaterial({
    color: 0x09120f,
    roughness: 0.64,
    metalness: 0.38,
    side: DoubleSide,
  });
  function addPanelCheek(sideSign) {
    const cheek = new Shape();
    cheek.moveTo(-0.34, -0.205);
    cheek.lineTo(0.36, -0.18);
    cheek.lineTo(0.3, 0.08);
    cheek.lineTo(-0.26, 0.18);
    cheek.closePath();
    const cheekGeo = new ExtrudeGeometry(cheek, {
      depth: 0.038,
      steps: 1,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.015,
      bevelThickness: 0.01,
    });
    cheekGeo.translate(0, 0, -0.019);
    const mesh = new Mesh(cheekGeo, cheekMat);
    mesh.position.set(panelSpec.x + sideSign * (panelSpec.width / 2 + 0.018), -0.005, panelSpec.deckZ + 0.025);
    mesh.rotation.y = -sideSign * Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    addBox(group, [0.035, 0.03, 0.42], [panelSpec.x + sideSign * (panelSpec.width / 2 + 0.024), 0.075, panelSpec.deckZ + 0.05], trimGold, [0.12, 0, 0]);
  }
  addPanelCheek(-1);
  addPanelCheek(1);
  addRoundedBox(group, [panelSpec.width + 0.08, 0.13, 0.06], [panelSpec.x, 0.02, panelSpec.deckZ + 0.35], blackPanel, 0.026, [0.14, 0, 0]);
  addBox(group, [panelSpec.width + 0.02, 0.04, 0.07], [panelSpec.x, 0.11, panelSpec.deckZ + 0.325], trimGold, [0.14, 0, 0]);
  addBox(group, [panelSpec.width - 0.16, 0.025, 0.035], [panelSpec.x, -0.025, panelSpec.deckZ + 0.375], redTrim, [0.14, 0, 0]);
  addBox(group, [panelSpec.width - 0.26, 0.045, 0.045], [panelSpec.x, 0.25, panelSpec.backZ - 0.02], redTrim);
  const deckCos = Math.cos(panelSpec.tilt);
  const deckSin = Math.sin(panelSpec.tilt);
  function deckPoint(x, localZ, lift = 0) {
    const localY = 0.06 + lift;
    return [
      x,
      panelSpec.deckY + localY * deckCos - localZ * deckSin,
      panelSpec.deckZ + localY * deckSin + localZ * deckCos,
    ];
  }
  const deckPlateRot = panelSpec.tilt - Math.PI / 2;
  function addDeckPlate(title, subtitle, x, z, w, h, accent) {
    const plate = makePlate(title, subtitle, w, h, accent);
    plate.material.side = DoubleSide;
    plate.position.set(...deckPoint(x, z, 0.006));
    plate.rotation.x = deckPlateRot;
    group.add(plate);
    return plate;
  }

  addDeckPlate(tr('ЖЕТОН', 'TOKEN'), tr('ОПЛАТА', 'PAY'), 0.22, 0.085, 0.56, 0.16, '#ffc247');
  addDeckPlate(tr('ХОД', 'MOVE'), tr('КАРЕТКА', 'CARRIAGE'), -1.0, 0.3, 0.34, 0.105, '#38f5ff');
  addDeckPlate(tr('ХВАТ', 'GRAB'), tr('КНОПКА', 'BUTTON'), -0.44, 0.3, 0.34, 0.105, '#ff3045');
  for (const sx of [-1, 1]) {
    addFrontScrew(group, panelSpec.x + sx * 1.04, 0.22, panelSpec.deckZ + 0.17, screwMat, 0.018);
  }

  const coinX = 0.78;
  const coinLocalZ = 0.12;
  const coinRot = [panelSpec.tilt, 0, 0];
  const coinBase = addBox(
    group,
    [0.28, 0.032, 0.42],
    deckPoint(coinX, coinLocalZ, 0.016),
    new MeshStandardMaterial({ color: 0x1e332b, roughness: 0.48, metalness: 0.62 }),
    coinRot
  );
  const coinGlow = addBox(group, [0.16, 0.038, 0.31], deckPoint(coinX, coinLocalZ, 0.022), neonMat(NEON_AMBER, 1.8), coinRot);
  const coinPocket = addBox(group, [0.095, 0.044, 0.245], deckPoint(coinX, coinLocalZ, 0.03), new MeshBasicMaterial({ color: 0x02040a }), coinRot);
  const coinSlotMesh = addBox(
    group,
    [0.038, 0.052, 0.22],
    deckPoint(coinX, coinLocalZ, 0.039),
    new MeshStandardMaterial({ color: 0x010204, roughness: 0.9 }),
    coinRot
  );
  const coinAcceptor = [coinBase, coinGlow, coinPocket, coinSlotMesh];
  for (const part of coinAcceptor) {
    part.name = 'panelCoinAcceptor';
    part.userData.panelControl = 'coin';
  }

  const lampBezelMat = new MeshStandardMaterial({ color: 0x050806, roughness: 0.36, metalness: 0.82 });
  function makePanelLamp(name, x, z, color) {
    addBox(group, [0.095, 0.018, 0.052], deckPoint(x, z, 0.012), lampBezelMat, coinRot);
    const mat = new MeshStandardMaterial({
      color: 0x08100e,
      emissive: color,
      emissiveIntensity: 0.18,
      roughness: 0.22,
      metalness: 0.08,
    });
    const lamp = new Mesh(new CylinderGeometry(0.025, 0.025, 0.02, 18), mat);
    lamp.name = name;
    lamp.position.set(...deckPoint(x, z, 0.026));
    lamp.rotation.x = panelSpec.tilt;
    lamp.castShadow = true;
    group.add(lamp);
    return lamp;
  }
  const creditLamps = [
    makePanelLamp('panelCreditLamp1', 0.0, 0.2, NEON_AMBER),
    makePanelLamp('panelCreditLamp2', 0.09, 0.2, NEON_AMBER),
    makePanelLamp('panelCreditLamp3', 0.18, 0.2, NEON_AMBER),
  ];
  const readyLamp = makePanelLamp('panelReadyLamp', -0.24, 0.2, NEON_CYAN);

  const joystick = new Group();
  joystick.position.set(...deckPoint(-1.0, 0.02, 0.026));
  joystick.rotation.x = panelSpec.tilt;
  group.add(joystick);
  const stickPivot = new Group();
  stickPivot.name = 'panelJoystickPivot';
  stickPivot.userData.restPitch = -0.18;
  stickPivot.userData.pitchRange = 0.42;
  stickPivot.userData.rollRange = 0.38;
  stickPivot.rotation.x = stickPivot.userData.restPitch;
  stickPivot.userData.panelControl = 'joystick';
  const joyBase = new Mesh(
    new CylinderGeometry(0.13, 0.17, 0.045, 24),
    new MeshStandardMaterial({ color: 0x050806, roughness: 0.45, metalness: 0.65 })
  );
  joyBase.name = 'panelJoystickBase';
  const joyBezel = new Mesh(
    new TorusGeometry(0.175, 0.012, 8, 32),
    new MeshStandardMaterial({ color: 0xffc247, emissive: 0xffc247, emissiveIntensity: 0.35, roughness: 0.28, metalness: 0.7 })
  );
  joyBezel.name = 'panelJoystickBezel';
  joyBezel.rotation.x = Math.PI / 2;
  const joyStick = new Mesh(
    new CylinderGeometry(0.024, 0.03, 0.32, 12),
    new MeshStandardMaterial({ color: 0xb7a376, roughness: 0.38, metalness: 0.78 })
  );
  joyStick.name = 'panelJoystickStick';
  joyStick.position.set(0, 0.16, 0);
  joyStick.userData.panelControl = 'joystick';
  const joyKnob = new Mesh(
    new SphereGeometry(0.09, 22, 14),
    new MeshStandardMaterial({ color: 0x9f1239, emissive: 0x7f1d1d, emissiveIntensity: 0.28, roughness: 0.42 })
  );
  joyKnob.name = 'panelJoystickKnob';
  joyKnob.userData.panelControl = 'joystick';
  joyKnob.position.set(0, 0.34, 0);
  const redButton = new Mesh(
    new CylinderGeometry(0.12, 0.12, 0.052, 28),
    new MeshStandardMaterial({ color: 0xd62f2f, emissive: 0x7f1d1d, emissiveIntensity: 0.6, roughness: 0.24, metalness: 0.25 })
  );
  redButton.name = 'panelGrabButton';
  redButton.userData.panelControl = 'button';
  const buttonRest = deckPoint(-0.44, 0.02, 0.031);
  redButton.userData.restY = buttonRest[1];
  redButton.userData.pressY = buttonRest[1] - 0.045;
  redButton.position.set(...buttonRest);
  redButton.rotation.x = panelSpec.tilt;
  const buttonRing = new Mesh(
    new TorusGeometry(0.153, 0.013, 8, 34),
    new MeshStandardMaterial({ color: 0xffc247, emissive: 0xff3045, emissiveIntensity: 0.35, roughness: 0.28, metalness: 0.72 })
  );
  buttonRing.name = 'panelGrabButtonRing';
  buttonRing.position.set(...deckPoint(-0.44, 0.02, 0.014));
  buttonRing.rotation.x = Math.PI / 2 + panelSpec.tilt;
  group.add(buttonRing);
  stickPivot.add(joyStick, joyKnob);
  joystick.add(joyBase, joyBezel, stickPivot);
  group.add(redButton);

  // === Стойки, стекло, физика стен ===
  addBox(group, [spec.innerX * 2 + 0.22, 0.16, 0.13], [0, WALL_H - 0.03, outerZ], blackPanel);
  addBox(group, [spec.innerX * 2 + 0.08, 0.06, 0.08], [0, WALL_H - 0.13, outerZ + 0.045], trimGold);
  addBox(group, [spec.innerX * 2 + 0.22, 0.13, 0.12], [0, 0.06, outerZ], blackPanel);
  addBox(group, [spec.innerX * 2 + 0.08, 0.045, 0.08], [0, 0.16, outerZ + 0.04], trimGold);
  for (const sx of [-1, 1]) {
    addBox(group, [0.13, WALL_H, 0.12], [sx * spec.postX, WALL_H / 2, outerZ], blackPanel);
    addBox(group, [0.035, WALL_H - 0.24, 0.06], [sx * (spec.postX - 0.08), WALL_H / 2, outerZ + 0.06], trimGold);
    for (const y of [0.32, 0.78, 1.24, 1.7, 2.16, 2.52]) {
      addFrontScrew(group, sx * spec.postX, y, outerZ + 0.075, screwMat, 0.014);
    }
  }

  const post = new BoxGeometry(0.1, WALL_H, 0.1);
  for (const [idx, [px, pz]] of [[-spec.postX, -spec.postZ], [spec.postX, -spec.postZ], [-spec.postX, spec.postZ], [spec.postX, spec.postZ]].entries()) {
    const p = new Mesh(post, metal);
    p.position.set(px, WALL_H / 2, pz);
    p.castShadow = true;
    group.add(p);
    const tubeColor = idx % 2 === 0 ? NEON_RED : NEON_CYAN;
    const tube = new Mesh(new BoxGeometry(0.025, WALL_H, 0.025), neonMat(tubeColor, 2.8));
    tube.position.set(px * 0.963, WALL_H / 2, pz * 0.963);
    group.add(tube);
  }

  const glassMat = new MeshPhysicalMaterial({
    color: 0xeaf8ff,
    roughness: 0.065,
    metalness: 0,
    transparent: true,
    opacity: 0.072,
    ior: 1.47,
    clearcoat: 0.72,
    clearcoatRoughness: 0.12,
    specularIntensity: 0.68,
    envMapIntensity: 0.58,
    side: DoubleSide,
    depthWrite: false,
  });
  // Небольшая реальная толщина даёт отражение на кромке без декоративных накладок.
  const glassFrontGeo = new BoxGeometry(spec.innerX * 2, WALL_H, 0.012);
  const glassSideGeo = new BoxGeometry(spec.innerZ * 2, WALL_H, 0.012);
  const glassDefs = [
    { geo: glassFrontGeo, pos: [0, WALL_H / 2, spec.frontGlassZ], rotY: 0 },
    { geo: glassFrontGeo, pos: [0, WALL_H / 2, -spec.innerZ], rotY: Math.PI },
    { geo: glassSideGeo, pos: [spec.innerX, WALL_H / 2, (spec.frontGlassZ - spec.innerZ) / 2], rotY: -Math.PI / 2 },
    { geo: glassSideGeo, pos: [-spec.innerX, WALL_H / 2, (spec.frontGlassZ - spec.innerZ) / 2], rotY: Math.PI / 2 },
  ];
  for (const d of glassDefs) {
    const gl = new Mesh(d.geo, glassMat);
    gl.position.set(...d.pos);
    gl.rotation.y = d.rotY;
    gl.renderOrder = 3;
    group.add(gl);
  }
  const sealMat = new MeshStandardMaterial({ color: 0x020403, roughness: 0.86, metalness: 0.18 });
  const slimSealMat = new MeshStandardMaterial({
    color: 0x020403,
    roughness: 0.86,
    metalness: 0.18,
    transparent: true,
    opacity: 0.66,
    depthWrite: false,
  });
  const glassZ = spec.frontGlassZ + 0.012;
  const backGlassZ = -spec.innerZ - 0.012;
  const sideGlassZ = (spec.frontGlassZ - spec.innerZ) / 2;
  for (const z of [glassZ, backGlassZ]) {
    addBox(group, [0.035, WALL_H - 0.26, 0.026], [-spec.innerX, WALL_H / 2, z], sealMat);
    addBox(group, [0.035, WALL_H - 0.26, 0.026], [spec.innerX, WALL_H / 2, z], sealMat);
    addBox(group, [spec.innerX * 2, 0.032, 0.026], [0, 0.19, z], sealMat);
    addBox(group, [spec.innerX * 2, 0.032, 0.026], [0, WALL_H - 0.19, z], sealMat);
  }
  for (const x of [-spec.innerX - 0.012, spec.innerX + 0.012]) {
    addBox(group, [0.026, WALL_H - 0.26, 0.035], [x, WALL_H / 2, sideGlassZ], sealMat);
    addBox(group, [0.026, 0.032, spec.innerZ * 2], [x, 0.19, sideGlassZ], sealMat);
    addBox(group, [0.026, 0.032, spec.innerZ * 2], [x, WALL_H - 0.19, sideGlassZ], sealMat);
  }
  const glassJointZ = spec.frontGlassZ + 0.024;
  addBox(group, [0.01, WALL_H - 0.38, 0.01], [0, WALL_H / 2, glassJointZ], slimSealMat);
  addBox(group, [0.09, 0.028, 0.026], [-0.07, 1.22, glassJointZ + 0.012], trimGold);
  addBox(group, [0.09, 0.028, 0.026], [0.07, 1.22, glassJointZ + 0.012], trimGold);

  const glassNotice = makeGlassSticker(tr('НЕ БИТЬ', 'DO NOT HIT'), tr('СТЕКЛО', 'GLASS'), 0.42, 0.14, '#ff3045');
  glassNotice.position.set(-0.84, 2.18, glassJointZ + 0.02);
  glassNotice.renderOrder = 6;
  group.add(glassNotice);
  const prizeNotice = makeGlassSticker(tr('ПРИЗ', 'PRIZE'), tr('ВНИЗУ', 'BELOW'), 0.34, 0.12, '#ffc247');
  prizeNotice.position.set(0.84, 0.42, glassJointZ + 0.02);
  prizeNotice.renderOrder = 6;
  group.add(prizeNotice);

  const warningTex = makeWarningTexture();
  warningTex.repeat.set(2.6, 1);
  const warningStripMat = new MeshBasicMaterial({
    map: warningTex,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    side: DoubleSide,
  });
  const warningStrip = addFrontPlane(group, 1.08, 0.07, -0.08, 0.28, glassJointZ + 0.018, warningStripMat);
  warningStrip.renderOrder = 5;

  const sideNotice = makeGlassSticker('67', tr('ВИТРИНА', 'DISPLAY'), 0.32, 0.11, '#38f5ff');
  sideNotice.rotation.y = -Math.PI / 2;
  sideNotice.position.set(spec.innerX + 0.022, 1.98, 0.36);
  sideNotice.renderOrder = 6;
  group.add(sideNotice);

  const interiorLedMat = new MeshStandardMaterial({
    color: 0xffefc2,
    emissive: 0xffd36b,
    emissiveIntensity: 1.15,
    roughness: 0.22,
    metalness: 0.16,
  });
  for (const x of [-0.7, 0, 0.7]) {
    addBox(group, [0.32, 0.018, 0.032], [x, WALL_H - 0.22, spec.frontGlassZ - 0.11], interiorLedMat);
  }
  const rearDepthMat = new MeshStandardMaterial({
    color: 0x0a1d1b,
    emissive: NEON_CYAN,
    emissiveIntensity: 0.32,
    roughness: 0.48,
    metalness: 0.18,
  });
  const floorDepthMat = new MeshStandardMaterial({
    color: 0x231707,
    emissive: NEON_AMBER,
    emissiveIntensity: 0.27,
    roughness: 0.52,
    metalness: 0.12,
  });

  // Задняя камера — многослойная штампованная панель за стеклом.
  const rearPanelZ = -spec.innerZ - 0.045;
  const rearPanelMat = new MeshStandardMaterial({
    color: 0x10231e, roughness: 0.62, metalness: 0.48,
  });
  const rearInsetMat = new MeshStandardMaterial({
    color: 0x06100d, roughness: 0.78, metalness: 0.28,
  });
  const rearFrame = addRoundedBox(
    group,
    [spec.innerX * 2 - 0.18, 1.56, 0.055],
    [0, 1.33, rearPanelZ],
    rearPanelMat,
    0.035,
    null,
    3
  );
  rearFrame.name = 'interiorRearStampedPanel';
  for (const x of [-0.59, 0.59]) {
    addRoundedBox(group, [0.94, 1.12, 0.028], [x, 1.34, rearPanelZ + 0.026], rearInsetMat, 0.026, null, 3);
    addBox(group, [0.035, 0.9, 0.018], [x - 0.22, 1.34, rearPanelZ + 0.047], rearPanelMat, [0, 0, x < 0 ? -0.44 : 0.44]);
    addBox(group, [0.035, 0.9, 0.018], [x + 0.22, 1.34, rearPanelZ + 0.047], rearPanelMat, [0, 0, x < 0 ? 0.44 : -0.44]);
  }
  addRoundedBox(group, [0.12, 1.28, 0.04], [0, 1.34, rearPanelZ + 0.035], blackPanel, 0.016);
  addRoundedBox(group, [spec.innerX * 2 - 0.38, 0.075, 0.045], [0, 1.12, rearPanelZ + 0.04], redTrim, 0.012);
  addRoundedBox(group, [spec.innerX * 2 - 0.44, 0.045, 0.045], [0, 1.93, rearPanelZ + 0.04], trimGold, 0.01);
  addRoundedBox(group, [spec.innerX * 2 - 0.44, 0.045, 0.045], [0, 0.72, rearPanelZ + 0.04], trimGold, 0.01);
  for (const x of [-1.02, 1.02]) {
    for (const y of [0.72, 1.93]) addFrontScrew(group, x, y, -spec.innerZ - 0.006, screwMat, 0.013);
  }
  const chamberPlate = makePlate(tr('СЕКТОР 67', 'SECTOR 67'), tr('ПРИЗОВОЕ ПОЛЕ', 'PRIZE FIELD'), 0.48, 0.13, '#38f5ff');
  chamberPlate.position.set(0, 1.68, -spec.innerZ - 0.004);
  chamberPlate.renderOrder = 3;
  group.add(chamberPlate);

  for (const x of [-0.82, 0.82]) {
    addRoundedBox(group, [0.085, 0.74, 0.035], [x, 1.35, -spec.innerZ + 0.018], rearInsetMat, 0.014);
    addRoundedBox(group, [0.026, 0.62, 0.022], [x, 1.35, -spec.innerZ + 0.045], rearDepthMat, 0.008);
  }
  for (const x of [-0.52, 0.52]) {
    addBox(group, [0.32, 0.012, 0.024], [x, 0.145, -spec.innerZ + 0.22], floorDepthMat);
  }
  const rearCoolLight = new PointLight(0x38f5ff, 0.34, 2.6, 2.0);
  rearCoolLight.position.set(0, 1.5, -spec.innerZ + 0.18);
  group.add(rearCoolLight);
  const lowAmberFill = new PointLight(0xffc247, 0.28, 2.2, 1.7);
  lowAmberFill.position.set(-0.15, 0.42, -0.18);
  group.add(lowAmberFill);
  // физика стен (продлеваем вниз — они же стенки шахты снаружи);
  // чуть внутрь визуального стекла, чтобы уши мишек не торчали наружу.
  // Стены — в группе 8: игрушки и голова клешни о них стукаются,
  // а пальцы клешни (mask 1) их не видят и не цепляются у стекла
  const wallHalf = (WALL_H + chuteDepth) / 2;
  const wallCy = (WALL_H + CHUTE_BOTTOM) / 2;
  // толстые стены наружу от туннелирования: внутренняя грань там же (1.31),
  // растём наружу от расчётных граней стекла: визуальная витрина и физика остаются согласованными
  const wallT = 0.15;            // полутолщина 0.15 → полная 0.30 вместо 0.10
  const wallX = spec.innerX + wallT;
  const wallFrontZ = spec.frontGlassZ + wallT;
  const wallBackZ = -spec.innerZ - wallT;
  const walls = [
    addStaticBox(world, physMat, 0, wallCy, wallFrontZ, INNER_X + 0.1, wallHalf, wallT),
    addStaticBox(world, physMat, 0, wallCy, wallBackZ, INNER_X + 0.1, wallHalf, wallT),
    addStaticBox(world, physMat, wallX, wallCy, (spec.frontGlassZ - spec.innerZ) / 2, wallT, wallHalf, (spec.frontGlassZ + spec.innerZ) / 2 + 0.1),
    addStaticBox(world, physMat, -wallX, wallCy, (spec.frontGlassZ - spec.innerZ) / 2, wallT, wallHalf, (spec.frontGlassZ + spec.innerZ) / 2 + 0.1),
  ];
  for (const w of walls) w.collisionFilterGroup = 8;

  // невидимый физический потолок: ловит вертикальные выбросы игрушек (хват в
  // движении подкидывает их выше стен, и они вываливаются через открытый верх).
  // group 32 (НЕ 8): голова клешни (mask 1|8) его не видит — иначе потолок бил
  // бы по голове и срывал приз; игрушки (mask -1) о него стукаются.
  const ceil = addStaticBox(world, physMat, 0, WALL_H - 0.05, 0, INNER_X + 0.15, 0.05, INNER_Z + 0.15);
  ceil.collisionFilterGroup = 32;

  // неон по низу шапки и верху тумбы
  for (const [y, color] of [[WALL_H + 0.02, NEON_RED], [0.03, NEON_AMBER]]) {
    for (const d of [[0, spec.frontGlassZ], [0, -spec.innerZ], [spec.innerX, 0], [-spec.innerX, 0]]) {
      const horiz = new Mesh(
        new BoxGeometry(d[0] === 0 ? spec.innerX * 2 + 0.12 : 0.03, 0.03, d[0] === 0 ? 0.03 : spec.innerZ * 2 + 0.12),
        neonMat(color, 2.2)
      );
      horiz.position.set(d[0] * 1, y, d[1] * 1);
      group.add(horiz);
    }
  }

  // свет внутри витрины
  const innerLight = new PointLight(0xffd28a, 1.75, 5, 1.6);
  innerLight.position.set(0, WALL_H - 0.3, 0);
  group.add(innerLight);

  const redCabinLight = new PointLight(NEON_RED, 0.85, 4.2, 1.8);
  redCabinLight.position.set(-spec.innerX + 0.2, WALL_H - 0.55, spec.frontGlassZ - 0.2);
  group.add(redCabinLight);

  return {
    dropPoint: new Vector3(holeCx, 0, holeCz),
    coinSlot: new Vector3(...deckPoint(coinX, coinLocalZ, 0.11)),
    holeMin: HOLE_MIN_X,
    holeMinX: HOLE_MIN_X,
    holeMinZ: HOLE_MIN_Z,
    delivery: {
      lidPivot,
      routeIn: new Vector3(deliveryX, deliveryY - 0.09, glassPlane - 0.06), // у окошка изнутри
      ejectPos: new Vector3(deliveryX, deliveryY - 0.09, deliveryZ + 0.3),   // снаружи проёма
      floorY: -BASE_H,
      lidClosed: 0,
      lidOpen: -1.35,
    },
    panelControls: {
      joystick,
      stickPivot,
      joyStick,
      joyKnob,
      redButton,
      buttonRing,
      coinAcceptor,
      coinGlow,
      creditLamps,
      readyLamp,
    },
  };
}
