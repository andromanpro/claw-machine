import {
  ACESFilmicToneMapping,
  Box3,
  CircleGeometry,
  Clock,
  Color,
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  GridHelper,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PREVIEW_BUILDERS } from './toys.js';
import { tr, toyName } from './i18n.js';

const names = Object.keys(PREVIEW_BUILDERS);
const mount = document.getElementById('viewerMount');
const list = document.getElementById('toyList');
const search = document.getElementById('toySearch');
const mobileSelect = document.getElementById('mobileToySelect');
const title = document.getElementById('toyTitle');
const meta = document.getElementById('toyMeta');
const hint = document.getElementById('viewerHint');
const autoButton = document.getElementById('autoRotate');

document.documentElement.lang = tr('ru', 'en');
document.querySelector('.brandText strong').textContent = tr('АРХИВ ПРИЗОВ', 'PRIZE ARCHIVE');
document.querySelector('.brandText span').textContent = tr('ХВАТАЙКА-67 · ИНСПЕКЦИОННЫЙ СТЕНД', 'CLAW-67 · INSPECTION STAND');
document.querySelector('.catalogHead strong').textContent = tr('КАТАЛОГ', 'CATALOG');
search.placeholder = tr('Найти игрушку…', 'Find a toy…');
document.getElementById('prevToy').textContent = tr('← ПРЕД', '← PREV');
document.getElementById('nextToy').textContent = tr('→ СЛЕД', '→ NEXT');
autoButton.textContent = tr('↻ АВТО', '↻ AUTO');
document.getElementById('resetView').textContent = tr('⌂ СБРОС', '⌂ RESET');
document.querySelector('.backLink').textContent = tr('▣ АВТОМАТ', '▣ MACHINE');
hint.textContent = tr('МЫШЬ / ПАЛЕЦ — КРУТИТЬ · КОЛЕСО / ЩИПОК — МАСШТАБ', 'MOUSE / TOUCH — ROTATE · WHEEL / PINCH — ZOOM');

document.getElementById('toyCount').textContent = String(names.length).padStart(2, '0');

const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
mount.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x070b09);
scene.fog = new FogExp2(0x070b09, 0.16);

const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const camera = new PerspectiveCamera(38, 1, 0.01, 40);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.15;
controls.minPolarAngle = 0.18;
controls.maxPolarAngle = Math.PI - 0.22;

scene.add(new HemisphereLight(0xfff3d5, 0x10241d, 1.55));
const keyLight = new DirectionalLight(0xffecd0, 4.4);
keyLight.position.set(2.8, 4.2, 3.6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 0.1;
keyLight.shadow.camera.far = 12;
scene.add(keyLight);

const fillLight = new DirectionalLight(0x8eeaff, 2.0);
fillLight.position.set(-3.4, 1.5, 2.2);
scene.add(fillLight);
const rimLight = new DirectionalLight(0xff4b5f, 2.5);
rimLight.position.set(2.5, 2.2, -3.8);
scene.add(rimLight);

const floor = new Mesh(
  new CircleGeometry(7, 72),
  new MeshStandardMaterial({ color: 0x07100d, roughness: 0.82, metalness: 0.22 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.055;
floor.receiveShadow = true;
scene.add(floor);

const grid = new GridHelper(12, 28, 0x572124, 0x15372d);
grid.position.y = -0.049;
grid.material.transparent = true;
grid.material.opacity = 0.32;
grid.material.depthWrite = false;
scene.add(grid);

const platform = new Group();
const platformBody = new Mesh(
  new CylinderGeometry(0.48, 0.52, 0.08, 64),
  new MeshStandardMaterial({ color: 0x101d18, roughness: 0.38, metalness: 0.68 })
);
platformBody.position.y = -0.01;
platformBody.castShadow = true;
platformBody.receiveShadow = true;
const platformTop = new Mesh(
  new CylinderGeometry(0.44, 0.44, 0.012, 64),
  new MeshStandardMaterial({ color: 0x1d3028, roughness: 0.7, metalness: 0.22 })
);
platformTop.position.y = 0.038;
platformTop.receiveShadow = true;
const platformRing = new Mesh(
  new TorusGeometry(0.47, 0.012, 8, 64),
  new MeshStandardMaterial({
    color: 0xffc247,
    emissive: 0xff8a24,
    emissiveIntensity: 1.0,
    roughness: 0.28,
    metalness: 0.5,
  })
);
platformRing.rotation.x = Math.PI / 2;
platformRing.position.y = 0.02;
platform.add(platformBody, platformTop, platformRing);
scene.add(platform);

const cache = new Map();
let activeEntry = null;
let activeIndex = 0;
let homeView = null;

function buildEntry(name) {
  if (cache.has(name)) return cache.get(name);
  const toy = PREVIEW_BUILDERS[name]();
  toy.updateMatrixWorld(true);
  const box = new Box3().setFromObject(toy);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());

  // Нижняя грань ставится на стенд, центр по X/Z совпадает с осью вращения.
  toy.position.x -= center.x;
  toy.position.y -= box.min.y;
  toy.position.z -= center.z;
  toy.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });

  const root = new Group();
  root.position.y = 0.045;
  root.add(toy);
  const entry = { name, root, size };
  cache.set(name, entry);
  return entry;
}

function fitCamera(entry) {
  const maxDim = Math.max(entry.size.x, entry.size.y, entry.size.z);
  const radius = maxDim * 0.5;
  const distance = Math.max(0.85, (radius / Math.tan(MathUtils.degToRad(camera.fov * 0.5))) * 1.42);
  const target = new Vector3(0, entry.size.y * 0.48 + 0.045, 0);
  const position = new Vector3(distance * 0.78, target.y + distance * 0.25, distance * 1.12);

  controls.target.copy(target);
  camera.position.copy(position);
  camera.near = Math.max(0.005, distance / 100);
  camera.far = Math.max(20, distance * 12);
  camera.updateProjectionMatrix();
  controls.minDistance = distance * 0.42;
  controls.maxDistance = distance * 3.2;
  controls.update();

  const footprint = Math.max(entry.size.x, entry.size.z);
  const standScale = MathUtils.clamp(footprint / 0.42, 0.82, 1.42);
  platform.scale.setScalar(standScale);
  homeView = { position: position.clone(), target: target.clone() };
}

function setSelectedState(name) {
  for (const button of list.querySelectorAll('.toyButton')) {
    button.setAttribute('aria-selected', String(button.dataset.toy === name));
  }
  mobileSelect.value = name;
}

function selectToy(name, updateUrl = true) {
  const nextIndex = names.indexOf(name);
  if (nextIndex < 0) return;
  if (activeEntry) scene.remove(activeEntry.root);
  activeIndex = nextIndex;
  activeEntry = buildEntry(name);
  scene.add(activeEntry.root);
  fitCamera(activeEntry);
  setSelectedState(name);
  const displayName = toyName(name);
  title.textContent = displayName;
  meta.textContent = `${tr('ПРИЗ', 'PRIZE')} ${String(activeIndex + 1).padStart(2, '0')} / ${String(names.length).padStart(2, '0')}`;
  document.title = tr(`${displayName} — Галерея призов`, `${displayName} — Prize Viewer`);
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set('toy', name);
    history.replaceState(null, '', url);
  }
}

function stepToy(delta) {
  selectToy(names[(activeIndex + delta + names.length) % names.length]);
}

function resetView() {
  if (!homeView) return;
  camera.position.copy(homeView.position);
  controls.target.copy(homeView.target);
  controls.update();
}

function setAutoRotate(enabled) {
  controls.autoRotate = enabled;
  autoButton.setAttribute('aria-pressed', String(enabled));
}

function makeCatalog() {
  names.forEach((name, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toyButton';
    button.dataset.toy = name;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    button.innerHTML = `
      <span class="toyIndex">${String(index + 1).padStart(2, '0')}</span>
      <span class="toyName"></span>
      <span class="toyArrow">›</span>`;
    button.querySelector('.toyName').textContent = toyName(name);
    button.addEventListener('click', () => selectToy(name));
    list.appendChild(button);

    const option = document.createElement('option');
    option.value = name;
    option.textContent = toyName(name);
    mobileSelect.appendChild(option);
  });
}

makeCatalog();

search.addEventListener('input', () => {
  const query = search.value.trim().toLocaleLowerCase('ru');
  for (const button of list.querySelectorAll('.toyButton')) {
    const haystack = `${button.dataset.toy} ${toyName(button.dataset.toy)}`.toLocaleLowerCase('ru');
    button.hidden = query !== '' && !haystack.includes(query);
  }
});
mobileSelect.addEventListener('change', () => selectToy(mobileSelect.value));
document.getElementById('prevToy').addEventListener('click', () => stepToy(-1));
document.getElementById('nextToy').addEventListener('click', () => stepToy(1));
document.getElementById('resetView').addEventListener('click', resetView);
autoButton.addEventListener('click', () => setAutoRotate(!controls.autoRotate));

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === 'ArrowLeft') stepToy(-1);
  else if (event.key === 'ArrowRight') stepToy(1);
  else if (event.key.toLocaleLowerCase('ru') === 'r' || event.key.toLocaleLowerCase('ru') === 'к') resetView();
  else if (event.code === 'Space') {
    event.preventDefault();
    setAutoRotate(!controls.autoRotate);
  }
});

renderer.domElement.addEventListener('pointerdown', () => hint.classList.add('used'), { once: true });

function resize() {
  const rect = mount.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(mount);
resize();

const requested = new URLSearchParams(location.search).get('toy');
selectToy(names.includes(requested) ? requested : names[0], false);

const clock = new Clock();
function animate() {
  requestAnimationFrame(animate);
  const elapsed = clock.getElapsedTime();
  platformRing.material.emissiveIntensity = 0.92 + Math.sin(elapsed * 2.1) * 0.13;
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.__toyViewer = {
  names,
  selectToy,
  get current() { return names[activeIndex]; },
  camera,
  controls,
  renderer,
};
window.__toyViewerReady = true;
