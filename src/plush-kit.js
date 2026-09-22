import {
  CapsuleGeometry,
  CatmullRomCurve3,
  DoubleSide,
  Group,
  Mesh,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';

// Общие примитивы для процедурных мягких игрушек. Геометрия переиспользуется,
// а характер модели задают масштаб, локальные якоря деталей и материал.
const sphereGeometries = new Map();
const capsuleGeometries = new Map();
const tubeMaterials = new Map();

function sphereGeometry(detail = 'body') {
  if (!sphereGeometries.has(detail)) {
    const segments = detail === 'small' ? [12, 9] : detail === 'face' ? [16, 12] : [22, 16];
    sphereGeometries.set(detail, new SphereGeometry(1, ...segments));
  }
  return sphereGeometries.get(detail);
}

function capsuleGeometry(radius, length, detail = 8) {
  const key = `${radius}:${length}:${detail}`;
  if (!capsuleGeometries.has(key)) {
    capsuleGeometries.set(key, new CapsuleGeometry(radius, length, 5, detail));
  }
  return capsuleGeometries.get(key);
}

export function plushEllipsoid(material, scale, position = [0, 0, 0], options = {}) {
  const mesh = new Mesh(sphereGeometry(options.detail), material);
  mesh.scale.set(...scale);
  mesh.position.set(...position);
  if (options.rotation) mesh.rotation.set(...options.rotation);
  if (options.name) mesh.name = options.name;
  return mesh;
}

export function plushCapsule(material, radius, length, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const mesh = new Mesh(capsuleGeometry(radius, length), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.scale.set(...scale);
  return mesh;
}

export function makeButtonEyePair(darkMaterial, glintMaterial, options = {}) {
  const {
    y = 0,
    z = 0,
    dx = 0.05,
    radius = 0.019,
    glint = 0.006,
  } = options;
  const group = new Group();
  for (const sx of [-1, 1]) {
    const eye = plushEllipsoid(darkMaterial, [radius, radius * 1.05, radius * 0.72], [sx * dx, y, z], { detail: 'small' });
    const shine = plushEllipsoid(
      glintMaterial,
      [glint, glint, glint * 0.65],
      [sx * dx + glint * 0.52, y + glint * 0.62, z + radius * 0.68],
      { detail: 'small' }
    );
    group.add(eye, shine);
  }
  return group;
}

export function makeCheekPair(material, options = {}) {
  const { y = 0, z = 0, dx = 0.075, scale = 1 } = options;
  const group = new Group();
  for (const sx of [-1, 1]) {
    group.add(plushEllipsoid(
      material,
      [0.025 * scale, 0.014 * scale, 0.007 * scale],
      [sx * dx, y, z],
      { detail: 'small' }
    ));
  }
  return group;
}

export function makeStitchPath(material, points, options = {}) {
  const { count = 5, radius = 0.004, length = 0.018 } = options;
  const group = new Group();
  if (points.length < 2) return group;
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)));
  const axis = new Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : (i + 0.5) / count;
    const p = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const stitch = new Mesh(capsuleGeometry(radius, length, 6), material);
    stitch.position.copy(p);
    stitch.quaternion.setFromUnitVectors(axis, tangent);
    group.add(stitch);
  }
  return group;
}

export function makeSmile(material, options = {}) {
  const { y = 0, z = 0, width = 0.05, drop = 0.018, radius = 0.003 } = options;
  const points = [
    new Vector3(-width, y + drop * 0.25, z),
    new Vector3(0, y - drop, z + 0.002),
    new Vector3(width, y + drop * 0.25, z),
  ];
  const curve = new CatmullRomCurve3(points);
  const key = `${material.color?.getHex?.() ?? 'dark'}:${radius}`;
  if (!tubeMaterials.has(key)) tubeMaterials.set(key, material);
  return new Mesh(new TubeGeometry(curve, 16, radius, 5, false), tubeMaterials.get(key));
}

export function makeStarPatch(material, radius = 0.045) {
  const shape = new Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const mesh = new Mesh(new ShapeGeometry(shape), material);
  mesh.material.side = DoubleSide;
  return mesh;
}
