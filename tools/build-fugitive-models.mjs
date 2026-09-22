// Сборка моделей беглецов: Quaternius FBX → сжатый GLB.
//
// Зачем: исходные пять FBX весят 11.16 МБ. Вес сидит не в полигонах
// (27 тыс. треугольников на всех), а в трёх местах:
//   1. контейнер FBX сам по себе избыточен;
//   2. в каждом файле лежат все 17 клипов, а игре нужно пять (src/fugitive-models.js);
//   3. меши неиндексированные — каждый треугольник тащит три собственные вершины.
//
// Скрипт лечит все три: конвертирует в GLB, оставляет только нужные клипы,
// выносит анимации в один общий файл (скелеты у пяти моделей идентичны,
// поэтому ретаргет не нужен) и прогоняет геометрию через weld + quantize.
//
// Запуск: npm run build-fugitives
// Вход:   public/models/fugitives/quaternius/*.fbx
// Выход:  public/models/fugitives/*.glb
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
// join переименован: имя уже занято join из node:path выше.
import { dedup, prune, weld, quantize, palette, join as joinPrimitives } from '@gltf-transform/functions';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Исходники лежат ВНЕ public/: vite копирует public целиком, и 11.4 МБ FBX
// уезжали в сборку следом за сжатыми GLB, обнуляя всю экономию.
const SRC = join(ROOT, 'assets-src/fugitives/quaternius');
const OUT = join(ROOT, 'public/models/fugitives');

// Ровно то, что дёргает CLIP_NAMES в src/fugitive-models.js.
// Остальные 12 клипов пака (меч, стрельба, кувырок, sit/stand, подбор предмета)
// не вызывает никто — в сборку они не едут.
const USED_CLIPS = [
  'CharacterArmature|Idle',
  'CharacterArmature|Walk',
  'CharacterArmature|Run',
  'CharacterArmature|Defeat',
  'CharacterArmature|Jump',
];

const MODELS = [
  'Worker_Male.fbx',
  'Worker_Female.fbx',
  'Doctor_Female_Young.fbx',
  'Casual2_Male.fbx',
  'Suit_Female.fbx',
];

// GLTFExporter рассчитан на браузер и на бинарном выходе зовёт FileReader.
// В node его нет, но Blob умеет arrayBuffer() — этого достаточно.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        if (this.onloadend) this.onloadend();
      });
    }
  };
}

const loader = new FBXLoader();
const exporter = new GLTFExporter();
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function parseFbx(file) {
  const bytes = readFileSync(join(SRC, file));
  return loader.parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    SRC + '/',
  );
}

function exportGlb(scene, animations) {
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => resolve(new Uint8Array(result)),
      (error) => reject(error),
      { binary: true, animations, onlyVisible: false },
    );
  });
}

// Порядок здесь важнее, чем кажется.
//
// В FBX персонаж — один меш с 124 группами геометрии по числу материалов
// (Skin, Shirt, Vest, Hat, Hair...). В glTF групп нет, поэтому экспортёр режет
// его на 110+ отдельных примитивов, и на загрузке они становятся 110 отдельными
// SkinnedMesh. Draw calls при этом те же, но каждый меш отдельно обходится
// и биндит скелет каждый кадр — замер показал 8.1 мс → 21.7 мс на кадр.
//
// palette() сворачивает материалы, различающиеся только базовым цветом, в одну
// крошечную текстуру-палитру плюс UV, после чего join() склеивает примитивы в
// один. Персонаж снова становится одним мешем — уже с одним draw call вместо 110.
//
// weld индексирует геометрию (вершины перестают дублироваться втрое),
// quantize ужимает атрибуты из float32. Скиннинговые веса режем щадяще:
// их порча ломает деформацию, не вылезая ни в какую ошибку.
async function compress(bytes) {
  const document = await io.readBinary(bytes);
  await document.transform(
    dedup(),
    prune({ keepLeaves: false }),
    palette({ blockSize: 4, min: 2 }),
    joinPrimitives({ keepNamed: false }),
    weld(),
    quantize({
      quantizePosition: 14,
      quantizeNormal: 10,
      quantizeTexcoord: 12,
      quantizeColor: 8,
      quantizeWeight: 16,
      quantizeGeneric: 16,
    }),
  );
  return io.writeBinary(document);
}

const kb = (n) => (n / 1024).toFixed(0).padStart(5) + 'К';

async function main() {
  mkdirSync(OUT, { recursive: true });

  let srcTotal = 0;
  let rawTotal = 0;
  let outTotal = 0;
  let sharedWritten = false;

  console.log('модель                        FBX    GLB-сырой  GLB-сжатый');

  for (const file of MODELS) {
    srcTotal += statSync(join(SRC, file)).size;
    const root = parseFbx(file);
    const clips = root.animations.filter((clip) => USED_CLIPS.includes(clip.name));

    if (clips.length !== USED_CLIPS.length) {
      const found = clips.map((c) => c.name);
      const missing = USED_CLIPS.filter((name) => !found.includes(name));
      throw new Error(`${file}: не найдены клипы ${missing.join(', ')}`);
    }

    // Анимации выносим один раз: скелет и имена костей у всех пяти совпадают
    // (проверено — 32 кости, 24 узла в треках), поэтому один набор клипов
    // корректно биндится на любую модель.
    if (!sharedWritten) {
      // Парсим заново и физически убираем меши из иерархии: Object3D.clone()
      // не перепривязывает скелет (для этого есть SkeletonUtils.clone), а
      // скрытие через visible не помогает — экспорт идёт с onlyVisible: false.
      // Без меша исчезает и skin, остаётся чистый скелет с треками.
      const skeletonOnly = parseFbx(file);
      const meshes = [];
      skeletonOnly.traverse((node) => {
        if (node.isSkinnedMesh || node.isMesh) meshes.push(node);
      });
      for (const mesh of meshes) mesh.parent?.remove(mesh);

      const animClips = skeletonOnly.animations.filter((clip) => USED_CLIPS.includes(clip.name));
      const animRaw = await exportGlb(skeletonOnly, animClips);
      const animOut = await compress(animRaw);
      writeFileSync(join(OUT, 'fugitive-animations.glb'), animOut);
      rawTotal += animRaw.byteLength;
      outTotal += animOut.byteLength;
      console.log(
        `${'fugitive-animations.glb'.padEnd(28)} ${'—'.padStart(6)} ${kb(animRaw.byteLength)} ${kb(animOut.byteLength)}   (${clips.length} клипов на всех)`,
      );
      sharedWritten = true;
    }

    // Сами модели едут без анимаций — только геометрия и скелет.
    const raw = await exportGlb(root, []);
    const out = await compress(raw);
    const name = file.replace(/\.fbx$/i, '.glb');
    writeFileSync(join(OUT, name), out);
    rawTotal += raw.byteLength;
    outTotal += out.byteLength;

    console.log(
      `${name.padEnd(28)} ${kb(statSync(join(SRC, file)).size)} ${kb(raw.byteLength)} ${kb(out.byteLength)}`,
    );
  }

  const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' МБ';
  console.log('\n=== ИТОГО ===');
  console.log(`исходные FBX      ${mb(srcTotal)}`);
  console.log(`GLB без сжатия    ${mb(rawTotal)}`);
  console.log(`GLB сжатые        ${mb(outTotal)}   (${(100 - (outTotal / srcTotal) * 100).toFixed(0)}% экономии)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
