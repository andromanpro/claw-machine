// Игрушки: процедурные плюшевые призы, без внешних моделей
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { settings } from './settings.js';
import {
  FUGITIVE_COUNT,
  animateFugitive,
  createFugitiveAI,
  createFugitiveTemplates,
  fugitiveSpawnPoints,
  markFugitiveCaptured,
  markFugitiveReleased,
  stepFugitiveMotion,
  thinkFugitive,
} from './fugitives.js';
import { prepareFugitiveModelFactory } from './fugitive-models.js';
import {
  makeButtonEyePair,
  makeCheekPair,
  makeSmile,
  makeStarPatch,
  makeStitchPath,
  plushCapsule,
  plushEllipsoid,
} from './plush-kit.js';

const PALETTE = [
  0xc9875d, 0xe2a3ae, 0x76a68f, 0x72a7b4,
  0xa58ac4, 0xdf7c61, 0xd7ad4d, 0xb88776,
];
const TOY_COUNT = 22;
const CHUTE_SPAWN_PAD = 0.46;
const TOY_GALLERY = typeof location !== 'undefined' && new URLSearchParams(location.search).has('toyGallery');
const NO_TOYS = typeof location !== 'undefined' && new URLSearchParams(location.search).has('noToys');
const TOY_VIEWER = typeof location !== 'undefined' && location.pathname.endsWith('/toy-viewer.html');
const PLUSH_DETAIL = TOY_GALLERY || (
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('plushDetail') === '1'
);
const PLUSH_SURFACE_DETAIL = PLUSH_DETAIL || TOY_VIEWER;
let fabricBump;
let prizeTagMaterial;
const napMatCache = new Map();
const fiberMatCache = new Map();

const pickColor = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];

function inChuteKeepout(dims, x, z) {
  return x > dims.HOLE_MIN_X - CHUTE_SPAWN_PAD && z > dims.HOLE_MIN_Z - CHUTE_SPAWN_PAD;
}

function makeGripProfile(tpl) {
  const src = tpl.grip ?? {};
  const radius = src.radius ?? tpl.r;
  return {
    radius,
    drop: src.drop ?? Math.max(0.2, radius * 0.78),
    forceMul: src.forceMul ?? 1,
    posK: src.posK,
    maxSpeed: src.maxSpeed,
    catchup: src.catchup,
    lateralSlack: src.lateralSlack,
    rotDamping: src.rotDamping,
    rotFollow: src.rotFollow,
    squish: src.squish ?? 0.035,
  };
}

// Материалы редких игрушек пульсируют синхронно из update(). Материал создаётся
// вместе с конкретным мишкой, чтобы сохранить фактуру ткани и attached nap.
const RARE_MATS = [];

function makeFabricBump() {
  if (fabricBump) return fabricBump;
  const c = document.createElement('canvas');
  c.width = 96; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const weave = ((x + y) % 7 === 0 || (x - y + 96) % 11 === 0) ? 22 : 0;
      const noise = Math.floor(Math.random() * 26) - 13;
      const v = MathUtils.clamp(128 + weave + noise, 0, 255);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  fabricBump = new CanvasTexture(c);
  fabricBump.wrapS = RepeatWrapping;
  fabricBump.wrapT = RepeatWrapping;
  fabricBump.repeat.set(3, 3);
  return fabricBump;
}

function furMat(color) {
  const warm = new Color(color).lerp(new Color(0xffe5bd), 0.07);
  const sheenColor = warm.clone().lerp(new Color(0xffffff), 0.32);
  const mat = new MeshPhysicalMaterial({
    color: warm, roughness: 0.96, metalness: 0,
    sheen: 0.82, sheenRoughness: 0.88, sheenColor,
    bumpMap: makeFabricBump(), bumpScale: 0.007,
  });
  mat.userData.plushSurface = true;
  mat.userData.plushColor = warm.getHex();
  return mat;
}
const darkMat = () => new MeshStandardMaterial({ color: 0x2a1d1b, roughness: 0.68 });
const creamMat = () => furMat(0xffe6c7);
const seamMat = () => new MeshStandardMaterial({ color: 0x5b4439, roughness: 0.96 });

function lighter(color, amount = 0.32) {
  return new Color(color).lerp(new Color(0xffffff), amount);
}

function colorHex(color) {
  return color instanceof Color ? color.getHex() : color;
}

function napShellMat(color, opacity) {
  const hex = colorHex(color);
  const key = `${hex}:${opacity}`;
  if (napMatCache.has(key)) return napMatCache.get(key);
  const mat = new MeshPhysicalMaterial({
    color: lighter(hex, 0.28),
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity,
    depthWrite: false,
    sheen: 1,
    sheenRoughness: 1,
    sheenColor: lighter(hex, 0.48),
    bumpMap: makeFabricBump(),
    bumpScale: 0.006,
  });
  mat.userData.plushAux = true;
  napMatCache.set(key, mat);
  return mat;
}

function fiberMat(color) {
  const hex = colorHex(color);
  if (fiberMatCache.has(hex)) return fiberMatCache.get(hex);
  const mat = new LineBasicMaterial({
    color: lighter(hex, 0.52),
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  fiberMatCache.set(hex, mat);
  return mat;
}

function addSurfaceFibers(mesh, color) {
  const geo = mesh.geometry;
  const pos = geo?.attributes?.position;
  if (!pos || pos.count < 24) return;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const normal = geo.attributes.normal;
  const count = Math.min(18, Math.max(6, Math.floor(pos.count / 12)));
  const step = Math.max(1, Math.floor(pos.count / count));
  const pts = [];

  for (let i = 0; i < pos.count && pts.length / 6 < count; i += step) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
    const jitter = ((i * 1103515245 + 12345) & 255) / 255;
    const len = 0.004 + jitter * 0.006;
    pts.push(px, py, pz, px + nx * len, py + ny * len, pz + nz * len);
  }

  const fibers = new LineSegments(new BufferGeometry(), fiberMat(color));
  fibers.geometry.setAttribute('position', new Float32BufferAttribute(pts, 3));
  fibers.name = 'plush-surface-fibers';
  fibers.userData.plushAux = true;
  fibers.frustumCulled = false;
  mesh.add(fibers);
}

function addAttachedNap(mesh) {
  if (!PLUSH_SURFACE_DETAIL) return;
  if (mesh.userData.plushNapApplied || mesh.userData.plushAux) return;
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!mat?.userData?.plushSurface) return;

  mesh.userData.plushNapApplied = true;
  const color = mat.userData.plushColor ?? mat.color?.getHex?.() ?? 0xf8fafc;
  for (const [scale, opacity] of [[1.008, 0.1], [1.016, 0.045]]) {
    const shell = new Mesh(mesh.geometry, napShellMat(color, opacity));
    shell.name = 'plush-nap-shell';
    shell.userData.plushAux = true;
    shell.scale.setScalar(scale);
    shell.castShadow = false;
    shell.receiveShadow = false;
    shell.frustumCulled = false;
    mesh.add(shell);
  }
  addSurfaceFibers(mesh, color);
}

function finishToy(g) {
  const plushMeshes = [];
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material?.userData?.plushSurface) plushMeshes.push(o);
    }
  });
  for (const mesh of plushMeshes) addAttachedNap(mesh);
  if (PLUSH_DETAIL) addPrizeTag(g);
  return g;
}

function simplifyToyDetails(g) {
  if (PLUSH_SURFACE_DETAIL) return;
  g.updateMatrixWorld(true);
  const tmp = new Box3();
  g.traverse((o) => {
    if (!o.isMesh || o.userData?.plushAux) return;
    if (!o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    tmp.copy(o.geometry.boundingBox);
    const s = tmp.getSize(new Vector3());
    const maxDim = Math.max(s.x * o.scale.x, s.y * o.scale.y, s.z * o.scale.z);
    const minDim = Math.min(s.x * o.scale.x, s.y * o.scale.y, s.z * o.scale.z);
    // порог мелочи был 0.065 — прятал ГЛАЗА и НОСЫ, в игре игрушки стояли
    // безликими пузырями; теперь прячем только настоящий микромусор
    const isPlaneDetail = minDim < 0.002 && maxDim < 0.05;
    const isMicroPart = maxDim < 0.012;
    if (isPlaneDetail || isMicroPart) {
      o.visible = false;
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
}

function prizeTagMat() {
  if (prizeTagMaterial) return prizeTagMaterial;
  const c = document.createElement('canvas');
  c.width = 192; c.height = 112;
  const g = c.getContext('2d');
  g.fillStyle = '#f6dca2';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#7f1d1d';
  g.fillRect(0, 0, c.width, 10);
  g.fillRect(0, c.height - 10, c.width, 10);
  g.strokeStyle = '#30140b';
  g.lineWidth = 8;
  g.strokeRect(10, 10, c.width - 20, c.height - 20);
  g.fillStyle = '#30140b';
  g.beginPath();
  g.arc(28, 26, 9, 0, Math.PI * 2);
  g.fill();
  g.font = '900 48px "Arial Narrow", "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#8f1d1f';
  g.fillText('67', c.width / 2 + 8, c.height / 2 + 2);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  prizeTagMaterial = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    side: DoubleSide,
  });
  return prizeTagMaterial;
}

function addPrizeTag(g, x = -0.145, y = -0.09, z = 0.155, scale = 1) {
  if (g.userData.prizeTagApplied) return;
  g.userData.prizeTagApplied = true;
  const tag = new Mesh(new PlaneGeometry(0.066 * scale, 0.038 * scale), prizeTagMat());
  tag.position.set(x * scale, y * scale, z * scale);
  tag.rotation.set(0.12, -0.18, -0.22);
  tag.castShadow = true;
  tag.receiveShadow = false;
  const thread = new Mesh(
    new CapsuleGeometry(0.0025 * scale, 0.042 * scale, 3, 6),
    seamMat()
  );
  thread.position.set((x + 0.016) * scale, (y + 0.032) * scale, (z - 0.01) * scale);
  thread.rotation.set(0.55, 0.1, -0.52);
  g.add(thread, tag);
}

// Подушечки лап отключены: плоские нашлёпки на фикс-координатах висели
// перед ступнями и торчали иглами с боков.
function addPawPads() { /* no-op */ }

// Швы-стежки отключены: цилиндрики ставились на фиксированных координатах и
// у большинства фигур висели в воздухе перед поверхностью (видно с профиля).
function addFaceStitch() { /* no-op */ }

// Усы отключены: линии пронзали голову насквозь (торчали из затылка сверху).
function addWhiskers() { /* no-op */ }

// Глаза-бусины с бликом. Кресты-«стежки» убраны: читались как заштопанные
// глаза мертвеца и вдобавок парили перед поверхностью.
function addButtonEyes(g, y, z, dx = 0.055, scale = 1) {
  const dark = darkMat();
  const glintMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
  const eyeGeo = new SphereGeometry(0.021 * scale, 12, 10);
  const glintGeo = new SphereGeometry(0.0065 * scale, 8, 6);
  for (const sx of [-1, 1]) {
    const eye = new Mesh(eyeGeo, dark);
    eye.position.set(sx * dx, y, z);
    const glint = new Mesh(glintGeo, glintMat);
    glint.position.set(sx * dx + 0.007 * scale, y + 0.008 * scale, z + 0.0165 * scale);
    g.add(eye, glint);
  }
}

// Румяна отключены: сплюснутые диски на фикс-координатах у половины фигур
// торчали ребром из щёк, как розовые иглы (видно сверху).
function addCheeks() { /* no-op */ }

// Зигзаг-швы на пузе отключены: та же болезнь — палочки в воздухе.
function addBellyStitches() { /* no-op */ }

function makeRibbon(color = 0xf472b6) {
  const g = new Group();
  const mat = new MeshStandardMaterial({ color, roughness: 0.78 });
  const knot = new Mesh(new SphereGeometry(0.028, 10, 8), mat);
  knot.scale.set(1.1, 0.8, 0.55);
  const wingGeo = new ConeGeometry(0.045, 0.07, 8); // 4-гранник читался пирамидками
  const left = new Mesh(wingGeo, mat);
  left.position.x = -0.05;
  left.rotation.z = -Math.PI / 2;
  left.rotation.y = 0.6;
  const right = new Mesh(wingGeo, mat);
  right.position.x = 0.05;
  right.rotation.z = Math.PI / 2;
  right.rotation.y = -0.6;
  g.add(knot, left, right);
  return g;
}

function makeBear(color, { variant = null } = {}) {
  const g = new Group();
  const fur = furMat(color), dark = darkMat(), belly = creamMat();
  const innerEar = new MeshStandardMaterial({ color: 0xd8a49b, roughness: 0.94 });
  const glint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.22 });
  const stitch = seamMat();

  const body = plushEllipsoid(fur, [0.18, 0.215, 0.15], [0, -0.075, 0], { name: 'bear-body' });
  const tummy = plushEllipsoid(belly, [0.105, 0.125, 0.026], [0, -0.085, 0.149], { detail: 'face' });
  const head = plushEllipsoid(fur, [0.15, 0.14, 0.135], [0, 0.19, 0.008], { name: 'bear-head' });
  const muzzle = plushEllipsoid(belly, [0.076, 0.052, 0.044], [0, 0.155, 0.132], { detail: 'face' });
  const nose = plushEllipsoid(dark, [0.024, 0.018, 0.014], [0, 0.172, 0.173], { detail: 'small' });

  const earL = plushEllipsoid(fur, [0.062, 0.064, 0.042], [-0.108, 0.31, -0.005], { detail: 'face' });
  const earR = plushEllipsoid(fur, [0.062, 0.064, 0.042], [0.108, 0.31, -0.005], { detail: 'face' });
  const earInL = plushEllipsoid(innerEar, [0.033, 0.037, 0.012], [-0.108, 0.31, 0.033], { detail: 'small' });
  const earInR = plushEllipsoid(innerEar, [0.033, 0.037, 0.012], [0.108, 0.31, 0.033], { detail: 'small' });

  const armL = plushCapsule(fur, 0.048, 0.085, [-0.17, -0.015, 0.025], [0.08, 0, 0.62]);
  const armR = plushCapsule(fur, 0.048, 0.085, [0.17, -0.015, 0.025], [0.08, 0, -0.62]);
  const legL = plushCapsule(fur, 0.052, 0.075, [-0.098, -0.245, 0.065], [-1.08, 0, -0.08], [1.05, 1, 1.08]);
  const legR = plushCapsule(fur, 0.052, 0.075, [0.098, -0.245, 0.065], [-1.08, 0, 0.08], [1.05, 1, 1.08]);
  const tail = plushEllipsoid(fur, [0.045, 0.045, 0.038], [0, -0.115, -0.145], { detail: 'small' });

  const eyes = makeButtonEyePair(dark, glint, { y: 0.222, z: 0.131, dx: 0.057, radius: 0.019 });
  const mouth = makeSmile(dark, { y: 0.143, z: 0.176, width: 0.027, drop: 0.016, radius: 0.0032 });
  const bellySeam = makeStitchPath(stitch, [
    [0.006, -0.17, 0.177], [-0.006, -0.11, 0.179], [0.004, -0.045, 0.177], [-0.004, 0.005, 0.17],
  ], { count: 5, radius: 0.0038, length: 0.017 });

  g.add(body, tummy, head, muzzle, nose, earL, earR, earInL, earInR,
    armL, armR, legL, legR, tail, eyes, mouth, bellySeam);

  // Редкость должна читаться по силуэту/аксессуарам, а не только по цвету.
  if (variant) {
    const rare = variant === 'rare';
    const accent = new MeshStandardMaterial({
      color: rare ? 0x991f2d : 0x67e8f9,
      roughness: 0.76,
      emissive: rare ? 0x4a090f : 0x164e63,
      emissiveIntensity: 0.16,
    });
    const ribbon = makeRibbon(rare ? 0x991f2d : 0x67e8f9);
    ribbon.scale.setScalar(rare ? 0.88 : 0.94);
    ribbon.position.set(0, 0.042, 0.148);
    const badge = makeStarPatch(accent, rare ? 0.029 : 0.032);
    badge.position.set(0.048, -0.093, 0.177);
    badge.rotation.z = rare ? -0.16 : 0.14;
    g.add(ribbon, badge);

    fur.emissive.setHex(rare ? 0x7c2d12 : 0x4c1d95);
    fur.emissiveIntensity = 0.24;
    RARE_MATS.push(fur);
  }
  return finishToy(g);
}

function makeBunny(color) {
  const g = new Group();
  const fur = furMat(color), dark = darkMat(), belly = creamMat();
  const pink = new MeshStandardMaterial({ color: 0xe894a7, roughness: 0.92 });
  const glint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.22 });
  const stitch = seamMat();

  const body = plushEllipsoid(fur, [0.158, 0.195, 0.14], [0, -0.09, 0]);
  const bellyPatch = plushEllipsoid(belly, [0.085, 0.115, 0.024], [0, -0.095, 0.139], { detail: 'face' });
  const head = plushEllipsoid(fur, [0.128, 0.122, 0.115], [0, 0.145, 0.012]);

  // Уши намеренно чуть асимметричны: силуэт остаётся узнаваемым даже в куче.
  const earL = plushCapsule(fur, 0.038, 0.17, [-0.066, 0.355, -0.012], [0.08, 0, 0.16], [1, 1.04, 0.82]);
  const earR = plushCapsule(fur, 0.038, 0.17, [0.075, 0.342, -0.006], [0.18, 0, -0.27], [1, 0.93, 0.82]);
  const inL = plushCapsule(pink, 0.017, 0.125, [-0.062, 0.358, 0.022], [0.08, 0, 0.16], [1, 1.03, 0.7]);
  const inR = plushCapsule(pink, 0.017, 0.112, [0.071, 0.345, 0.028], [0.18, 0, -0.27], [1, 0.95, 0.7]);

  const muzzleL = plushEllipsoid(belly, [0.048, 0.038, 0.035], [-0.034, 0.112, 0.111], { detail: 'face' });
  const muzzleR = plushEllipsoid(belly, [0.048, 0.038, 0.035], [0.034, 0.112, 0.111], { detail: 'face' });
  const nose = plushEllipsoid(pink, [0.017, 0.014, 0.012], [0, 0.132, 0.151], { detail: 'small' });
  const eyes = makeButtonEyePair(dark, glint, { y: 0.175, z: 0.119, dx: 0.052, radius: 0.018 });
  const mouth = makeSmile(dark, { y: 0.104, z: 0.152, width: 0.023, drop: 0.014, radius: 0.0028 });
  const tail = plushEllipsoid(belly, [0.058, 0.058, 0.05], [0, -0.115, -0.142], { detail: 'small' });
  const pawL = plushCapsule(fur, 0.044, 0.072, [-0.09, -0.247, 0.07], [-1.18, 0, -0.08], [1, 1, 1.06]);
  const pawR = plushCapsule(fur, 0.044, 0.072, [0.09, -0.247, 0.07], [-1.18, 0, 0.08], [1, 1, 1.06]);
  const armL = plushCapsule(fur, 0.04, 0.078, [-0.145, -0.025, 0.04], [0.12, 0, 0.58]);
  const armR = plushCapsule(fur, 0.04, 0.078, [0.145, -0.025, 0.04], [0.12, 0, -0.58]);

  const ribbon = makeRibbon(0xfde68a);
  ribbon.scale.setScalar(0.78);
  ribbon.position.set(0, 0.012, 0.142);
  const bellySeam = makeStitchPath(stitch, [
    [0, -0.17, 0.164], [0.007, -0.105, 0.168], [-0.004, -0.035, 0.162],
  ], { count: 4, radius: 0.0035, length: 0.015 });
  g.add(body, bellyPatch, head, earL, earR, inL, inR, muzzleL, muzzleR, nose,
    eyes, mouth, tail, pawL, pawR, armL, armR, ribbon, bellySeam);
  return finishToy(g);
}

function makeOcto(color) {
  const g = new Group();
  const skin = furMat(color);
  const white = new MeshStandardMaterial({ color: 0xfffbeb, roughness: 0.62 });
  const dark = darkMat();
  const glint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
  const cheek = new MeshStandardMaterial({ color: 0xe994b2, roughness: 0.86 });
  const stitch = seamMat();

  const head = plushEllipsoid(skin, [0.164, 0.18, 0.152], [0, 0.045, 0]);
  const skirt = plushEllipsoid(skin, [0.17, 0.07, 0.16], [0, -0.095, 0], { detail: 'face' });
  const eyeWL = plushEllipsoid(white, [0.047, 0.052, 0.025], [-0.057, 0.085, 0.139], { detail: 'face' });
  const eyeWR = plushEllipsoid(white, [0.047, 0.052, 0.025], [0.057, 0.085, 0.139], { detail: 'face' });
  const pupilL = plushEllipsoid(dark, [0.021, 0.027, 0.014], [-0.056, 0.082, 0.165], { detail: 'small' });
  const pupilR = plushEllipsoid(dark, [0.021, 0.027, 0.014], [0.056, 0.082, 0.165], { detail: 'small' });
  const shineL = plushEllipsoid(glint, [0.006, 0.007, 0.004], [-0.05, 0.093, 0.179], { detail: 'small' });
  const shineR = plushEllipsoid(glint, [0.006, 0.007, 0.004], [0.062, 0.093, 0.179], { detail: 'small' });
  const cheeks = makeCheekPair(cheek, { y: 0.025, z: 0.118, dx: 0.11, scale: 0.85 });
  const mouth = makeSmile(dark, { y: 0.024, z: 0.154, width: 0.025, drop: 0.015, radius: 0.003 });
  const crownSeam = makeStitchPath(stitch, [
    [0.005, 0.205, 0.055], [-0.004, 0.16, 0.122], [0.004, 0.12, 0.153],
  ], { count: 3, radius: 0.0035, length: 0.014 });
  g.add(head, skirt, eyeWL, eyeWR, pupilL, pupilR, shineL, shineR, cheeks, mouth, crownSeam);

  // Восемь коротких лучей читаются вокруг купола со всех сторон и не прячутся
  // целиком под телом, когда игрушка лежит боком.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const leg = plushCapsule(
      skin,
      0.031,
      0.115,
      [Math.cos(a) * 0.122, -0.145, Math.sin(a) * 0.122],
      [Math.sin(a) * 0.72, 0, -Math.cos(a) * 0.72],
      [1, i % 2 === 0 ? 1.04 : 0.92, 1]
    );
    const tip = plushEllipsoid(
      skin,
      [0.04, 0.031, 0.04],
      [Math.cos(a) * 0.168, -0.176, Math.sin(a) * 0.168],
      { detail: 'small' }
    );
    g.add(leg, tip);
  }
  return finishToy(g);
}

function makeBall(color) {
  const g = new Group();
  const base = furMat(color);
  const cream = furMat(0xf8ecd3);
  const seam = seamMat();
  const gold = new MeshStandardMaterial({ color: 0xe0a82e, roughness: 0.78 });
  const ball = plushEllipsoid(base, [0.17, 0.17, 0.17]);

  // Три мягких канта делят шар на панели и остаются видимыми при любом повороте.
  const ringGeo = new TorusGeometry(0.163, 0.014, 8, 32);
  const ringA = new Mesh(ringGeo, cream);
  const ringB = new Mesh(ringGeo, cream); ringB.rotation.x = Math.PI / 2;
  const ringC = new Mesh(ringGeo, seam); ringC.rotation.y = Math.PI / 2;
  const frontPatch = plushEllipsoid(cream, [0.065, 0.065, 0.012], [0, 0, 0.166], { detail: 'face' });
  const star = makeStarPatch(gold, 0.041);
  star.position.set(0, 0, 0.179);
  const backPatch = plushEllipsoid(cream, [0.048, 0.048, 0.01], [0, 0, -0.166], { detail: 'face' });
  const topPatch = plushEllipsoid(gold, [0.045, 0.045, 0.01], [0, 0.166, 0], {
    detail: 'face', rotation: [Math.PI / 2, 0, 0],
  });
  const bottomPatch = plushEllipsoid(cream, [0.04, 0.04, 0.01], [0, -0.166, 0], {
    detail: 'face', rotation: [Math.PI / 2, 0, 0],
  });
  const sidePatchL = plushEllipsoid(gold, [0.042, 0.042, 0.01], [-0.166, 0, 0], {
    detail: 'face', rotation: [0, Math.PI / 2, 0],
  });
  const sidePatchR = plushEllipsoid(cream, [0.042, 0.042, 0.01], [0.166, 0, 0], {
    detail: 'face', rotation: [0, Math.PI / 2, 0],
  });
  g.add(ball, ringA, ringB, ringC, frontPatch, star, backPatch,
    topPatch, bottomPatch, sidePatchL, sidePatchR);
  return finishToy(g);
}

function makeCat(color, withTail = true) {
  const g = new Group();
  const fur = furMat(color), cream = creamMat(), dark = darkMat();
  const pink = new MeshStandardMaterial({ color: 0xdc879e, roughness: 0.9 });
  const glint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.22 });
  const stitch = seamMat();

  const body = plushEllipsoid(fur, [0.157, 0.195, 0.137], [0, -0.09, 0]);
  const belly = plushEllipsoid(cream, [0.082, 0.112, 0.022], [0, -0.09, 0.136], { detail: 'face' });
  const head = plushEllipsoid(fur, [0.137, 0.126, 0.122], [0, 0.145, 0.01]);
  const earGeo = new ConeGeometry(0.061, 0.12, 5);
  const earL = new Mesh(earGeo, fur); earL.position.set(-0.083, 0.275, 0.005); earL.rotation.z = 0.2;
  const earR = new Mesh(earGeo, fur); earR.position.set(0.083, 0.275, 0.005); earR.rotation.z = -0.2;
  const innerEarGeo = new ConeGeometry(0.032, 0.068, 5);
  const innerL = new Mesh(innerEarGeo, pink); innerL.position.set(-0.082, 0.279, 0.044); innerL.rotation.z = 0.2;
  const innerR = new Mesh(innerEarGeo, pink); innerR.position.set(0.082, 0.279, 0.044); innerR.rotation.z = -0.2;

  const muzzleL = plushEllipsoid(cream, [0.052, 0.038, 0.034], [-0.032, 0.112, 0.112], { detail: 'face' });
  const muzzleR = plushEllipsoid(cream, [0.052, 0.038, 0.034], [0.032, 0.112, 0.112], { detail: 'face' });
  const nose = plushEllipsoid(pink, [0.016, 0.013, 0.011], [0, 0.132, 0.151], { detail: 'small' });
  const eyes = makeButtonEyePair(dark, glint, { y: 0.18, z: 0.123, dx: 0.054, radius: 0.018 });
  const cheeks = makeCheekPair(pink, { y: 0.087, z: 0.142, dx: 0.087, scale: 0.72 });
  const mouth = makeSmile(dark, { y: 0.104, z: 0.153, width: 0.024, drop: 0.015, radius: 0.0028 });
  const armL = plushCapsule(fur, 0.039, 0.078, [-0.143, -0.025, 0.035], [0.08, 0, 0.58]);
  const armR = plushCapsule(fur, 0.039, 0.078, [0.143, -0.025, 0.035], [0.08, 0, -0.58]);
  const footL = plushCapsule(fur, 0.043, 0.066, [-0.084, -0.238, 0.066], [-1.16, 0, -0.08]);
  const footR = plushCapsule(fur, 0.043, 0.066, [0.084, -0.238, 0.066], [-1.16, 0, 0.08]);

  const ribbon = makeRibbon(0xf9a8d4);
  ribbon.scale.setScalar(0.72);
  ribbon.position.set(0, 0.015, 0.143);
  const bellySeam = makeStitchPath(stitch, [
    [0, -0.165, 0.158], [0.006, -0.105, 0.16], [-0.004, -0.045, 0.157],
  ], { count: 4, radius: 0.0034, length: 0.015 });
  g.add(body, belly, head, earL, earR, innerL, innerR, muzzleL, muzzleR, nose,
    eyes, cheeks, mouth, armL, armR, footL, footR, ribbon, bellySeam);
  if (withTail) {
    const tailRoot = plushCapsule(fur, 0.035, 0.12, [0.11, -0.13, -0.11], [-0.55, 0.15, -0.72], [1.05, 1, 1]);
    const tailTip = plushCapsule(fur, 0.032, 0.1, [0.168, -0.035, -0.13], [-0.28, 0.1, -0.38], [1, 1, 1]);
    g.add(tailRoot, tailTip);
  }
  return finishToy(g);
}

function makePuppy(color) {
  const g = new Group();
  const fur = furMat(color), cream = creamMat(), dark = darkMat();
  const earColor = new Color(color).offsetHSL(0, 0.04, -0.14).getHex();
  const earMat = furMat(earColor);
  const collar = new MeshStandardMaterial({ color: 0x38b8c9, roughness: 0.68 });
  const tagMat = new MeshStandardMaterial({ color: 0xe5a928, roughness: 0.5, metalness: 0.28 });
  const glint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.22 });
  const stitch = seamMat();

  const body = plushEllipsoid(fur, [0.177, 0.185, 0.145], [0, -0.095, 0]);
  const belly = plushEllipsoid(cream, [0.088, 0.105, 0.023], [0, -0.095, 0.144], { detail: 'face' });
  const head = plushEllipsoid(fur, [0.14, 0.13, 0.126], [0, 0.142, 0.008]);
  const earL = plushCapsule(earMat, 0.042, 0.125, [-0.112, 0.13, 0.005], [0.18, 0.05, 0.48], [1.05, 1, 0.78]);
  const earR = plushCapsule(earMat, 0.042, 0.125, [0.112, 0.13, 0.005], [0.18, -0.05, -0.48], [1.05, 1, 0.78]);
  const muzzle = plushEllipsoid(cream, [0.076, 0.052, 0.045], [0, 0.098, 0.128], { detail: 'face' });
  const nose = plushEllipsoid(dark, [0.024, 0.018, 0.014], [0, 0.12, 0.171], { detail: 'small' });
  const eyePatch = plushEllipsoid(earMat, [0.048, 0.052, 0.017], [-0.052, 0.177, 0.121], {
    detail: 'face', rotation: [0, 0, -0.18],
  });
  const eyes = makeButtonEyePair(dark, glint, { y: 0.177, z: 0.139, dx: 0.052, radius: 0.018 });
  const mouth = makeSmile(dark, { y: 0.088, z: 0.171, width: 0.028, drop: 0.014, radius: 0.003 });

  const pawL = plushCapsule(cream, 0.045, 0.068, [-0.095, -0.235, 0.067], [-1.16, 0, -0.08]);
  const pawR = plushCapsule(cream, 0.045, 0.068, [0.095, -0.235, 0.067], [-1.16, 0, 0.08]);
  const armL = plushCapsule(fur, 0.041, 0.078, [-0.155, -0.03, 0.03], [0.08, 0, 0.55]);
  const armR = plushCapsule(fur, 0.041, 0.078, [0.155, -0.03, 0.03], [0.08, 0, -0.55]);
  const tail = plushCapsule(fur, 0.033, 0.095, [0.105, -0.115, -0.13], [-0.65, 0, -0.52]);
  const collarRing = new Mesh(new TorusGeometry(0.108, 0.011, 7, 26), collar);
  collarRing.position.set(0, 0.025, 0.018);
  const tag = plushEllipsoid(tagMat, [0.023, 0.028, 0.009], [0, -0.002, 0.149], { detail: 'small' });
  const bellySeam = makeStitchPath(stitch, [
    [0, -0.16, 0.166], [0.006, -0.1, 0.169], [-0.004, -0.04, 0.164],
  ], { count: 4, radius: 0.0034, length: 0.015 });
  g.add(body, belly, head, earL, earR, muzzle, nose, eyePatch, eyes, mouth,
    pawL, pawR, armL, armR, tail, collarRing, tag, bellySeam);
  return finishToy(g);
}

function makePanda() {
  const g = new Group();
  const white = furMat(0xf8fafc), black = furMat(0x1f2937), cream = creamMat();
  const dark = darkMat();
  const glint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
  const cheek = new MeshStandardMaterial({ color: 0xe99aac, roughness: 0.88 });
  const stitch = seamMat();

  const body = plushEllipsoid(white, [0.18, 0.215, 0.15], [0, -0.075, 0]);
  const belly = plushEllipsoid(cream, [0.105, 0.125, 0.024], [0, -0.085, 0.149], { detail: 'face' });
  const head = plushEllipsoid(white, [0.148, 0.138, 0.132], [0, 0.19, 0.008]);
  const earL = plushEllipsoid(black, [0.058, 0.06, 0.043], [-0.105, 0.31, -0.006], { detail: 'face' });
  const earR = plushEllipsoid(black, [0.058, 0.06, 0.043], [0.105, 0.31, -0.006], { detail: 'face' });

  const patchL = plushEllipsoid(black, [0.051, 0.043, 0.018], [-0.055, 0.215, 0.126], {
    detail: 'face', rotation: [0, 0, -0.28],
  });
  const patchR = plushEllipsoid(black, [0.051, 0.043, 0.018], [0.055, 0.215, 0.126], {
    detail: 'face', rotation: [0, 0, 0.28],
  });
  const muzzleL = plushEllipsoid(cream, [0.052, 0.04, 0.034], [-0.03, 0.157, 0.126], { detail: 'face' });
  const muzzleR = plushEllipsoid(cream, [0.052, 0.04, 0.034], [0.03, 0.157, 0.126], { detail: 'face' });
  const nose = plushEllipsoid(dark, [0.021, 0.016, 0.013], [0, 0.174, 0.166], { detail: 'small' });
  const eyes = makeButtonEyePair(dark, glint, { y: 0.216, z: 0.145, dx: 0.055, radius: 0.016 });
  const cheeks = makeCheekPair(cheek, { y: 0.145, z: 0.153, dx: 0.092, scale: 0.72 });
  const mouth = makeSmile(dark, { y: 0.145, z: 0.166, width: 0.024, drop: 0.014, radius: 0.0028 });

  const armL = plushCapsule(black, 0.047, 0.09, [-0.17, -0.015, 0.025], [0.08, 0, 0.58]);
  const armR = plushCapsule(black, 0.047, 0.09, [0.17, -0.015, 0.025], [0.08, 0, -0.58]);
  const footL = plushCapsule(black, 0.051, 0.075, [-0.098, -0.245, 0.065], [-1.1, 0, -0.08]);
  const footR = plushCapsule(black, 0.051, 0.075, [0.098, -0.245, 0.065], [-1.1, 0, 0.08]);
  const tail = plushEllipsoid(black, [0.048, 0.048, 0.04], [0, -0.12, -0.143], { detail: 'small' });
  const bellySeam = makeStitchPath(stitch, [
    [0, -0.17, 0.177], [0.006, -0.11, 0.179], [-0.004, -0.045, 0.176], [0.003, 0.005, 0.17],
  ], { count: 5, radius: 0.0036, length: 0.016 });
  g.add(body, belly, head, earL, earR, patchL, patchR, muzzleL, muzzleR, nose,
    eyes, cheeks, mouth, armL, armR, footL, footR, tail, bellySeam);
  return finishToy(g);
}

function makeKoala() {
  const g = new Group();
  const grey = furMat(0x94a3b8), cream = creamMat(), dark = darkMat();
  const innerEar = furMat(0xd7cec0);
  const glint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.22 });
  const cheek = new MeshStandardMaterial({ color: 0xd994a6, roughness: 0.9 });
  const stitch = seamMat();

  const body = plushEllipsoid(grey, [0.17, 0.2, 0.145], [0, -0.09, 0]);
  const belly = plushEllipsoid(cream, [0.09, 0.115, 0.023], [0, -0.09, 0.143], { detail: 'face' });
  const head = plushEllipsoid(grey, [0.146, 0.135, 0.13], [0, 0.17, 0.005]);
  const earL = plushEllipsoid(grey, [0.08, 0.087, 0.048], [-0.122, 0.245, -0.008], { detail: 'face' });
  const earR = plushEllipsoid(grey, [0.08, 0.087, 0.048], [0.122, 0.245, -0.008], { detail: 'face' });
  const inL = plushEllipsoid(innerEar, [0.048, 0.055, 0.015], [-0.123, 0.245, 0.035], { detail: 'small' });
  const inR = plushEllipsoid(innerEar, [0.048, 0.055, 0.015], [0.123, 0.245, 0.035], { detail: 'small' });
  const muzzle = plushEllipsoid(cream, [0.064, 0.046, 0.038], [0, 0.123, 0.13], { detail: 'face' });
  const nose = plushEllipsoid(dark, [0.033, 0.041, 0.018], [0, 0.153, 0.166], { detail: 'small' });
  const eyes = makeButtonEyePair(dark, glint, { y: 0.197, z: 0.133, dx: 0.054, radius: 0.017 });
  const cheeks = makeCheekPair(cheek, { y: 0.115, z: 0.103, dx: 0.083, scale: 0.7 });
  const mouth = makeSmile(dark, { y: 0.108, z: 0.166, width: 0.022, drop: 0.013, radius: 0.0028 });
  const armL = plushCapsule(grey, 0.042, 0.085, [-0.152, -0.025, 0.028], [0.08, 0, 0.55]);
  const armR = plushCapsule(grey, 0.042, 0.085, [0.152, -0.025, 0.028], [0.08, 0, -0.55]);
  const footL = plushCapsule(grey, 0.045, 0.068, [-0.088, -0.24, 0.064], [-1.15, 0, -0.08]);
  const footR = plushCapsule(grey, 0.045, 0.068, [0.088, -0.24, 0.064], [-1.15, 0, 0.08]);
  const tail = plushEllipsoid(grey, [0.042, 0.042, 0.035], [0, -0.125, -0.14], { detail: 'small' });
  const bellySeam = makeStitchPath(stitch, [
    [0, -0.165, 0.165], [0.006, -0.105, 0.168], [-0.004, -0.045, 0.163],
  ], { count: 4, radius: 0.0034, length: 0.015 });
  g.add(body, belly, head, earL, earR, inL, inR, muzzle, nose, eyes, cheeks, mouth,
    armL, armR, footL, footR, tail, bellySeam);
  return finishToy(g);
}

function makeElephant(color) {
  const g = new Group();
  const fur = furMat(color);
  const cream = creamMat();
  const dark = darkMat();
  const innerEar = furMat(lighter(color, 0.34));
  const cheekMat = new MeshStandardMaterial({ color: 0xe9a3a8, roughness: 0.92 });
  const glint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.22 });
  const stitch = seamMat();

  const body = plushEllipsoid(fur, [0.175, 0.205, 0.15], [0, -0.08, 0]);
  const belly = plushEllipsoid(cream, [0.095, 0.12, 0.024], [0, -0.07, 0.148], { detail: 'face' });
  const head = plushEllipsoid(fur, [0.15, 0.138, 0.135], [0, 0.165, 0.012]);

  // Большие мягкие уши формируют силуэт, внутренние вставки не выходят за края.
  const earL = plushEllipsoid(fur, [0.075, 0.105, 0.04], [-0.142, 0.17, 0.005], {
    detail: 'face', rotation: [0.02, -0.12, 0.18],
  });
  const earR = plushEllipsoid(fur, [0.075, 0.105, 0.04], [0.142, 0.17, 0.005], {
    detail: 'face', rotation: [0.02, 0.12, -0.18],
  });
  const innerL = plushEllipsoid(innerEar, [0.048, 0.073, 0.018], [-0.146, 0.17, 0.045], {
    detail: 'face', rotation: [0.02, -0.12, 0.18],
  });
  const innerR = plushEllipsoid(innerEar, [0.048, 0.073, 0.018], [0.146, 0.17, 0.045], {
    detail: 'face', rotation: [0.02, 0.12, -0.18],
  });

  const muzzle = plushEllipsoid(cream, [0.07, 0.048, 0.034], [0, 0.105, 0.132], { detail: 'face' });
  // Составной хобот мягко изгибается вниз и наружу вместо жёсткой прямой трубы.
  const trunkRoot = plushCapsule(fur, 0.029, 0.085, [0, 0.074, 0.166], [2.6, 0, 0]);
  const trunkTip = plushCapsule(fur, 0.024, 0.055, [0, 0.017, 0.205], [2.15, 0, 0]);
  const nostril = plushEllipsoid(dark, [0.009, 0.006, 0.004], [0, -0.014, 0.235], { detail: 'small' });
  const eyes = makeButtonEyePair(dark, glint, { y: 0.198, z: 0.138, dx: 0.055, radius: 0.017 });
  const cheeks = makeCheekPair(cheekMat, { y: 0.133, z: 0.123, dx: 0.086, scale: 0.78 });

  const armL = plushCapsule(fur, 0.043, 0.085, [-0.153, -0.02, 0.025], [0.08, 0, 0.58]);
  const armR = plushCapsule(fur, 0.043, 0.085, [0.153, -0.02, 0.025], [0.08, 0, -0.58]);
  const footL = plushCapsule(fur, 0.047, 0.068, [-0.09, -0.235, 0.06], [-1.14, 0, -0.08]);
  const footR = plushCapsule(fur, 0.047, 0.068, [0.09, -0.235, 0.06], [-1.14, 0, 0.08]);
  const tail = plushCapsule(fur, 0.018, 0.07, [0.09, -0.11, -0.14], [-0.25, 0.05, -0.7]);
  const tailTip = plushEllipsoid(innerEar, [0.026, 0.026, 0.022], [0.118, -0.055, -0.157], { detail: 'small' });
  const bellySeam = makeStitchPath(stitch, [
    [0, -0.145, 0.171], [0.006, -0.085, 0.173], [-0.004, -0.025, 0.168],
  ], { count: 4, radius: 0.0033, length: 0.015 });

  g.add(body, belly, head, earL, earR, innerL, innerR, muzzle, trunkRoot, trunkTip,
    nostril, eyes, cheeks, armL, armR, footL, footR, tail, tailTip, bellySeam);
  return finishToy(g);
}

function makeFoxPlush() {
  const g = new Group();
  const fur = furMat(0xe86f31), cream = creamMat(), dark = darkMat();
  const innerEar = new MeshStandardMaterial({ color: 0x5f2a24, roughness: 0.92 });
  const glint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.22 });
  const stitch = seamMat();

  const body = plushEllipsoid(fur, [0.165, 0.2, 0.14], [0, -0.085, 0]);
  const chest = plushEllipsoid(cream, [0.092, 0.13, 0.025], [0, -0.055, 0.139], { detail: 'face' });
  const head = plushEllipsoid(fur, [0.145, 0.132, 0.128], [0, 0.16, 0.01]);

  const earGeo = new ConeGeometry(0.067, 0.13, 5);
  const earL = new Mesh(earGeo, fur); earL.position.set(-0.085, 0.29, 0); earL.rotation.z = 0.18;
  const earR = new Mesh(earGeo, fur); earR.position.set(0.085, 0.29, 0); earR.rotation.z = -0.18;
  const innerGeo = new ConeGeometry(0.035, 0.075, 5);
  const innerL = new Mesh(innerGeo, innerEar); innerL.position.set(-0.084, 0.295, 0.045); innerL.rotation.z = 0.18;
  const innerR = new Mesh(innerGeo, innerEar); innerR.position.set(0.084, 0.295, 0.045); innerR.rotation.z = -0.18;

  const cheekL = plushEllipsoid(cream, [0.065, 0.047, 0.039], [-0.04, 0.115, 0.117], { detail: 'face' });
  const cheekR = plushEllipsoid(cream, [0.065, 0.047, 0.039], [0.04, 0.115, 0.117], { detail: 'face' });
  const snout = plushEllipsoid(cream, [0.048, 0.037, 0.05], [0, 0.105, 0.148], { detail: 'face' });
  const nose = plushEllipsoid(dark, [0.022, 0.017, 0.014], [0, 0.12, 0.194], { detail: 'small' });
  const eyes = makeButtonEyePair(dark, glint, { y: 0.19, z: 0.127, dx: 0.056, radius: 0.018 });
  const mouth = makeSmile(dark, { y: 0.087, z: 0.193, width: 0.024, drop: 0.014, radius: 0.003 });
  const armL = plushCapsule(fur, 0.042, 0.08, [-0.15, -0.025, 0.025], [0.06, 0, 0.58]);
  const armR = plushCapsule(fur, 0.042, 0.08, [0.15, -0.025, 0.025], [0.06, 0, -0.58]);
  const footL = plushCapsule(dark, 0.045, 0.065, [-0.088, -0.24, 0.065], [-1.12, 0, -0.08]);
  const footR = plushCapsule(dark, 0.045, 0.065, [0.088, -0.24, 0.065], [-1.12, 0, 0.08]);

  // Хвост — главный вторичный силуэт лисы. Он составной, с широким белым
  // кончиком и остаётся узнаваемым даже со спины.
  const tailRoot = plushCapsule(fur, 0.056, 0.16, [0.105, -0.12, -0.145], [-0.72, 0.1, -0.54], [1.12, 1, 1]);
  const tailTip = plushEllipsoid(cream, [0.065, 0.085, 0.055], [0.188, -0.005, -0.17], {
    detail: 'face', rotation: [-0.25, 0.2, -0.5],
  });
  const chestSeam = makeStitchPath(stitch, [
    [0, -0.15, 0.166], [0.006, -0.08, 0.169], [-0.004, -0.01, 0.16],
  ], { count: 4, radius: 0.0035, length: 0.016 });

  g.add(body, chest, head, earL, earR, innerL, innerR, cheekL, cheekR, snout, nose,
    eyes, mouth, armL, armR, footL, footR, tailRoot, tailTip, chestSeam);
  return finishToy(g);
}

function makePlushDuck() {
  const g = new Group();
  const yellow = furMat(0xe8b83f);
  const wingMat = furMat(0xd69b2f);
  const orange = new MeshStandardMaterial({ color: 0xe9672b, roughness: 0.9 });
  const cream = furMat(0xffe3a1);
  const dark = darkMat();
  const glint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.22 });
  const stitch = seamMat();

  const body = plushEllipsoid(yellow, [0.19, 0.155, 0.15], [0, -0.075, 0]);
  const bib = plushEllipsoid(cream, [0.095, 0.095, 0.023], [0, -0.055, 0.148], { detail: 'face' });
  const head = plushEllipsoid(yellow, [0.125, 0.12, 0.116], [0, 0.145, 0.025]);
  const beak = plushEllipsoid(orange, [0.072, 0.028, 0.047], [0, 0.118, 0.151], { detail: 'face' });
  const beakLine = new Mesh(new BoxGeometry(0.11, 0.004, 0.025), stitch);
  beakLine.position.set(0, 0.116, 0.189);

  const wingL = plushEllipsoid(wingMat, [0.055, 0.105, 0.035], [-0.16, -0.045, 0.01], {
    detail: 'face', rotation: [0.05, -0.18, 0.42],
  });
  const wingR = plushEllipsoid(wingMat, [0.055, 0.105, 0.035], [0.16, -0.045, 0.01], {
    detail: 'face', rotation: [0.05, 0.18, -0.42],
  });
  const tailL = plushEllipsoid(yellow, [0.052, 0.038, 0.075], [-0.035, -0.035, -0.145], {
    detail: 'small', rotation: [-0.48, 0, -0.25],
  });
  const tailR = plushEllipsoid(yellow, [0.052, 0.038, 0.075], [0.035, -0.035, -0.145], {
    detail: 'small', rotation: [-0.48, 0, 0.25],
  });
  const footL = plushEllipsoid(orange, [0.075, 0.026, 0.075], [-0.075, -0.225, 0.055], { detail: 'face' });
  const footR = plushEllipsoid(orange, [0.075, 0.026, 0.075], [0.075, -0.225, 0.055], { detail: 'face' });
  const eyes = makeButtonEyePair(dark, glint, { y: 0.176, z: 0.128, dx: 0.052, radius: 0.017 });

  const tuftL = plushCapsule(yellow, 0.014, 0.04, [-0.022, 0.27, 0.012], [0.12, 0, -0.36]);
  const tuftR = plushCapsule(yellow, 0.014, 0.035, [0.02, 0.268, 0.014], [0.12, 0, 0.42]);
  const bibSeam = makeStitchPath(stitch, [
    [0, -0.12, 0.171], [0.006, -0.06, 0.172], [-0.004, -0.005, 0.166],
  ], { count: 4, radius: 0.0032, length: 0.014 });
  g.add(body, bib, head, beak, beakLine, wingL, wingR, tailL, tailR,
    footL, footR, eyes, tuftL, tuftR, bibSeam);
  return finishToy(g);
}

function makeDino(color) {
  const g = new Group();
  const fur = furMat(color);
  const bellyMat = creamMat();
  const dark = darkMat();
  const spikeMat = furMat(0x76b89a);
  const cheekMat = new MeshStandardMaterial({ color: 0xe9a3a8, roughness: 0.92 });
  const glint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.22 });
  const stitch = seamMat();

  const body = plushEllipsoid(fur, [0.165, 0.215, 0.145], [0, -0.075, 0]);
  const belly = plushEllipsoid(bellyMat, [0.095, 0.135, 0.025], [0, -0.07, 0.143], { detail: 'face' });
  const head = plushEllipsoid(fur, [0.145, 0.128, 0.132], [0, 0.175, 0.012]);
  const snout = plushEllipsoid(bellyMat, [0.088, 0.052, 0.055], [0, 0.125, 0.137], { detail: 'face' });
  const eyes = makeButtonEyePair(dark, glint, { y: 0.21, z: 0.136, dx: 0.055, radius: 0.018 });
  const nostrilL = plushEllipsoid(dark, [0.008, 0.006, 0.004], [-0.025, 0.142, 0.188], { detail: 'small' });
  const nostrilR = plushEllipsoid(dark, [0.008, 0.006, 0.004], [0.025, 0.142, 0.188], { detail: 'small' });
  const cheeks = makeCheekPair(cheekMat, { y: 0.11, z: 0.181, dx: 0.076, scale: 0.72 });
  const mouth = makeSmile(dark, { y: 0.103, z: 0.19, width: 0.025, drop: 0.012, radius: 0.003 });

  // Круглые гребни читаются как набивные элементы, а не пластиковые шипы.
  const spikes = new Group();
  const spikeAt = [
    [0.285, -0.01, -0.18], [0.205, -0.09, -0.28], [0.105, -0.145, -0.34],
    [-0.01, -0.16, -0.38], [-0.125, -0.15, -0.42],
  ];
  for (const [sy, sz, rx] of spikeAt) {
    spikes.add(plushEllipsoid(spikeMat, [0.026, 0.048, 0.024], [0, sy, sz], {
      detail: 'small', rotation: [rx, 0, 0],
    }));
  }

  const armL = plushCapsule(fur, 0.037, 0.065, [-0.135, -0.01, 0.045], [0.12, 0, 0.62]);
  const armR = plushCapsule(fur, 0.037, 0.065, [0.135, -0.01, 0.045], [0.12, 0, -0.62]);
  const footL = plushCapsule(fur, 0.045, 0.065, [-0.085, -0.245, 0.055], [-1.12, 0, -0.08]);
  const footR = plushCapsule(fur, 0.045, 0.065, [0.085, -0.245, 0.055], [-1.12, 0, 0.08]);
  const tailRoot = plushCapsule(fur, 0.05, 0.13, [0, -0.155, -0.142], [-1.5, 0, 0], [1, 1, 0.92]);
  const tailTip = plushEllipsoid(fur, [0.043, 0.04, 0.072], [0, -0.16, -0.265], {
    detail: 'face', rotation: [-0.18, 0, 0],
  });
  const bellySeam = makeStitchPath(stitch, [
    [0, -0.155, 0.168], [0.006, -0.085, 0.17], [-0.004, -0.015, 0.161],
  ], { count: 4, radius: 0.0033, length: 0.015 });

  g.add(body, belly, head, snout, eyes, nostrilL, nostrilR, cheeks, mouth, spikes,
    armL, armR, footL, footR, tailRoot, tailTip, bellySeam);
  return finishToy(g);
}

function makePenguin() {
  const g = new Group();
  const black = furMat(0x334155);
  const white = creamMat();
  const orange = new MeshStandardMaterial({ color: 0xf0a52b, roughness: 0.88 });
  const dark = darkMat();
  const cheekMat = new MeshStandardMaterial({ color: 0xe9a3a8, roughness: 0.92 });
  const glint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.22 });
  const stitch = seamMat();

  const body = plushEllipsoid(black, [0.162, 0.21, 0.145], [0, -0.075, 0]);
  const belly = plushEllipsoid(white, [0.105, 0.14, 0.026], [0, -0.075, 0.143], { detail: 'face' });
  const head = plushEllipsoid(black, [0.145, 0.135, 0.13], [0, 0.16, 0.008]);
  // Две перекрывающиеся белые панели дают характерную сердцевидную маску.
  const faceL = plushEllipsoid(white, [0.075, 0.082, 0.026], [-0.038, 0.157, 0.129], {
    detail: 'face', rotation: [0, 0.04, -0.12],
  });
  const faceR = plushEllipsoid(white, [0.075, 0.082, 0.026], [0.038, 0.157, 0.129], {
    detail: 'face', rotation: [0, -0.04, 0.12],
  });
  const eyes = makeButtonEyePair(dark, glint, { y: 0.184, z: 0.153, dx: 0.049, radius: 0.016 });
  const beak = plushEllipsoid(orange, [0.055, 0.027, 0.04], [0, 0.117, 0.167], { detail: 'face' });
  const beakSeam = new Mesh(new BoxGeometry(0.077, 0.004, 0.018), stitch);
  beakSeam.position.set(0, 0.114, 0.202);
  const cheeks = makeCheekPair(cheekMat, { y: 0.135, z: 0.173, dx: 0.078, scale: 0.72 });

  const wingL = plushEllipsoid(black, [0.045, 0.115, 0.034], [-0.145, -0.035, 0.006], {
    detail: 'face', rotation: [0.08, -0.12, 0.48],
  });
  const wingR = plushEllipsoid(black, [0.045, 0.115, 0.034], [0.145, -0.035, 0.006], {
    detail: 'face', rotation: [0.08, 0.12, -0.48],
  });
  const footL = plushEllipsoid(orange, [0.072, 0.025, 0.07], [-0.073, -0.25, 0.052], { detail: 'face' });
  const footR = plushEllipsoid(orange, [0.072, 0.025, 0.07], [0.073, -0.25, 0.052], { detail: 'face' });
  const tuftL = plushCapsule(black, 0.012, 0.03, [-0.015, 0.29, 0.005], [0.12, 0, -0.38]);
  const tuftR = plushCapsule(black, 0.012, 0.028, [0.014, 0.288, 0.004], [0.12, 0, 0.42]);
  const bellySeam = makeStitchPath(stitch, [
    [0, -0.155, 0.169], [0.006, -0.09, 0.171], [-0.004, -0.025, 0.164],
  ], { count: 4, radius: 0.0032, length: 0.014 });

  g.add(body, belly, head, faceL, faceR, eyes, beak, beakSeam, cheeks,
    wingL, wingR, footL, footR, tuftL, tuftR, bellySeam);
  return finishToy(g);
}

function makeWhale(color) {
  const g = new Group();
  const fur = furMat(color);
  const bellyMat = creamMat();
  const dark = darkMat();
  const cheekMat = new MeshStandardMaterial({ color: 0xe9a3a8, roughness: 0.92 });
  const glint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.22 });
  const stitch = seamMat();

  // Горизонтальное тело оставляет китёнка отличимым от вертикальных зверей.
  const body = plushEllipsoid(fur, [0.225, 0.135, 0.15], [-0.015, -0.04, 0]);
  const belly = plushEllipsoid(bellyMat, [0.155, 0.067, 0.027], [-0.025, -0.095, 0.145], { detail: 'face' });
  const muzzle = plushEllipsoid(bellyMat, [0.12, 0.05, 0.03], [-0.015, -0.01, 0.147], { detail: 'face' });
  const eyes = makeButtonEyePair(dark, glint, { y: 0.048, z: 0.145, dx: 0.075, radius: 0.017 });
  const cheeks = makeCheekPair(cheekMat, { y: -0.005, z: 0.166, dx: 0.095, scale: 0.75 });
  const smile = makeSmile(dark, { y: -0.027, z: 0.181, width: 0.036, drop: 0.014, radius: 0.0032 });

  const finL = plushEllipsoid(fur, [0.04, 0.09, 0.03], [-0.155, -0.11, 0.025], {
    detail: 'face', rotation: [0.24, -0.2, -0.72],
  });
  const finR = plushEllipsoid(fur, [0.04, 0.09, 0.03], [0.105, -0.115, 0.018], {
    detail: 'face', rotation: [0.24, 0.2, 0.72],
  });
  const dorsal = plushEllipsoid(fur, [0.03, 0.062, 0.035], [-0.015, 0.108, -0.065], {
    detail: 'small', rotation: [-0.38, 0, 0.06],
  });

  // Хвост продолжается из правого края тела и заканчивается двумя мягкими лопастями.
  const tailRoot = plushCapsule(fur, 0.04, 0.085, [0.205, -0.045, -0.018], [0, 0, -1.48], [1, 1, 0.88]);
  const tailUpper = plushEllipsoid(fur, [0.07, 0.038, 0.034], [0.285, -0.005, -0.02], {
    detail: 'face', rotation: [0.12, 0.08, 0.52],
  });
  const tailLower = plushEllipsoid(fur, [0.07, 0.038, 0.034], [0.285, -0.085, -0.02], {
    detail: 'face', rotation: [-0.12, -0.08, -0.52],
  });
  const bellySeam = makeStitchPath(stitch, [
    [-0.105, -0.105, 0.173], [-0.035, -0.112, 0.176], [0.035, -0.105, 0.171],
  ], { count: 4, radius: 0.0032, length: 0.015 });

  g.add(body, belly, muzzle, eyes, cheeks, smile, finL, finR, dorsal,
    tailRoot, tailUpper, tailLower, bellySeam);
  return finishToy(g);
}

function makeStarPlush(color) {
  const g = new Group();
  const mat = furMat(color);
  const cream = creamMat();
  const dark = darkMat();
  const cheekMat = new MeshStandardMaterial({ color: 0xe9a3a8, roughness: 0.92 });
  const glint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.22 });
  const stitch = seamMat();

  // Цельная скруглённая оболочка даёт настоящий звёздный силуэт. Прежняя
  // композиция из пяти капсул выглядела как набор одинаковых полосок.
  const points = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 === 0 ? 0.205 : 0.094;
    points.push(new Vector2(Math.cos(a) * radius, Math.sin(a) * radius));
  }
  const starts = points.map((point, i) => point.clone().lerp(
    points[(i + points.length - 1) % points.length],
    i % 2 === 0 ? 0.16 : 0.12
  ));
  const ends = points.map((point, i) => point.clone().lerp(
    points[(i + 1) % points.length],
    i % 2 === 0 ? 0.16 : 0.12
  ));
  const shape = new Shape();
  shape.moveTo(starts[0].x, starts[0].y);
  for (let i = 0; i < points.length; i++) {
    shape.quadraticCurveTo(points[i].x, points[i].y, ends[i].x, ends[i].y);
    const nextStart = starts[(i + 1) % points.length];
    shape.lineTo(nextStart.x, nextStart.y);
  }
  shape.closePath();
  const depth = 0.056;
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments: 16,
    bevelEnabled: true,
    bevelSegments: 6,
    bevelSize: 0.012,
    bevelThickness: 0.018,
  });
  geometry.translate(0, 0, -depth / 2);
  const shell = new Mesh(geometry, mat);
  shell.name = 'star-shell';

  const face = plushEllipsoid(cream, [0.078, 0.064, 0.013], [0, -0.005, 0.047], { detail: 'face' });
  const eyes = makeButtonEyePair(dark, glint, { y: 0.012, z: 0.057, dx: 0.033, radius: 0.014 });
  const cheeks = makeCheekPair(cheekMat, { y: -0.012, z: 0.059, dx: 0.06, scale: 0.66 });
  const smile = makeSmile(dark, { y: -0.024, z: 0.06, width: 0.021, drop: 0.012, radius: 0.0028 });
  const edgeSeam = makeStitchPath(stitch, [
    [-0.07, -0.068, 0.049], [-0.098, -0.096, 0.048], [-0.125, -0.118, 0.046],
  ], { count: 3, radius: 0.003, length: 0.014 });

  g.add(shell, face, eyes, cheeks, smile, edgeSeam);
  return finishToy(g);
}

function makeHeartPillow(color) {
  const g = new Group();
  const mat = furMat(color);
  const dark = darkMat();
  const cheekMat = new MeshStandardMaterial({ color: 0xf4a6b0, roughness: 0.92 });
  const patchMat = furMat(0xffd36f);
  const glint = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.22 });
  const stitch = seamMat();

  // Единая скруглённая оболочка заменяет композицию из сфер и конуса:
  // между долями и остриём больше не раскрываются щели.
  const shape = new Shape();
  shape.moveTo(0, -0.15);
  shape.bezierCurveTo(-0.03, -0.11, -0.15, -0.035, -0.15, 0.06);
  shape.bezierCurveTo(-0.15, 0.145, -0.06, 0.165, 0, 0.09);
  shape.bezierCurveTo(0.06, 0.165, 0.15, 0.145, 0.15, 0.06);
  shape.bezierCurveTo(0.15, -0.035, 0.03, -0.11, 0, -0.15);
  const depth = 0.06;
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments: 24,
    bevelEnabled: true,
    bevelSegments: 8,
    bevelSize: 0.026,
    bevelThickness: 0.032,
  });
  geometry.translate(0, 0, -depth / 2);
  const shell = new Mesh(geometry, mat);

  const eyes = makeButtonEyePair(dark, glint, { y: 0.035, z: 0.069, dx: 0.052, radius: 0.016 });
  const cheeks = makeCheekPair(cheekMat, { y: 0.003, z: 0.073, dx: 0.087, scale: 0.74 });
  const smile = makeSmile(dark, { y: -0.015, z: 0.074, width: 0.03, drop: 0.015, radius: 0.003 });
  const patch = makeStarPatch(patchMat, 0.028);
  patch.position.set(0.068, -0.047, 0.066);
  patch.rotation.z = -0.18;
  const edgeSeam = makeStitchPath(stitch, [
    [-0.098, 0.005, 0.066], [-0.09, -0.042, 0.066], [-0.062, -0.082, 0.064],
  ], { count: 4, radius: 0.003, length: 0.014 });

  g.add(shell, eyes, cheeks, smile, patch, edgeSeam);
  return finishToy(g);
}

function makeGem(color) {
  const g = new Group();
  const gem = new MeshStandardMaterial({
    color, roughness: 0.18, metalness: 0.12,
    emissive: color, emissiveIntensity: 0.08,
  });
  const core = new Mesh(new OctahedronGeometry(0.18, 0), gem);
  core.scale.set(0.95, 1.18, 0.95);
  core.rotation.y = Math.PI / 4;
  const shine = new Mesh(
    new TorusGeometry(0.135, 0.012, 8, 28),
    new MeshStandardMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.2 })
  );
  shine.position.y = 0.045;
  shine.rotation.x = Math.PI / 2;
  g.add(core, shine);
  return finishToy(g);
}

function makeRobot(color) {
  const g = new Group();
  const shell = new MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.35 });
  const trim = new MeshStandardMaterial({ color: 0xe5f6ff, roughness: 0.25, metalness: 0.55 });
  const dark = darkMat();
  const glow = new MeshStandardMaterial({
    color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 0.8, roughness: 0.25,
  });

  const body = new Mesh(new BoxGeometry(0.22, 0.22, 0.15), shell);
  body.position.y = -0.05;
  const head = new Mesh(new BoxGeometry(0.18, 0.14, 0.14), shell);
  head.position.y = 0.16;
  const face = new Mesh(new BoxGeometry(0.13, 0.07, 0.012), dark);
  face.position.set(0, 0.17, 0.077);
  const eyeGeo = new SphereGeometry(0.017, 8, 6);
  const eyeL = new Mesh(eyeGeo, glow); eyeL.position.set(-0.04, 0.178, 0.086);
  const eyeR = new Mesh(eyeGeo, glow); eyeR.position.set(0.04, 0.178, 0.086);
  const knob = new Mesh(new SphereGeometry(0.025, 10, 8), glow);
  knob.position.y = 0.265;
  const antenna = new Mesh(new CylinderGeometry(0.006, 0.006, 0.07, 8), trim);
  antenna.position.y = 0.23;
  const armGeo = new CapsuleGeometry(0.026, 0.12, 4, 8);
  const armL = new Mesh(armGeo, trim); armL.position.set(-0.145, -0.035, 0); armL.rotation.z = 0.25;
  const armR = new Mesh(armGeo, trim); armR.position.set(0.145, -0.035, 0); armR.rotation.z = -0.25;
  const footGeo = new BoxGeometry(0.075, 0.045, 0.12);
  const footL = new Mesh(footGeo, trim); footL.position.set(-0.06, -0.205, 0.015);
  const footR = new Mesh(footGeo, trim); footR.position.set(0.06, -0.205, 0.015);
  g.add(body, head, face, eyeL, eyeR, antenna, knob, armL, armR, footL, footR);
  return finishToy(g);
}

function makeCupcake(color) {
  const g = new Group();
  const cup = new MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.8 });
  const cream = new MeshStandardMaterial({ color, roughness: 0.65 });
  const cherry = new MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.35, emissive: 0x7f1d1d, emissiveIntensity: 0.25 });
  const wrapper = new Mesh(new CylinderGeometry(0.15, 0.12, 0.16, 18), cup);
  wrapper.position.y = -0.12;
  const top = new Mesh(new SphereGeometry(0.16, 18, 12), cream);
  top.scale.set(1, 0.58, 1);
  top.position.y = 0.005;
  const top2 = new Mesh(new SphereGeometry(0.115, 16, 10), cream);
  top2.scale.set(1, 0.65, 1);
  top2.position.y = 0.095;
  const dot = new Mesh(new SphereGeometry(0.035, 10, 8), cherry);
  dot.position.y = 0.18;
  const sprinkleGeo = new BoxGeometry(0.035, 0.007, 0.012);
  const sprinkleMats = [
    new MeshStandardMaterial({ color: 0x22d3ee, roughness: 0.45 }),
    new MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.45 }),
    new MeshStandardMaterial({ color: 0xf472b6, roughness: 0.45 }),
  ];
  for (let i = 0; i < 8; i++) {
    const s = new Mesh(sprinkleGeo, sprinkleMats[i % sprinkleMats.length]);
    const a = i * Math.PI * 0.25;
    s.position.set(Math.cos(a) * 0.09, 0.055 + (i % 2) * 0.025, Math.sin(a) * 0.055);
    s.rotation.set(0.4, a, 0.3);
    g.add(s);
  }
  g.add(wrapper, top, top2, dot);
  return finishToy(g);
}

function makeCandy(color) {
  const g = new Group();
  const wrap = new MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.08 });
  const paper = new MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.7 });
  const core = new Mesh(new CapsuleGeometry(0.095, 0.24, 8, 16), wrap);
  core.rotation.z = Math.PI / 2;
  const stripe = new Mesh(new TorusGeometry(0.096, 0.012, 8, 24), paper);
  stripe.rotation.y = Math.PI / 2;
  const coneGeo = new ConeGeometry(0.08, 0.11, 12);
  const left = new Mesh(coneGeo, paper);
  left.position.x = -0.22;
  left.rotation.z = Math.PI / 2;
  const right = new Mesh(coneGeo, paper);
  right.position.x = 0.22;
  right.rotation.z = -Math.PI / 2;
  g.add(core, stripe, left, right);
  return finishToy(g);
}

export class ToyManager {
  constructor(scene, world, physMat, onWin, delivery, physics, dimensions) {
    if (!physics) throw new Error('ToyManager requires a physics module');
    if (!dimensions) throw new Error('ToyManager requires cabinet dimensions');
    this.scene = scene;
    this.world = world;
    this.physMat = physMat;
    this.physics = physics;
    this.dims = dimensions;
    this.onWin = onWin;
    this.delivery = delivery ?? null;
    this.floorCount = 0;   // сколько призов лежит на полу зала
    this.lidT = 0;         // 0 закрыта … 1 открыта (сглаженная анимация)
    this.toys = [];
    this.templates = [];
    this.keepoutMoveCursor = 0;
    this.gameMode = settings.gameMode === 'fugitives' && !TOY_GALLERY && !TOY_VIEWER ? 'fugitives' : 'toys';
    this.threatProvider = null;
    this.fugitiveThinkT = 0;
    this.lastPanicEvent = -10;
    this.onFugitivePanic = null;
    this.onFugitiveCaptured = null;
  }

  setThreatProvider(provider) {
    this.threatProvider = typeof provider === 'function' ? provider : null;
  }

  onCaptured(toy) {
    if (!markFugitiveCaptured(toy)) return;
    this.onFugitiveCaptured?.(toy);
  }

  onReleased(toy, slipped) {
    markFugitiveReleased(toy, slipped);
  }

  // Запустить выкат приза: из шахты кинематически к лючку, потом наружу на пол.
  startDelivery(t) {
    if (!this.delivery) return false;
    const { Body } = this.physics;
    const baseScale = t.mesh.userData.baseScale;
    if (baseScale) t.mesh.scale.copy(baseScale);
    t.mesh.updateMatrixWorld(true);
    const size = new Box3().setFromObject(t.mesh).getSize(new Vector3());
    const maxVisualDimension = Math.max(size.x, size.y, size.z, 0.001);
    const exitScale = MathUtils.clamp(0.43 / maxVisualDimension, 0.48, 0.88);
    t.deliver = { phase: 'wait', pt: 0, from: null, launched: false, exitScale };
    t.chuteGuideT = 0;
    t.body.type = Body.KINEMATIC;
    t.body.collisionFilterMask = 0;    // сквозь корпус — ведём вручную
    t.body.velocity.set(0, 0, 0);
    t.body.angularVelocity.set(0, 0, 0);
    t.body.wakeUp();
    return true;
  }

  setDeliveryVisualScale(t, factor) {
    const baseScale = t.mesh.userData.baseScale;
    if (!baseScale) return;
    t.mesh.scale.copy(baseScale).multiplyScalar(factor);
  }

  // У реального приёмника горловина покатая: крупный плюш, упавший углом на
  // бортик, всё равно сползает внутрь. Физические коробки здесь плоские, поэтому
  // после короткой паузы мягко имитируем воронку — только для уже выигранного
  // prizeEligible-приза и только рядом с отверстием.
  guidePrizeToChute(t, dt) {
    const { INNER_X, INNER_Z, HOLE_MIN_X, HOLE_MIN_Z } = this.dims;
    const p = t.body.position;
    const radius = t.grip?.radius ?? t.r ?? 0.24;
    const margin = Math.max(0.18, radius * 0.78);
    const nearChute =
      p.x >= HOLE_MIN_X - margin && p.x <= INNER_X + 0.08 &&
      p.z >= HOLE_MIN_Z - margin && p.z <= INNER_Z + 0.08 &&
      p.y < 0.82;
    if (!nearChute) {
      t.chuteGuideT = 0;
      return;
    }

    t.chuteGuideT = (t.chuteGuideT ?? 0) + dt;
    if (t.chuteGuideT < 0.42) return;
    const holeCx = (HOLE_MIN_X + INNER_X) * 0.5;
    const holeCz = (HOLE_MIN_Z + INNER_Z) * 0.5;
    const k = Math.min(1, dt * 5.8);
    p.x = MathUtils.lerp(p.x, holeCx, k);
    p.z = MathUtils.lerp(p.z, holeCz, k);
    t.body.velocity.x *= 0.35;
    t.body.velocity.z *= 0.35;
    t.body.velocity.y = Math.min(t.body.velocity.y, -0.42);
    t.body.aabbNeedsUpdate = true;
    t.body.wakeUp();
  }

  // Прогон фаз доставки одной игрушки. Возврат true — игрушка вышла на пол.
  stepDelivery(t, dt) {
    const { Body } = this.physics;
    const d = t.deliver;
    const D = this.delivery;
    const p = t.body.position;
    d.pt += dt;
    if (d.phase === 'wait') {
      // «Упал приз» — немного лежит в приёмнике, затем сначала открываем лючок.
      if (d.pt > 0.7) { d.phase = 'open'; d.pt = 0; }
    } else if (d.phase === 'open') {
      // Не начинаем проводку, пока нижний край дверцы не ушёл с траектории.
      if (d.pt > 0.2 && this.lidT > 0.88) {
        d.phase = 'route';
        d.pt = 0;
        d.from = new Vector3(p.x, p.y, p.z);
      }
    } else if (d.phase === 'route') {
      // дуга: from → routeIn (подъём из шахты к окошку) → ejectPos (наружу)
      const k = Math.min(1, d.pt / 1.05);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // easeInOut
      if (e < 0.5) {
        const s = e / 0.5;
        p.x = MathUtils.lerp(d.from.x, D.routeIn.x, s);
        p.y = MathUtils.lerp(d.from.y, D.routeIn.y, s);
        p.z = MathUtils.lerp(d.from.z, D.routeIn.z, s);
      } else {
        const s = (e - 0.5) / 0.5;
        p.x = MathUtils.lerp(D.routeIn.x, D.ejectPos.x, s);
        p.y = MathUtils.lerp(D.routeIn.y, D.ejectPos.y, s);
        p.z = MathUtils.lerp(D.routeIn.z, D.ejectPos.z, s);
      }
      t.body.quaternion.setFromEuler(d.pt * 2.5, d.pt * 1.5, 0); // катится
      const shrink = MathUtils.smoothstep(k, 0.05, 0.36);
      this.setDeliveryVisualScale(t, MathUtils.lerp(1, d.exitScale, shrink));
      if (k >= 1) { d.phase = 'eject'; d.pt = 0; }
    } else if (d.phase === 'eject') {
      const restore = MathUtils.smoothstep(d.pt, 0.12, 0.46);
      this.setDeliveryVisualScale(t, MathUtils.lerp(d.exitScale, 1, restore));
      if (!d.launched) {
        // Вернуть динамику и вытолкнуть наружу-вниз на пол зала.
        t.body.type = Body.DYNAMIC;
        t.body.collisionFilterGroup = 1;
        t.body.collisionFilterMask = -1;
        t.body.updateMassProperties();
        t.body.velocity.set((Math.random() - 0.5) * 0.4, -0.3, 0.6); // мягко — ляжет у автомата
        t.body.angularVelocity.set(Math.random() * 1.5, Math.random() * 1.5, 0);
        if (t.ai) {
          // После выдачи персонаж снова встаёт на ноги и начинает отдельный
          // маршрут по полу. Стенд через 10 секунд подхватит его движение.
          t.ai.captured = false;
          t.ai.state = 'floor-run';
          t.ai.stateTime = 0;
          t.ai.target = null;
          t.ai.moveX = 0;
          t.ai.moveZ = 0;
          t.body.fixedRotation = true;
          t.body.quaternion.set(0, 0, 0, 1);
          t.body.angularVelocity.set(0, 0, 0);
          t.floorJourney = { phase: 'run', age: 0, target: null, retargetIn: 0 };
          t.body.updateMassProperties();
        }
        t.body.wakeUp(); // за время KINEMATIC-проводки тело уснуло — иначе висит в воздухе
        t.onFloor = true;
        t.autoStandAge = 0;
        this.floorCount++;
        d.launched = true;
      }
      // Держим дверцу открытой, пока приз гарантированно не уйдёт от её нижней кромки.
      if (d.pt > 0.55) {
        this.setDeliveryVisualScale(t, 1);
        t.deliver = null;
        return true;
      }
    }
    return false;
  }

  async init() {
    if (this.gameMode === 'fugitives') {
      let detailedFactory = null;
      try {
        detailedFactory = await prepareFugitiveModelFactory();
      } catch (error) {
        console.warn('[claw] detailed fugitives unavailable, using procedural fallback', error);
      }
      this.templates.push(...createFugitiveTemplates(detailedFactory));
      if (NO_TOYS) return;
      const points = fugitiveSpawnPoints(this.dims, FUGITIVE_COUNT);
      points.forEach((point, index) => {
        const template = this.templates[index % this.templates.length];
        this.spawnTemplate(template, point.x, (template.colliderR ?? template.r) + 0.025, point.z, {
          yaw: Math.random() * Math.PI * 2,
        });
      });
      return;
    }

    this.templates.push(
      { name: 'Мишка', palette: true, make: ({ color } = {}) => makeBear(color ?? pickColor()), r: 0.27, weight: 3, grip: { radius: 0.28, drop: 0.23 } },
      { name: 'Кролик', palette: true, make: ({ color } = {}) => makeBunny(color ?? pickColor()), r: 0.26, weight: 3, grip: { radius: 0.27, drop: 0.23 } },
      { name: 'Котик', palette: true, make: ({ color } = {}) => makeCat(color ?? pickColor()), r: 0.24, weight: 2.4, grip: { radius: 0.25, drop: 0.21 } },
      { name: 'Щенок', palette: true, make: ({ color } = {}) => makePuppy(color ?? pickColor()), r: 0.25, weight: 2.4, grip: { radius: 0.26, drop: 0.22 } },
      { name: 'Панда', make: () => makePanda(), r: 0.26, weight: 2.2, grip: { radius: 0.27, drop: 0.23 } },
      { name: 'Коала', make: () => makeKoala(), r: 0.25, weight: 2.1, grip: { radius: 0.26, drop: 0.22 } },
      { name: 'Слонёнок', palette: true, make: ({ color } = {}) => makeElephant(color ?? pickColor()), r: 0.26, weight: 2, grip: { radius: 0.27, drop: 0.23, forceMul: 0.95 } },
      { name: 'Лисёнок', make: () => makeFoxPlush(), r: 0.25, weight: 2.2, grip: { radius: 0.26, drop: 0.22 } },
      { name: 'Утёнок', make: () => makePlushDuck(), r: 0.23, weight: 2.1, grip: { radius: 0.24, drop: 0.2 } },
      { name: 'Динозаврик', palette: true, make: ({ color } = {}) => makeDino(color ?? pickColor()), r: 0.25, weight: 2.2, grip: { radius: 0.26, drop: 0.22 } },
      { name: 'Пингвин', make: () => makePenguin(), r: 0.24, weight: 2, grip: { radius: 0.25, drop: 0.21 } },
      { name: 'Китёнок', palette: true, make: ({ color } = {}) => makeWhale(color ?? pickColor()), r: 0.22, box: [0.25, 0.16, 0.15], weight: 1.9, grip: { radius: 0.26, drop: 0.2, rotDamping: 10 } },
      { name: 'Осьминожка', palette: true, make: ({ color } = {}) => makeOcto(color ?? pickColor()), r: 0.21, weight: 2, grip: { radius: 0.22, drop: 0.2, squish: 0.045 } },
      { name: 'Мягкий мячик', palette: true, make: ({ color } = {}) => makeBall(color ?? pickColor()), r: 0.18, weight: 1.8, grip: { radius: 0.19, drop: 0.2, forceMul: 1.1, squish: 0.025 } },
      { name: 'Звёздочка', palette: true, make: ({ color } = {}) => makeStarPlush(color ?? pickColor()), r: 0.2, box: [0.2, 0.2, 0.09], weight: 1.6, grip: { radius: 0.23, drop: 0.2, rotDamping: 11 } },
      { name: 'Сердце-подушка', palette: true, make: ({ color } = {}) => makeHeartPillow(color ?? pickColor()), r: 0.2, box: [0.19, 0.18, 0.11], weight: 1.5, grip: { radius: 0.23, drop: 0.2, squish: 0.05 } },
    );
    // редкие: тяжелее и жирнее, шанс мал, светятся
    this.templates.push({
      name: 'Золотой мишка', rarity: 'rare', weight: 0.45, r: 0.27, massMul: 1.65,
      grip: { radius: 0.28, drop: 0.23, forceMul: 0.82, maxSpeed: 3.1 },
      make: () => makeBear(0xffc94a, { variant: 'rare' }),
    });
    this.templates.push({
      name: 'Гигантский мишка', rarity: 'epic', weight: TOY_GALLERY ? 0.35 : 0.04, r: 0.31, colliderR: 0.27, massMul: 1.5,
      grip: { radius: 0.32, drop: 0.25, forceMul: 0.78, maxSpeed: 3.0, catchup: 0.42, squish: 0.028 },
      make: () => {
        const b = makeBear(0xa78bfa, { variant: 'epic' });
        b.scale.setScalar(TOY_GALLERY ? 1.5 : 1.15);
        return b;
      },
    });

    if (TOY_GALLERY) {
      this.spawnGallery();
      return;
    }
    if (NO_TOYS) return;

    // насыпаем кучу — сеткой с джиттером, подальше от дыры
    const { INNER_X, INNER_Z, HOLE_MIN_X, HOLE_MIN_Z } = this.dims;
    const spots = [];
    const minX = -INNER_X + 0.16;
    const maxX = Math.min(INNER_X - 0.16, HOLE_MIN_X - CHUTE_SPAWN_PAD - 0.22);
    const minZ = -INNER_Z + 0.16;
    const maxZ = INNER_Z - 0.18;
    for (let x = minX; x <= maxX + 0.001; x += 0.33) {
      for (let z = minZ; z <= maxZ + 0.001; z += 0.3) {
        if (inChuteKeepout(this.dims, x, z)) continue; // зона дыры + радиус крупной игрушки
        spots.push([x, z]);
      }
    }
    for (let i = 0; i < TOY_COUNT; i++) {
      const [sx, sz] = spots[i % spots.length];
      const layer = Math.floor(i / spots.length);
      this.spawn(
        sx + (Math.random() - 0.5) * 0.12,
        0.34 + layer * 0.34 + Math.random() * 0.05,
        sz + (Math.random() - 0.5) * 0.12
      );
    }
  }

  pickTemplate() {
    const total = this.templates.reduce((s, t) => s + t.weight, 0);
    let roll = Math.random() * total;
    for (const t of this.templates) {
      roll -= t.weight;
      if (roll <= 0) return t;
    }
    return this.templates[0];
  }

  spawnTemplate(tpl, x, y, z, opts = {}) {
    const CANNON = this.physics;
    const variantColor = tpl.palette ? (opts.color ?? pickColor()) : null;
    const mesh = tpl.make({ color: variantColor });
    simplifyToyDetails(mesh);
    mesh.userData.baseScale = mesh.scale.clone();
    this.scene.add(mesh);
    const grip = makeGripProfile(tpl);
    const shape = tpl.box
      ? new CANNON.Box(new CANNON.Vec3(...tpl.box))
      : new CANNON.Sphere(tpl.colliderR ?? tpl.r);
    const body = new CANNON.Body({
      mass: opts.static ? 0 : (0.9 + Math.random() * 0.7) * (tpl.massMul ?? 1),
      shape,
      position: new CANNON.Vec3(x, y, z),
      material: this.physMat,
      angularDamping: 0.6,
      linearDamping: 0.15,
    });
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.4;
    body.sleepTimeLimit = 0.7;
    body.quaternion.setFromEuler(0, opts.yaw ?? Math.random() * Math.PI * 2, 0);
    if (tpl.fugitive && !opts.static) {
      body.fixedRotation = true;
      body.updateMassProperties();
    }
    this.world.addBody(body);
    const toy = {
      mesh, body, r: tpl.r, grip, name: tpl.name, rarity: tpl.rarity,
      variantColor, scored: false, scoredAt: 0, prizeEligible: false,
      kind: tpl.fugitive ? 'fugitive' : 'toy',
      ai: tpl.fugitive ? createFugitiveAI(tpl, Math.random()) : null,
    };
    this.toys.push(toy);
    return toy;
  }

  spawn(x, y, z) {
    return this.spawnTemplate(this.pickTemplate(), x, y, z);
  }

  spawnGallery() {
    const cols = 6;
    const sx = 0.43;
    const sz = 0.58;
    this.templates.forEach((tpl, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      this.spawnTemplate(tpl, (col - (cols - 1) / 2) * sx, 0.34 + (tpl.r - 0.18) * 0.4, (row - 1) * sz, {
        static: true,
        yaw: 0,
      });
    });
  }

  clearChuteKeepout() {
    const { INNER_X, INNER_Z, HOLE_MIN_X, HOLE_MIN_Z } = this.dims;
    const safeSpots = [];
    const safeMaxX = HOLE_MIN_X - CHUTE_SPAWN_PAD - 0.24;
    for (let x = -INNER_X + 0.22; x <= safeMaxX + 0.001; x += 0.34) {
      for (let z = -INNER_Z + 0.22; z <= INNER_Z - 0.22 + 0.001; z += 0.34) {
        safeSpots.push([x, z]);
      }
    }
    let moved = 0;
    for (const t of this.toys) {
      if (t.scored || !inChuteKeepout(this.dims, t.body.position.x, t.body.position.z)) continue;

      const spot = safeSpots[this.keepoutMoveCursor % safeSpots.length] ?? [-INNER_X + 0.3, -INNER_Z + 0.3];
      const layer = Math.floor(this.keepoutMoveCursor / Math.max(1, safeSpots.length));
      this.keepoutMoveCursor++;
      t.body.position.x = spot[0] + (Math.random() - 0.5) * 0.08;
      t.body.position.z = spot[1] + (Math.random() - 0.5) * 0.08;
      t.body.position.y = 0.42 + Math.min(2, layer) * 0.26 + t.r * 0.15;
      t.body.velocity.set(0, 0, 0);
      t.body.angularVelocity.set(0, 0, 0);
      t.body.wakeUp();
      t.mesh.position.copy(t.body.position);
      t.mesh.quaternion.copy(t.body.quaternion);
      moved++;
    }
    return moved;
  }

  // все игрушки в радиусе захвата, ближние первыми
  findGrabbableAll(point, maxHoriz = 0.45, maxVert = 0.6, limit = 3) {
    const found = [];
    for (const t of this.toys) {
      if (t.scored) continue;
      const dx = t.body.position.x - point.x;
      const dz = t.body.position.z - point.z;
      const dy = Math.abs(t.body.position.y - point.y);
      const dh = Math.hypot(dx, dz);
      if (dh < maxHoriz && dy < maxVert) found.push({ t, dh });
    }
    found.sort((a, b) => a.dh - b.dh);
    return found.slice(0, limit).map((f) => f.t);
  }

  update(dt, elapsed) {
    const { HOLE_MIN_X, HOLE_MIN_Z } = this.dims;
    // пульс подсветки редких
    const pulse = 0.3 + 0.25 * Math.sin(elapsed * 3.2);
    for (const m of RARE_MATS) m.emissiveIntensity = pulse;
    const now = performance.now() / 1000;
    this.fugitiveThinkT += dt;
    const thinkDt = this.fugitiveThinkT >= 0.1 ? this.fugitiveThinkT : 0;
    if (thinkDt) this.fugitiveThinkT = 0;
    const threat = this.threatProvider?.() ?? null;
    const fugitiveContext = {
      dims: this.dims,
      toys: this.toys,
      threat,
      elapsed,
      onPanic: (toy) => {
        if (elapsed - this.lastPanicEvent < 0.85) return;
        this.lastPanicEvent = elapsed;
        this.onFugitivePanic?.(toy);
      },
    };
    for (let i = this.toys.length - 1; i >= 0; i--) {
      const t = this.toys[i];
      if (t.ai) {
        if (thinkDt) thinkFugitive(t, fugitiveContext, thinkDt);
        stepFugitiveMotion(t, fugitiveContext, dt);

        const ai = t.ai;
        const previousX = ai.visualSampleX ?? t.body.position.x;
        const previousZ = ai.visualSampleZ ?? t.body.position.z;
        ai.visualMotionX = (ai.visualMotionX ?? 0) + (t.body.position.x - previousX);
        ai.visualMotionZ = (ai.visualMotionZ ?? 0) + (t.body.position.z - previousZ);
        ai.visualMotionAge = (ai.visualMotionAge ?? 0) + dt;
        ai.visualSampleX = t.body.position.x;
        ai.visualSampleZ = t.body.position.z;
        if (ai.visualMotionAge >= 0.09) {
          const distance = Math.hypot(ai.visualMotionX, ai.visualMotionZ);
          const divisor = Math.max(1 / 240, ai.visualMotionAge);
          ai.visualTargetX = distance < 0.004 ? 0 : MathUtils.clamp(ai.visualMotionX / divisor, -2.5, 2.5);
          ai.visualTargetZ = distance < 0.004 ? 0 : MathUtils.clamp(ai.visualMotionZ / divisor, -2.5, 2.5);
          ai.visualMotionX = 0;
          ai.visualMotionZ = 0;
          ai.visualMotionAge = 0;
        }
        const currentSpeed = Math.hypot(ai.visualMoveX ?? 0, ai.visualMoveZ ?? 0);
        const targetSpeed = Math.hypot(ai.visualTargetX ?? 0, ai.visualTargetZ ?? 0);
        const motionBlend = 1 - Math.exp(-dt * (targetSpeed > currentSpeed ? 7 : 4.5));
        ai.visualMoveX = MathUtils.lerp(ai.visualMoveX ?? 0, ai.visualTargetX ?? 0, motionBlend);
        ai.visualMoveZ = MathUtils.lerp(ai.visualMoveZ ?? 0, ai.visualTargetZ ?? 0, motionBlend);
      }
      t.mesh.position.copy(t.body.position);
      t.mesh.quaternion.copy(t.body.quaternion);
      if (t.ai) {
        animateFugitive(t, dt, elapsed);
      }

      // сброшенная клешнёй: вернуть коллизии с пальцами после вылета
      if (t.regroupAt && now > t.regroupAt) {
        t.body.collisionFilterGroup = t.restoreGroup ?? 1;
        t.restoreGroup = 0;
        t.regroupAt = 0;
      }

      // идёт выкат приза — ведём кинематически, обычную логику пропускаем
      if (t.deliver) {
        this.stepDelivery(t, dt);
        continue;
      }

      if (!t.scored && t.prizeEligible) this.guidePrizeToChute(t, dt);

      if (!t.scored && t.body.position.y < -0.5) {
        t.scored = true;
        t.scoredAt = elapsed;
        const inChute = t.body.position.x > HOLE_MIN_X - 0.1 && t.body.position.z > HOLE_MIN_Z - 0.1;
        if (inChute) {
          const trick = !t.prizeEligible;
          const accepted = this.onWin?.(t, { trick }) !== false;
          t.prizeEligible = false;
          // приз выкатывается наружу вместо исчезновения; в кучу — замена
          if (accepted && this.startDelivery(t)) {
            if (settings.refill) this.spawnRefill();
            continue;
          }
        }
        // мимо шахты (продавило сквозь пол) — не приз, тихо уберём
      }
      // промах: полежал под полом и не поехал на выдачу — убрать
      if (t.scored && !t.onFloor && elapsed - t.scoredAt > 2.2) {
        this.scene.remove(t.mesh);
        this.world.removeBody(t.body);
        this.toys.splice(i, 1);
      }
    }

    // Анимация крышки лючка: открываем до старта проводки и не закрываем,
    // пока вытолкнутый приз не очистит нижнюю кромку дверцы.
    if (this.delivery) {
      const wantOpen = this.toys.some((t) => t.deliver && ['open', 'route', 'eject'].includes(t.deliver.phase));
      this.lidT += ((wantOpen ? 1 : 0) - this.lidT) * Math.min(1, dt * 7);
      const D = this.delivery;
      D.lidPivot.rotation.x = MathUtils.lerp(D.lidClosed, D.lidOpen, this.lidT);
    }

    // кап призов на полу зала: старейшие уезжают, чтобы не копить бесконечно
    if (this.floorCount > 14) {
      for (let i = 0; i < this.toys.length && this.floorCount > 14; i++) {
        const t = this.toys[i];
        if (!t.onFloor || t.onStand) continue;
        this.scene.remove(t.mesh);
        this.world.removeBody(t.body);
        this.toys.splice(i, 1);
        this.floorCount--;
        i--;
      }
    }
  }

  spawnRefill() {
    const { INNER_X, INNER_Z, HOLE_MIN_X, HOLE_MIN_Z } = this.dims;
    if (this.gameMode === 'fugitives') {
      const [point] = fugitiveSpawnPoints(this.dims, 1);
      const template = this.pickTemplate();
      return this.spawnTemplate(template, point.x, (template.colliderR ?? template.r) + 0.03, point.z, {
        yaw: Math.random() * Math.PI * 2,
      });
    }
    const rx = -INNER_X + 0.18 + Math.random() * Math.max(0.2, INNER_X + HOLE_MIN_X - CHUTE_SPAWN_PAD - 0.1);
    const rz = -INNER_Z + 0.18 + Math.random() * Math.max(0.2, INNER_Z + HOLE_MIN_Z - CHUTE_SPAWN_PAD - 0.1);
    return this.spawn(rx, 2.3, rz);
  }
}

// Реестр построителей для инспектора игрушек (tools/toy-inspect.mjs).
// Цвета фиксированы — кадры воспроизводимы от прогона к прогону.
export const PREVIEW_BUILDERS = {
  'Мишка': () => makeBear(0xc89b6f),
  'Кролик': () => makeBunny(0xa8c9cf),
  'Котик': () => makeCat(0xf0d17a),
  'Щенок': () => makePuppy(0xc7b1df),
  'Панда': () => makePanda(),
  'Коала': () => makeKoala(),
  'Слонёнок': () => makeElephant(0xa8c9cf),
  'Лисёнок': () => makeFoxPlush(),
  'Утёнок': () => makePlushDuck(),
  'Динозаврик': () => makeDino(0x9fbea7),
  'Пингвин': () => makePenguin(),
  'Китёнок': () => makeWhale(0xa8c9cf),
  'Осьминожка': () => makeOcto(0xc7b1df),
  'Мягкий мячик': () => makeBall(0xe8a07a),
  'Звёздочка': () => makeStarPlush(0xf0d17a),
  'Сердце-подушка': () => makeHeartPillow(0xe8a07a),
  'Золотой мишка': () => makeBear(0xffc94a, { variant: 'rare' }),
  'Гигантский мишка': () => {
    const bear = makeBear(0xa78bfa, { variant: 'epic' });
    bear.scale.setScalar(1.5);
    return bear;
  },
};
