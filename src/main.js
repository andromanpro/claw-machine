// Bootstrap: рендер, физика, композиция модулей
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Clock,
  Color,
  DirectionalLight,
  Fog,
  MathUtils,
  PCFSoftShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildMachine, DIMS } from './machine.js';
import { ToyManager } from './toys.js';
import { Claw } from './claw.js';
import { CoinFX } from './coins.js';
import { PrizeDrag } from './prize-drag.js';
import { PrizeStand } from './prize-stand.js';
import { settings } from './settings.js';
import { applyDocumentLanguage, tr } from './i18n.js';
import { sfx } from './audio.js';
import { gamepadName, Calibration, vibrate } from './gamepad.js';
import * as ui from './ui.js';

applyDocumentLanguage();

// софтверный GL (SwiftShader/llvmpipe) не тянет bloom и тени — режем красоту.
// Ручной override: ?lite=1 / ?lite=0
function isSoftwareGL() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    console.info('[claw] GL renderer:', String(name));
    return /swiftshader|software|llvmpipe|basic/i.test(String(name));
  } catch { return false; }
}
const urlParams = new URLSearchParams(location.search);
const LITE = urlParams.has('lite') ? urlParams.get('lite') !== '0' : isSoftwareGL();
if (LITE) console.info('[claw] lite-режим: без bloom и теней');
const GFX = urlParams.get('gfx') ?? settings.graphics ?? 'quality';
const QUALITY = GFX === 'quality';
const BALANCED = GFX === 'balanced';
const SHADOWS = !LITE && (urlParams.has('shadows') ? urlParams.get('shadows') === '1' : QUALITY);
const BLOOM = !LITE && (urlParams.has('bloom') ? urlParams.get('bloom') === '1' : QUALITY);
const HIRES = !LITE && (urlParams.has('hires') ? urlParams.get('hires') === '1' : QUALITY);
// Белый фон оставлен только как служебный URL-флаг для визуальных аудитов.
// В пользовательских настройках его больше нет.
const WHITE_BG = urlParams.get('bg') === 'white';

// === рендер ===
const renderer = new WebGLRenderer({ antialias: !LITE && GFX !== 'fast' });
renderer.setSize(window.innerWidth, window.innerHeight);
const DPR = LITE ? 1 : Math.min(window.devicePixelRatio, HIRES ? 1.5 : BALANCED ? 1.15 : 1);
renderer.setPixelRatio(DPR);
renderer.shadowMap.enabled = SHADOWS;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(WHITE_BG ? 0xffffff : 0x050705);
scene.fog = WHITE_BG
  ? new Fog(0xffffff, 26, 60)
  : new Fog(0x050705, 8, 21);

const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.28; // тёмная комната, но металл и стекло сохраняют объём

// игровой ракурс и ракурс облёта
const PLAY_POS = new Vector3(3.0, 2.42, 6.05);
const PLAY_TGT = new Vector3(0, 1.02, 0.2);
const ORBIT_POS = new Vector3(3.25, 2.6, 6.1);
const ORBIT_TGT = new Vector3(0, 0.98, 0.16);
const STAND_POS = new Vector3(-1.0, 0.82, 6.85);
const STAND_TGT = new Vector3(-2.55, -0.52, 2.82);

const camera = new PerspectiveCamera(47, window.innerWidth / window.innerHeight, 0.2, 40);
camera.position.copy(ORBIT_POS);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(ORBIT_TGT);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2.5;
controls.maxDistance = 12;
controls.maxPolarAngle = 1.5;
controls.enablePan = false;
controls.autoRotate = true;        // attract: камера облетает автомат
controls.autoRotateSpeed = 0.22;

// свет
const sun = new DirectionalLight(0xffd6a3, 0.95);
sun.position.set(4, 6, 3);
sun.castShadow = SHADOWS;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -4; sun.shadow.camera.right = 4;
sun.shadow.camera.top = 5; sun.shadow.camera.bottom = -3;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.025;
scene.add(sun);
scene.add(new AmbientLight(0x3a241e, 0.52));

// Мягкое двухцветное заполнение без геометрии бликов на стекле.
const coolFill = new DirectionalLight(0xd8efff, 0.32);
coolFill.position.set(-4.2, 3.8, 4.6);
scene.add(coolFill);
const warmRim = new DirectionalLight(0xffc27a, 0.2);
warmRim.position.set(3.4, 2.7, -3.8);
scene.add(warmRim);

// bloom (только на железном GL)
let composer = null;
if (BLOOM) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    new Vector2(window.innerWidth, window.innerHeight), 0.36, 0.45, 1.05
  ));
  composer.addPass(new OutputPass());
}

// === физика ===
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.solver.iterations = 16; // верёвка + 6 шарниров пальцев хотят солвер пожирнее

const matStatic = new CANNON.Material('static');
const matToy = new CANNON.Material('toy');
world.addContactMaterial(new CANNON.ContactMaterial(matStatic, matToy, { friction: 0.5, restitution: 0.15 }));
world.addContactMaterial(new CANNON.ContactMaterial(matToy, matToy, { friction: 0.35, restitution: 0.2 }));

// === сборка ===
const { dropPoint, coinSlot, panelControls, delivery } = buildMachine(scene, world, matStatic);
const coins = new CoinFX(scene, coinSlot);
console.info('[claw] machine built');

let claw;
let mode = 'attract'; // 'attract' | 'play'
// приз считается только после хотя бы одной попытки — самокатов в лоток не оплачиваем
const toys = new ToyManager(scene, world, matToy, (toy, { trick = false } = {}) => {
  if (mode !== 'play' || claw?.tries <= 0) return false;
  claw.onPrizeWin(toy.name, toy.rarity, trick);
  beginPrizeMoment(toy);
  return true;
}, delivery, CANNON, DIMS);

await toys.init();
console.info('[claw] toys ready:', toys.toys.length);

// пре-осадка кучи, чтобы игрушки не сыпались на глазах у клиента
if (toys.toys.length > 0) {
  for (let i = 0; i < 420; i++) world.step(1 / 60);
  let movedFromChute = 0;
  for (let pass = 0; pass < 7; pass++) {
    const moved = toys.clearChuteKeepout();
    movedFromChute += moved;
    if (moved === 0) break;
    for (let i = 0; i < 180; i++) world.step(1 / 60);
  }
  const finalMovedFromChute = toys.clearChuteKeepout();
  movedFromChute += finalMovedFromChute;
  if (finalMovedFromChute > 0) {
    for (let i = 0; i < 240; i++) world.step(1 / 60);
  }
  console.info('[claw] pile settled', movedFromChute > 0 ? `(${movedFromChute} moved from chute)` : '');
}

claw = new Claw(scene, world, toys, dropPoint);
toys.setThreatProvider(() => ({
  x: claw.pos.x,
  z: claw.pos.y,
  y: claw.headBody.position.y,
  state: claw.state,
  enabled: mode === 'play' && claw.enabled,
  active: claw.state !== 0 || claw.vel.lengthSq() > 0.004,
}));
toys.onFugitivePanic = () => sfx.panic();
toys.onFugitiveCaptured = (toy) => {
  const variant = Math.max(0, toys.templates.findIndex((template) => template.name === toy.name));
  sfx.scream(variant);
};
const prizeStand = new PrizeStand({ scene, world, physMat: matStatic, floorY: delivery.floorY, toys });
prizeStand.setEnabled(settings.prizeStand);
const prizeDrag = new PrizeDrag({
  scene,
  world,
  camera,
  renderer,
  controls,
  toys,
  floorY: delivery.floorY,
  minZ: delivery.ejectPos.z + 0.04,
  stand: prizeStand,
});

// === монетки и режимы ===
let credits = 0;
let panelCoinPulse = 0;

function insertCoin() {
  panelCoinPulse = Math.max(panelCoinPulse, 0.28);
  sfx.init();
  coins.drop(() => {
    credits++;
    ui.setCredits(credits);
    ui.setStatus('coin');
    sfx.coin();
    vibrate('coin');
    coinNag = 0;
    panelCoinPulse = Math.max(panelCoinPulse, 0.75);
  });
}

// плавный перелёт камеры
let camAnim = null;
let prizeMoment = null;
let standFocus = null;
function flyTo(pos, tgt, dur = 1.2, then) {
  camAnim = {
    p0: camera.position.clone(), t0: controls.target.clone(),
    p1: pos, t1: tgt, t: 0, dur, then,
  };
  controls.enabled = false;
}

function currentPlayView() {
  if (camera.fov !== 47) {
    camera.fov = 47;
    camera.updateProjectionMatrix();
  }
  return [PLAY_POS.clone(), PLAY_TGT.clone()];
}

function clearStandFocusState() {
  standFocus = null;
  document.body.classList.remove('stand-focus');
}

function toggleStandFocus() {
  if (mode !== 'play' || prizeDrag.active || prizeMoment?.active) return;
  if (standFocus) {
    const { returnPos, returnTarget } = standFocus;
    clearStandFocusState();
    flyTo(returnPos, returnTarget, 0.78);
    return;
  }
  if (!prizeStand.enabled) return;
  standFocus = {
    returnPos: camera.position.clone(),
    returnTarget: controls.target.clone(),
  };
  document.body.classList.add('stand-focus');
  flyTo(STAND_POS.clone(), STAND_TGT.clone(), 0.82);
}

// === короткий победный ракурс у окна выдачи ===
const prizeMomentEl = document.getElementById('prizeMoment');
const prizeMomentTitle = document.getElementById('prizeMomentTitle');
const prizeFollowLight = new PointLight(0xffc247, 0, 1.7, 1.8);
scene.add(prizeFollowLight);

function setPrizeMomentOverlay(active, title = settings.gameMode === 'fugitives'
  ? tr('ПОЙМАННЫЙ В ПУТИ', 'CAPTIVE IN TRANSIT')
  : tr('ПРИЗ В ПУТИ', 'PRIZE IN TRANSIT')) {
  prizeMomentEl?.classList.toggle('active', active);
  prizeMomentEl?.setAttribute('aria-hidden', active ? 'false' : 'true');
  if (prizeMomentTitle) prizeMomentTitle.textContent = title;
  document.body.classList.toggle('prize-moment', active);
}

function beginPrizeMoment(toy) {
  if (!toy || mode !== 'play') return;
  if (prizeMoment?.active) finishPrizeMoment();
  prizeMoment = {
    active: true,
    toy,
    elapsed: 0,
    floorT: 0,
    returning: false,
    returnPos: camera.position.clone(),
    returnTarget: controls.target.clone(),
  };
  setPrizeMomentOverlay(true);
  prizeFollowLight.intensity = 0;
  const closePos = delivery.ejectPos.clone().add(new Vector3(0.42, 0.35, 0.78));
  const closeTarget = delivery.ejectPos.clone().add(new Vector3(0, -0.06, -0.13));
  flyTo(closePos, closeTarget, 0.68);
}

function returnFromPrizeMoment(fast = false) {
  if (!prizeMoment?.active || prizeMoment.returning) return;
  prizeMoment.returning = true;
  prizeMoment.returnT = 0;
  const label = settings.gameMode === 'fugitives'
    ? fast ? tr('ПОЙМАННЫЙ ГОТОВ', 'CAPTIVE READY') : tr('ЗАБИРАЙ ПОЙМАННОГО', 'COLLECT THE CAPTIVE')
    : fast ? tr('ПРИЗ ГОТОВ', 'PRIZE READY') : tr('ЗАБИРАЙ ПРИЗ', 'COLLECT YOUR PRIZE');
  setPrizeMomentOverlay(true, label);
  flyTo(prizeMoment.returnPos, prizeMoment.returnTarget, fast ? 0.24 : 0.72, finishPrizeMoment);
}

function finishPrizeMoment() {
  prizeFollowLight.intensity = 0;
  if (prizeMoment) prizeMoment.active = false;
  prizeMoment = null;
  setPrizeMomentOverlay(false);
  if (!camAnim && !prizeDrag.active && !panelDrag && !touchDirs.size) controls.enabled = true;
}

function updatePrizeMoment(dt) {
  if (!prizeMoment?.active) return;
  prizeMoment.elapsed += dt;
  if (prizeMoment.returning) {
    prizeMoment.returnT += dt;
    const fade = Math.max(0, 1 - prizeMoment.returnT * 3.5);
    prizeFollowLight.intensity *= fade;
    return;
  }

  const toy = prizeMoment.toy;
  const phase = toy.deliver?.phase;
  const visible = phase === 'route' || phase === 'eject' || toy.onFloor;
  if (visible) {
    const pulse = 0.34 + Math.sin(prizeMoment.elapsed * 7) * 0.07;
    prizeFollowLight.position.set(toy.body.position.x, toy.body.position.y + 0.28, toy.body.position.z + 0.16);
    prizeFollowLight.intensity = 0.52 + pulse * 0.48;
  }

  if (toy.onFloor && !toy.deliver) {
    prizeMoment.floorT += dt;
    if (prizeMoment.floorT > 0.62) returnFromPrizeMoment(false);
  }
}

function skipPrizeMoment() {
  if (prizeMoment?.active) returnFromPrizeMoment(true);
}

prizeMomentEl?.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  skipPrizeMoment();
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (!prizeMoment?.active || !['Space', 'Enter', 'Escape'].includes(e.code)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  skipPrizeMoment();
}, { capture: true });

function startPlay() {
  if (mode === 'play') return;
  mode = 'play';
  sfx.init(); // AudioContext требует жеста — вот он
  ui.hideAttract();
  clearStandFocusState();
  controls.autoRotate = false;
  const [playPos, playTarget] = currentPlayView();
  flyTo(playPos, playTarget, 1.4, () => {
    claw.enabled = !ui.isOnboardingOpen();
    if (!ui.isOnboardingOpen()) ui.setStatus('idle');
  });
}

// калибровка джойстика
let gpCal = null;
function startCalibration() {
  if (!gamepadName()) {
    ui.setStatus('bad', tr('Джойстик не найден. Воткни и пошевели им.', 'Gamepad not found. Connect it and move a stick.'));
    return;
  }
  ui.togglePanel(false);
  ui.calShow(true);
  gpCal = new Calibration(
    (text) => ui.calText(text),
    () => { ui.calShow(false); gpCal = null; ui.setStatus('coin', tr('Джойстик откалиброван.', 'Gamepad calibrated.')); },
    (msg) => { ui.calShow(false); gpCal = null; ui.setStatus('bad', msg); }
  );
}

claw.hooks = {
  gate: () => {
    if (settings.freePlay || credits > 0) return true;
    ui.setStatus('noCredit');
    ui.flashCoinBtn();
    return false;
  },
  onSpend: () => {
    if (!settings.freePlay) { credits--; ui.setCredits(credits); }
  },
  onAttempt: () => {
    const wasStandFocused = !!standFocus;
    clearStandFocusState();
    const [playPos, playTarget] = currentPlayView();
    if (settings.autoCenter || wasStandFocused) flyTo(playPos, playTarget, 0.9, () => {
      controls.enabled = !prizeDrag.active && !prizeMoment?.active;
    });
  },
};

ui.initControls({
  onCoin: insertCoin,
  onPlay: startPlay,
  onCalibrate: startCalibration,
  onSettingChange: (key, value) => {
    if (key === 'sound' || key === 'volume') sfx.syncSettings();
    if (key === 'prizeStand') {
      if (!value && standFocus) toggleStandFocus();
      prizeStand.setEnabled(value);
      ui.setPrizeStandEnabled(value);
    }
  },
  onOnboardingVisibility: (open) => {
    resetTouchInput();
    if (open) {
      controls.enabled = false;
      claw.enabled = false;
      ui.togglePanel(false);
      return;
    }
    if (mode === 'play' && !camAnim && !prizeMoment?.active && !prizeDrag.active) {
      controls.enabled = true;
      claw.enabled = true;
      ui.setStatus('idle', settings.gameMode === 'fugitives'
        ? tr('Инструктаж завершён. Выбирай беглеца.', 'Training complete. Pick a fugitive.')
        : tr('Инструктаж завершён. Выбирай игрушку.', 'Training complete. Pick a toy.'));
    }
  },
  onClearCollection: () => {
    prizeStand.clear();
    ui.setStatus('coin', tr('Коллекционный стенд очищен.', 'Prize collection cleared.'));
  },
});
ui.setCredits(credits);
ui.setGamepadName(gamepadName());
ui.setPrizeStandEnabled(settings.prizeStand);

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') insertCoin();
  if (e.code === 'Escape') {
    if (standFocus) { toggleStandFocus(); return; }
    if (gpCal) { gpCal = null; ui.calShow(false); return; }
    ui.togglePanel();
  }
  if (mode === 'attract' && (e.code === 'Enter' || e.code === 'Space')) {
    e.preventDefault();
    startPlay();
  }
});
window.addEventListener('pointerdown', () => sfx.init(), { once: true });

const panelRaycaster = new Raycaster();
const panelPointer = new Vector2();
const panelInput = new Vector2();
const panelVisual = new Vector2();
let panelDrag = null;
let standPointerDown = null;
let panelButtonT = 0;
let panelBlinkT = 0;
const touchDirs = new Map();

function setPanelPointer(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  panelPointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  panelPointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function hitPanelControl(e) {
  if (!panelControls) return null;
  setPanelPointer(e);
  panelRaycaster.setFromCamera(panelPointer, camera);
  const hits = panelRaycaster.intersectObjects([
    panelControls.joyKnob,
    panelControls.joyStick,
    panelControls.redButton,
    ...(panelControls.coinAcceptor ?? []),
  ], false);
  return hits[0]?.object ?? null;
}

function hitPrizeStand(e) {
  setPanelPointer(e);
  panelRaycaster.setFromCamera(panelPointer, camera);
  return panelRaycaster.intersectObject(prizeStand.group, true).length > 0;
}

function setPanelInputFromPointer(e) {
  if (!panelDrag) return;
  const dx = (e.clientX - panelDrag.x) / 86;
  const dy = (e.clientY - panelDrag.y) / 86;
  panelInput.set(
    MathUtils.clamp(dx, -1, 1),
    MathUtils.clamp(dy, -1, 1)
  );
  claw.panelInput.copy(panelInput);
}

function pressPanelButton() {
  panelButtonT = 0.18;
  sfx.init();
  if (mode === 'attract') startPlay();
  else claw.tryStart();
}

function applyTouchInput() {
  let x = 0;
  let y = 0;
  for (const v of touchDirs.values()) {
    x += v.x;
    y += v.y;
  }
  panelInput.set(
    MathUtils.clamp(x, -1, 1),
    MathUtils.clamp(y, -1, 1)
  );
  claw.panelInput.copy(panelInput);
}

function resetTouchInput() {
  if (!touchDirs.size) return;
  touchDirs.clear();
  document.querySelectorAll('#touchControls .touchBtn.active').forEach((btn) => btn.classList.remove('active'));
  applyTouchInput();
  if (!panelDrag && !camAnim && !prizeDrag.active && !prizeMoment?.active) controls.enabled = true;
}

function bindTouchControls() {
  const root = document.getElementById('touchControls');
  if (!root) return;
  const dirButtons = root.querySelectorAll('[data-touch-x]');
  for (const btn of dirButtons) {
    const dir = {
      x: Number(btn.dataset.touchX ?? 0),
      y: Number(btn.dataset.touchY ?? 0),
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sfx.init();
      if (mode === 'attract') startPlay();
      controls.enabled = false;
      btn.setPointerCapture?.(e.pointerId);
      btn.classList.add('active');
      touchDirs.set(e.pointerId, dir);
      applyTouchInput();
    }, { passive: false });
    const release = (e) => {
      if (!touchDirs.has(e.pointerId)) return;
      e.preventDefault();
      touchDirs.delete(e.pointerId);
      btn.classList.remove('active');
      applyTouchInput();
      if (!touchDirs.size && !panelDrag && !camAnim && !prizeDrag.active && !prizeMoment?.active) controls.enabled = true;
    };
    btn.addEventListener('pointerup', release, { passive: false });
    btn.addEventListener('pointercancel', release, { passive: false });
    btn.addEventListener('lostpointercapture', release, { passive: false });
  }

  const grab = document.getElementById('touchGrab');
  grab?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    grab.setPointerCapture?.(e.pointerId);
    grab.classList.add('active');
    pressPanelButton();
  }, { passive: false });
  const releaseGrab = (e) => {
    e.preventDefault();
    grab?.classList.remove('active');
  };
  grab?.addEventListener('pointerup', releaseGrab, { passive: false });
  grab?.addEventListener('pointercancel', releaseGrab, { passive: false });
  grab?.addEventListener('lostpointercapture', releaseGrab, { passive: false });
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  const hit = hitPanelControl(e);
  if (!hit) return;
  e.preventDefault();
  e.stopPropagation();
  if (hit.userData.panelControl === 'button') {
    pressPanelButton();
    return;
  }
  if (hit.userData.panelControl === 'coin') {
    insertCoin();
    return;
  }
  if (hit.userData.panelControl === 'joystick' || hit.name === 'panelJoystickStick') {
    if (mode === 'attract') startPlay();
    panelDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    renderer.domElement.setPointerCapture?.(e.pointerId);
    controls.enabled = false;
    setPanelInputFromPointer(e);
  }
}, { passive: false });

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (mode !== 'play' || !prizeStand.enabled || prizeDrag.active || prizeMoment?.active || camAnim) return;
  if (document.getElementById('settingsPanel')?.classList.contains('open')) return;
  if (!hitPrizeStand(e)) return;
  standPointerDown = { id: e.pointerId, x: e.clientX, y: e.clientY };
}, { passive: true });

bindTouchControls();
window.addEventListener('blur', resetTouchInput);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) resetTouchInput();
});

window.addEventListener('pointermove', (e) => {
  if (!panelDrag || e.pointerId !== panelDrag.id) return;
  e.preventDefault();
  setPanelInputFromPointer(e);
}, { passive: false });

window.addEventListener('pointerup', (e) => {
  if (!panelDrag || e.pointerId !== panelDrag.id) return;
  panelDrag = null;
  panelInput.set(0, 0);
  claw.panelInput.set(0, 0);
  renderer.domElement.releasePointerCapture?.(e.pointerId);
  if (!camAnim && !prizeDrag.active && !prizeMoment?.active) controls.enabled = true;
});

window.addEventListener('pointerup', (e) => {
  if (!standPointerDown || e.pointerId !== standPointerDown.id) return;
  const moved = Math.hypot(e.clientX - standPointerDown.x, e.clientY - standPointerDown.y);
  standPointerDown = null;
  if (moved <= 8 && !prizeDrag.active && !prizeMoment?.active) toggleStandFocus();
});
window.addEventListener('pointercancel', () => { standPointerDown = null; });

function updatePanelControls(dt) {
  if (!panelControls) return;
  panelBlinkT += dt;
  const k = Math.min(1, dt * 16);
  panelVisual.lerp(panelInput, k);
  const stickPivot = panelControls.stickPivot ?? panelControls.joyStick;
  const restPitch = stickPivot.userData.restPitch ?? -0.18;
  const pitchRange = stickPivot.userData.pitchRange ?? 0.42;
  const rollRange = stickPivot.userData.rollRange ?? 0.38;
  stickPivot.rotation.x = restPitch + panelVisual.y * pitchRange;
  stickPivot.rotation.z = -panelVisual.x * rollRange;
  if (panelButtonT > 0) panelButtonT = Math.max(0, panelButtonT - dt);
  const buttonRestY = panelControls.redButton.userData.restY ?? 0.16;
  const buttonPressY = panelControls.redButton.userData.pressY ?? 0.135;
  panelControls.redButton.position.y = MathUtils.lerp(
    panelControls.redButton.position.y,
    panelButtonT > 0 ? buttonPressY : buttonRestY,
    k
  );
  panelCoinPulse = Math.max(0, panelCoinPulse - dt);
  const hasCredit = settings.freePlay || credits > 0;
  const isPlayable = mode === 'play' && claw?.enabled && hasCredit;
  const buttonGlow = panelButtonT > 0 ? 1.4 : isPlayable ? 0.92 : 0.4;
  panelControls.redButton.material.emissiveIntensity = buttonGlow;
  if (panelControls.buttonRing) {
    panelControls.buttonRing.material.emissiveIntensity = panelButtonT > 0 ? 1.15 : isPlayable ? 0.62 : 0.22;
  }
  if (panelControls.coinGlow) {
    const coinPulse = panelCoinPulse > 0 ? 1 + panelCoinPulse * 4.5 : 0;
    panelControls.coinGlow.material.emissiveIntensity = hasCredit ? 2.25 + coinPulse : 1.25 + coinPulse;
  }
  if (panelControls.joyKnob) {
    panelControls.joyKnob.material.emissiveIntensity = panelDrag ? 0.78 : isPlayable ? 0.4 : 0.18;
  }
  if (panelControls.readyLamp) {
    const blink = 0.5 + Math.sin(panelBlinkT * 7) * 0.5;
    panelControls.readyLamp.material.emissiveIntensity = isPlayable ? 1.9 : hasCredit ? 0.65 + blink * 0.35 : 0.12;
  }
  if (panelControls.creditLamps) {
    const litCount = settings.freePlay ? panelControls.creditLamps.length : Math.min(credits, panelControls.creditLamps.length);
    panelControls.creditLamps.forEach((lamp, idx) => {
      const lit = idx < litCount;
      const freePlayPulse = settings.freePlay ? 0.45 + Math.sin(panelBlinkT * 4 + idx) * 0.25 : 0;
      lamp.material.emissiveIntensity = lit ? 1.45 + freePlayPulse : 0.1;
    });
  }
}

// прогрев шейдеров без блокировки главного потока (ANGLE/FXC компилит долго)
try { await renderer.compileAsync(scene, camera); } catch { /* не критично */ }
console.info('[claw] shaders warm');

ui.hideLoader();
window.__clawReady = true; // маркеры для автотестов
window.__claw = claw;
const prizeMomentApi = {
  get active() { return !!prizeMoment?.active; },
  get returning() { return !!prizeMoment?.returning; },
  get toy() { return prizeMoment?.toy ?? null; },
  start: beginPrizeMoment,
  skip: skipPrizeMoment,
  light: prizeFollowLight,
};
window.__clawView = {
  camera, controls, toys, panelControls, renderer, scene, prizeDrag, prizeStand,
  prizeMoment: prizeMomentApi, toggleStandFocus, sfx,
};
window.__prizeDrag = prizeDrag;
window.__prizeStand = prizeStand;
window.__prizeMoment = prizeMomentApi;
if (urlParams.has('toyGallery')) window.__toyGallery = window.__clawView;
if (urlParams.has('stress')) {
  window.__clawStress = {
    step(steps = 1, dt = 1 / 60) {
      const count = Math.min(10000, Math.max(1, Math.floor(steps)));
      const safeDt = Math.min(0.05, Math.max(0.0005, Number(dt) || 1 / 60));
      for (let i = 0; i < count; i++) stepSimulation(safeDt);
      return { steps: count, dt: safeDt, elapsed };
    },
    get elapsed() { return elapsed; },
  };
}

// метка сборки — чтобы жалобы приходили с номером версии; клик копирует
const BUILD = typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__ : 'dev';
const tagEl = document.getElementById('buildTag');
tagEl.textContent = `${tr('сборка', 'build')} ${BUILD}`;
tagEl.title = tr('клик — скопировать версию', 'click to copy version');
tagEl.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(BUILD);
    tagEl.textContent = tr('скопировано ✓', 'copied ✓');
  } catch {
    // clipboard запрещён — выделим текст, копируй руками
    getSelection().selectAllChildren(tagEl);
  }
  setTimeout(() => { tagEl.textContent = `${tr('сборка', 'build')} ${BUILD}`; }, 1200);
});
console.info('[claw] build:', BUILD);

const perfEl = document.getElementById('perfTag');
let fpsFrames = 0;
let fpsAccum = 0;
let fpsWorst = 0;
function updatePerfTag(frameMs) {
  fpsFrames++;
  fpsAccum += frameMs;
  fpsWorst = Math.max(fpsWorst, frameMs);
  if (fpsAccum < 500) return;
  const avgMs = fpsAccum / fpsFrames;
  const fps = 1000 / avgMs;
  perfEl.textContent = `FPS ${fps.toFixed(0)} · ${avgMs.toFixed(1)} ms · max ${fpsWorst.toFixed(0)}`;
  perfEl.style.color = fps < 45 ? '#fda4af' : fps < 57 ? '#fde68a' : '#a7f3d0';
  fpsFrames = 0;
  fpsAccum = 0;
  fpsWorst = 0;
}

// порог перескока стены (полутолщина 0.05 → полная 0.1) за шаг 1/60 — ~6 м/с; берём с запасом
const MAX_TOY_XZ_SPEED = 5.5;
function clampToyHorizontalSpeed() {
  for (const t of toys.toys) {
    // схваченные (group 16) НЕ трогаем: пока игрушка в ладони, claw.js сам
    // держит её позу и скорость. Внешний кламп здесь создаёт конфликт и дрожь.
    if (t.body.collisionFilterGroup === 16) continue;
    const v = t.body.velocity;
    const s = Math.hypot(v.x, v.z);
    if (s > MAX_TOY_XZ_SPEED) {
      const k = MAX_TOY_XZ_SPEED / s;
      v.x *= k;
      v.z *= k;
    }
  }
}

function stepSimulation(dt) {
  elapsed += dt;
  prizeDrag.update(dt);
  prizeStand.update(elapsed, dt, prizeDrag.active?.toy ?? null);
  clampToyHorizontalSpeed();
  world.step(1 / 60, dt, 4);
  clampToyHorizontalSpeed();
  claw.stabilizeRope();
  updatePanelControls(dt);
  claw.update(dt);
  toys.update(dt, elapsed);
  updatePrizeMoment(dt);
  coins.update(dt);
}

// === цикл ===
const clock = new Clock();
let elapsed = 0;
let coinNag = 0;   // таймер «вставь монету»
let gpNameT = 0;

// размер сверяем в цикле: событие resize в embedded-превью может не прийти
let lastW = 0, lastH = 0;
function syncSize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (w === lastW && h === lastH) return;
  lastW = w; lastH = h;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer?.setSize(w, h);
}

// rAF в скрытой вкладке (embedded-превью) не тикает — страхуемся таймером
let frameN = 0;
let rafFallback = null;
function schedule() {
  const id = requestAnimationFrame(loop);
  clearTimeout(rafFallback);
  rafFallback = setTimeout(() => { cancelAnimationFrame(id); loop(); }, 300);
}
function loop() {
  const frameStart = performance.now();
  schedule();
  syncSize();
  // dt=0 (два тика в одну мс) даёт 0/0=NaN в физике маятника — клампуем с обеих сторон
  const dt = Math.min(Math.max(clock.getDelta(), 0.0005), 0.05);
  // Обычный цикл и stress-harness используют один и тот же шаг симуляции.
  stepSimulation(dt);

  // напоминалка «вставь монету»
  if (mode === 'play' && !settings.freePlay && credits === 0 && claw.state === 0) {
    coinNag += dt;
    if (coinNag > 7) {
      coinNag = 0;
      sfx.nag();
      ui.flashCoinBtn();
    }
  } else {
    coinNag = 0;
  }

  // имя джойстика в настройках (раз в секунду)
  gpNameT += dt;
  if (gpNameT > 1) { gpNameT = 0; ui.setGamepadName(gamepadName()); }

  if (gpCal && gpCal.update(dt)) gpCal = null;

  if (camAnim) {
    camAnim.t += dt / camAnim.dur;
    const k = MathUtils.smoothstep(Math.min(1, camAnim.t), 0, 1);
    camera.position.lerpVectors(camAnim.p0, camAnim.p1, k);
    controls.target.lerpVectors(camAnim.t0, camAnim.t1, k);
    camera.lookAt(controls.target);
    if (camAnim.t >= 1) {
      const done = camAnim.then;
      camAnim = null;
      controls.enabled = !prizeDrag.active && !prizeMoment?.active;
      done?.();
    }
  } else {
    controls.update();
  }

  if (lastW > 0 && lastH > 0) {
    const t0 = performance.now();
    if (composer) composer.render();
    else renderer.render(scene, camera);
    const ms = performance.now() - t0;
    frameN++;
    if (frameN === 1 || frameN % 120 === 0) {
      console.info(`[claw] frame ${frameN}: render ${ms.toFixed(1)}ms`);
    }
  }
  updatePerfTag(performance.now() - frameStart);
}
loop();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) clock.getDelta(); // сброс dt после сна вкладки
});
