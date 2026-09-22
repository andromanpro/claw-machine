// Регрессия на выход build-fugitive-models.mjs.
//
// Сжатие геометрии умеет молча ломать скиннинг: prune выкидывает Skin как
// «неиспользуемый», quantize портит веса — и то и другое не роняет сборку,
// а просто превращает беглецов в неподвижные статуи. Поэтому проверяем
// содержимое GLB, а не только их размер.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'public/models/fugitives');
const ANIM_FILE = 'fugitive-animations.glb';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const failures = [];

if (!existsSync(DIR)) {
  console.error(`нет каталога ${DIR} — сначала npm run build-fugitives`);
  process.exit(1);
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.glb'));
const nodeNamesPerFile = new Map();
const jointCounts = new Map();
let animTargets = null;
let animClipNames = [];

for (const file of files) {
  const doc = await io.read(join(DIR, file));
  const root = doc.getRoot();
  const meshes = root.listMeshes();
  const skins = root.listSkins();
  const anims = root.listAnimations();
  const nodes = root.listNodes();
  const isAnimFile = file === ANIM_FILE;

  let joints = false;
  let weights = false;
  let verts = 0;
  for (const mesh of meshes) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getAttribute('JOINTS_0')) joints = true;
      if (prim.getAttribute('WEIGHTS_0')) weights = true;
      const pos = prim.getAttribute('POSITION');
      if (pos) verts += pos.getCount();
    }
  }

  nodeNamesPerFile.set(file, nodes.map((n) => n.getName()));

  if (isAnimFile) {
    animClipNames = anims.map((a) => a.getName());
    animTargets = [
      ...new Set(anims.flatMap((a) => a.listChannels().map((c) => c.getTargetNode()?.getName()))),
    ].filter(Boolean);
    if (!anims.length) failures.push(`${file}: нет ни одного клипа`);
    if (meshes.length) failures.push(`${file}: должен быть только скелет, а внутри ${meshes.length} мешей`);
  } else {
    if (!meshes.length) failures.push(`${file}: нет мешей`);
    if (!skins.length) failures.push(`${file}: СКИН ПОТЕРЯН — модель не будет деформироваться`);
    if (!joints) failures.push(`${file}: нет атрибута JOINTS_0`);
    if (!weights) failures.push(`${file}: нет атрибута WEIGHTS_0`);
    // Магического числа тут быть не должно: из 32 костей пака 9 — листовые
    // терминаторы (`*_end`) без весов и треков, их законно вычищает prune.
    // Настоящий инвариант — что у всех пяти моделей скелет одинаковый,
    // иначе общий файл анимаций ляжет на них по-разному.
    const jointCount = skins.length ? skins[0].listJoints().length : 0;
    if (!jointCount) failures.push(`${file}: в скине ноль суставов`);
    jointCounts.set(file, jointCount);
  }

  const primitives = meshes.reduce((acc, mesh) => acc + mesh.listPrimitives().length, 0);
  const materials = root.listMaterials().length;
  const semantics = [
    ...new Set(meshes.flatMap((m) => m.listPrimitives().flatMap((p) => p.listSemantics()))),
  ].sort();
  console.log(
    `${file.padEnd(28)} меши ${meshes.length}  прим ${String(primitives).padStart(3)}  ` +
      `матер ${materials}  атриб [${semantics.join(',')}]  скины ${skins.length}  ` +
      `суставы ${String(skins.length ? skins[0].listJoints().length : 0).padStart(2)}  ` +
      `узлы ${String(nodes.length).padStart(2)}  верт ${String(verts).padStart(5)}  ` +
      `JOINTS_0 ${joints ? 'да ' : 'НЕТ'}  WEIGHTS_0 ${weights ? 'да ' : 'НЕТ'}  клипы ${anims.length}`,
  );
}

console.log('\n=== привязка общих анимаций ===');
if (!animTargets) {
  failures.push(`${ANIM_FILE} отсутствует — общие анимации не собраны`);
} else {
  console.log(`клипы: ${animClipNames.join(', ')}`);
  console.log(`треки целятся в ${animTargets.length} узлов\n`);
  for (const [file, names] of nodeNamesPerFile) {
    if (file === ANIM_FILE) continue;
    const missing = animTargets.filter((target) => !names.includes(target));
    if (missing.length) {
      failures.push(
        `${file}: нет целевых узлов ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` (+${missing.length - 5})` : ''}`,
      );
      console.log(`❌ ${file}`);
    } else {
      console.log(`✓  ${file} — все ${animTargets.length} целевых узлов на месте`);
    }
  }
}

const distinctJointCounts = new Set(jointCounts.values());
if (distinctJointCounts.size > 1) {
  failures.push(
    `скелеты разошлись — суставов по файлам: ${[...jointCounts].map(([f, n]) => `${f}=${n}`).join(', ')}`,
  );
}

if (failures.length) {
  console.error('\n❌ ПРОВАЛ:');
  for (const message of failures) console.error(`   ${message}`);
  process.exit(1);
}
console.log('\n✅ модели беглецов валидны: скиннинг цел, треки привяжутся');
