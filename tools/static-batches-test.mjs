import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { batchStaticMeshes } from '../src/static-batches.js';

const root = new Group();
const material = new MeshStandardMaterial();
const left = new Mesh(new BoxGeometry(1, 2, 3), material);
left.position.set(-2, 1, 4);
left.rotation.set(.1, .2, .3);
left.scale.set(2, .5, 1);
const right = new Mesh(new BoxGeometry(2, 1, 1), material);
right.position.set(3, 0, -1);
const moving = new Mesh(new BoxGeometry(), material);
const button = new Mesh(new BoxGeometry(), material);
button.userData.action = 'spin';
const transparent = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ transparent: true }));
root.add(left, right, moving, button, transparent);

const expected = [];
for (const mesh of [left, right]) {
  mesh.updateMatrix();
  const positions = mesh.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) expected.push(new Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrix));
}
const count = left.geometry.index.count + right.geometry.index.count;
const result = batchStaticMeshes(root, [moving]);
assert.deepEqual(result, { batches: 1, meshesRemoved: 1 });
assert.equal(moving.parent, root);
assert.equal(button.parent, root);
assert.equal(transparent.parent, root);
const merged = root.children.find(mesh => mesh.name.startsWith('static-cabinet-batch'));
assert.equal(merged.material, material);
assert.equal(merged.geometry.index.count, count);
assert.equal(merged.geometry.attributes.position.count, expected.length);
for (let i = 0; i < expected.length; i++) {
  assert.ok(new Vector3().fromBufferAttribute(merged.geometry.attributes.position, i).distanceTo(expected[i]) < 1e-6);
}
console.log('Static batching preserves geometry and leaves animated, interactive and transparent meshes intact.');
