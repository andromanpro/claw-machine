// Стенд-инспектор игрушек: одна игрушка, 8 ракурсов сеткой 4×2, нейтральный свет.
// ?toy=<имя> — рендер; ?list — только window.__toyNames (для прогонного скрипта).
import * as THREE from 'three';
import { PREVIEW_BUILDERS } from './toys.js';

const params = new URLSearchParams(location.search);
window.__toyNames = Object.keys(PREVIEW_BUILDERS);

if (params.has('list')) {
  document.getElementById('label').textContent = window.__toyNames.join(' · ');
  window.__inspectReady = true;
} else {
  const name = params.get('toy') ?? window.__toyNames[0];
  document.getElementById('label').textContent = name;

  const W = 1600, H = 800, CW = W / 4, CH = H / 2;
  // Инспектор рендерит восемь scissor-областей один раз. Сохраняем drawing
  // buffer, иначе headless Chrome иногда отдаёт чёрные клетки на скриншоте.
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd9e0e8);
  renderer.setClearColor(0xd9e0e8, 1);

  // нейтральный студийный свет: ключевой + заполняющий + контровой
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(2, 3, 2.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
  fill.position.set(-2.5, 1, -1.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.35);
  rim.position.set(0, -2, -3);
  scene.add(rim);

  const toy = PREVIEW_BUILDERS[name]();
  scene.add(toy);
  window.__inspectToy = toy;
  window.__inspectScene = scene;
  window.__inspectTHREE = THREE;

  // нормализация: игрушка в центре кадра, дистанция от габарита
  const box = new THREE.Box3().setFromObject(toy);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5;
  const dist = radius * 3.1;

  const camera = new THREE.PerspectiveCamera(40, CW / CH, 0.01, 20);

  // 8 ракурсов: 6 по кругу + сверху + снизу-три-четверти
  const views = [
    { az: 0, el: 10 }, { az: 60, el: 10 }, { az: 120, el: 10 }, { az: 180, el: 10 },
    { az: 240, el: 10 }, { az: 300, el: 10 }, { az: 30, el: 78 }, { az: 210, el: -32 },
  ];

  renderer.setScissorTest(true);
  views.forEach((v, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const x = col * CW, y = H - (row + 1) * CH; // WebGL y снизу
    const azr = (v.az * Math.PI) / 180, elr = (v.el * Math.PI) / 180;
    camera.position.set(
      center.x + dist * Math.cos(elr) * Math.sin(azr),
      center.y + dist * Math.sin(elr),
      center.z + dist * Math.cos(elr) * Math.cos(azr)
    );
    camera.lookAt(center);
    renderer.setViewport(x, y, CW, CH);
    renderer.setScissor(x, y, CW, CH);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
  });

  window.__inspectReady = true;
}
