import {
  AnimationMixer,
  Box3,
  Group,
  LoopRepeat,
  MathUtils,
  SkinnedMesh,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const ASSET_ROOT = `${import.meta.env.BASE_URL}models/fugitives/`;
const MODEL_HEIGHT = 0.59;
const MODEL_FLOOR = -0.255;

let assetsPromise = null;
let resolvedAssets = null;
let sharedClips = [];

// Модели собираются из исходных Quaternius FBX через npm run build-fugitives:
// это сжатый GLB без анимаций (11.16 МБ → 1.75 МБ). Скелет у всех пяти
// одинаковый, поэтому клипы лежат в одном общем файле и биндятся по именам
// узлов на любую модель — дублировать их пять раз незачем.
const MODEL_FILES = {
  workerMale: 'Worker_Male.glb',
  workerFemale: 'Worker_Female.glb',
  doctorFemale: 'Doctor_Female_Young.glb',
  courierMale: 'Casual2_Male.glb',
  supervisorFemale: 'Suit_Female.glb',
};
const ANIMATION_FILE = 'fugitive-animations.glb';

const CLIP_NAMES = {
  Idle_Loop: 'CharacterArmature|Idle',
  Walk_Loop: 'CharacterArmature|Walk',
  Sprint_Loop: 'CharacterArmature|Run',
  Crouch_Idle_Loop: 'CharacterArmature|Defeat',
  Jump_Loop: 'CharacterArmature|Jump',
};
const LOCOMOTION_ACTIONS = new Set(['Idle_Loop', 'Walk_Loop', 'Sprint_Loop']);

function loadAssets() {
  if (assetsPromise) return assetsPromise;
  const loader = new GLTFLoader();
  const entries = Object.entries(MODEL_FILES);
  assetsPromise = Promise.all([
    loader.loadAsync(`${ASSET_ROOT}${ANIMATION_FILE}`),
    ...entries.map(([, file]) => loader.loadAsync(`${ASSET_ROOT}${file}`)),
  ]).then(([animations, ...models]) => {
    sharedClips = animations.animations;
    // Склеиваем один раз на модель, а не на каждый инстанс: дальше персонажи
    // расходятся через cloneSkeleton уже готовыми.
    for (const model of models) mergeSkinnedParts(model.scene);
    resolvedAssets = Object.fromEntries(entries.map(([key], index) => [key, models[index].scene]));
    return resolvedAssets;
  });
  return assetsPromise;
}

// glTF не умеет мульти-материал внутри одного меша — там, где в FBX был один
// меш со 124 группами геометрии, экспорт раскладывает персонажа на ~120
// отдельных SkinnedMesh. Draw calls от этого те же, но каждый кусок отдельно
// обходится и биндит скелет каждый кадр: замер дал 8.1 мс → 21.7 мс на кадр.
//
// Сборка через palette() свела все материалы персонажа к одному, поэтому куски
// склеиваются обратно в единый меш — и это уже лучше исходника: один draw call
// на персонажа вместо ста десяти.
function mergeSkinnedParts(scene) {
  const parts = [];
  scene.traverse((node) => {
    if (node.isSkinnedMesh) parts.push(node);
  });
  if (parts.length < 2) return;

  const parent = parts[0].parent;
  // Склейка корректна, только если куски лежат под одним родителем и не имеют
  // собственных смещений — иначе геометрию пришлось бы предварительно
  // трансформировать, а для скиннинга это ломает bind-позу.
  const uniform = parts.every(
    (part) => part.parent === parent
      && part.matrix.equals(parts[0].matrix)
      && part.material === parts[0].material,
  );
  if (!uniform) return;

  const merged = mergeGeometries(parts.map((part) => part.geometry), false);
  if (!merged) return; // атрибуты разошлись — оставляем как загрузилось

  const mesh = new SkinnedMesh(merged, parts[0].material);
  mesh.name = parts[0].name || 'Body';
  mesh.matrix.copy(parts[0].matrix);
  mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.bind(parts[0].skeleton, parts[0].bindMatrix);
  parent.add(mesh);

  for (const part of parts) {
    part.parent?.remove(part);
    part.geometry.dispose();
  }
}

function normalizeModel(model) {
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const scale = MODEL_HEIGHT / Math.max(0.001, size.y);
  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, MODEL_FLOOR - box.min.y * scale, -center.z * scale);
  model.rotation.y = Math.PI;
  model.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    node.frustumCulled = false;
    if (Array.isArray(node.material)) node.material = node.material.map((material) => material.clone());
    else if (node.material) node.material = node.material.clone();
  });
}

export function createDetailedFugitive({ modelKey = 'workerMale' } = {}) {
  if (!resolvedAssets) return null;
  const root = new Group();
  const data = { ready: false };
  root.userData.detailedFugitive = data;

  // assetsPromise к этому моменту уже await-нут ToyManager.init(). Оставляем
  // синхронный factory для существующего spawnTemplate.
  const source = resolvedAssets[modelKey] ?? resolvedAssets.workerMale;
  const model = cloneSkeleton(source);
  normalizeModel(model);
  root.add(model);

  const mixer = new AnimationMixer(model);
  const actions = new Map();
  for (const [name, sourceName] of Object.entries(CLIP_NAMES)) {
    const clip = sharedClips.find((item) => item.name === sourceName);
    if (!clip) continue;
    const action = mixer.clipAction(clip, model);
    action.setLoop(LoopRepeat, Infinity);
    actions.set(name, action);
  }
  const idle = actions.get('Idle_Loop');
  idle?.play();
  Object.assign(data, {
    ready: true,
    model,
    mixer,
    actions,
    actionName: idle ? 'Idle_Loop' : null,
    actionHold: 0,
    visualYaw: Math.random() * Math.PI * 2,
  });
  return root;
}

export async function prepareFugitiveModelFactory() {
  await loadAssets();
  return createDetailedFugitive;
}

function lerpAngle(from, to, amount) {
  let delta = (to - from + Math.PI) % (Math.PI * 2) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * amount;
}

export function animateDetailedFugitive(toy, dt) {
  const ai = toy.ai;
  const rig = toy.mesh?.userData?.detailedFugitive;
  if (!ai || !rig?.ready) return false;
  const held = toy.body?.collisionFilterGroup === 16 || ai.captured;
  const moveX = ai.visualMoveX ?? 0;
  const moveZ = ai.visualMoveZ ?? 0;
  const speed = held ? 0 : Math.hypot(moveX, moveZ);
  if (speed > 0.025 && !held) {
    // Quaternius FBX смотрит вдоль оси, противоположной стандартному +Z Three.js.
    // Компенсируем это здесь: без разворота клип шагает лицом против скорости.
    const targetYaw = Math.atan2(moveX, moveZ) + Math.PI;
    rig.visualYaw = lerpAngle(rig.visualYaw, targetYaw, Math.min(1, dt * 4.8));
  }
  rig.model.rotation.y = Math.PI + rig.visualYaw;
  rig.actionHold = Math.max(0, (rig.actionHold ?? 0) - dt);

  let next = 'Idle_Loop';
  const forced = held || toy.floorJourney?.phase === 'climb'
    || ai.state === 'stand-approach' || ai.state === 'hide' || ai.state === 'freeze';
  if (held || toy.floorJourney?.phase === 'climb') next = 'Jump_Loop';
  else if (ai.state === 'stand-approach') next = 'Walk_Loop';
  else if (ai.state === 'hide' || ai.state === 'freeze') next = 'Crouch_Idle_Loop';
  else if (rig.actionName === 'Sprint_Loop') next = speed > 0.18 ? 'Sprint_Loop' : speed > 0.018 ? 'Walk_Loop' : 'Idle_Loop';
  else if (rig.actionName === 'Walk_Loop') next = speed > 0.31 ? 'Sprint_Loop' : speed > 0.014 ? 'Walk_Loop' : 'Idle_Loop';
  else if (speed > 0.32) next = 'Sprint_Loop';
  else if (speed > 0.04) next = 'Walk_Loop';
  if (!rig.actions.has(next)) next = 'Idle_Loop';
  if (
    !forced
    && next !== rig.actionName
    && rig.actionHold > 0
    && LOCOMOTION_ACTIONS.has(next)
    && LOCOMOTION_ACTIONS.has(rig.actionName)
  ) next = rig.actionName;

  if (next !== rig.actionName) {
    const previousName = rig.actionName;
    const previous = rig.actions.get(previousName);
    const action = rig.actions.get(next);
    if (action) {
      const syncPhase = LOCOMOTION_ACTIONS.has(previousName) && LOCOMOTION_ACTIONS.has(next) && previous;
      const phase = syncPhase
        ? (previous.time % previous.getClip().duration) / previous.getClip().duration
        : 0;
      action.reset();
      if (syncPhase) action.time = phase * action.getClip().duration;
      action.play();
      if (previous) previous.crossFadeTo(action, 0.24, true);
      else action.fadeIn(0.24);
    }
    rig.actionName = next;
    rig.actionHold = forced ? 0.08 : 0.24;
  }
  const action = rig.actions.get(rig.actionName);
  if (action) {
    const pace = rig.actionName === 'Sprint_Loop'
      ? MathUtils.clamp(speed / 0.38, 0.75, 1.35)
      : rig.actionName === 'Walk_Loop'
        ? MathUtils.clamp(speed / 0.16, 0.68, 1.25)
        : 1;
    action.timeScale = held ? 1.35 : pace;
  }
  rig.mixer.update(dt);
  return true;
}
