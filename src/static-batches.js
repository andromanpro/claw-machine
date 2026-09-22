import { Mesh } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Combine only opaque, stationary siblings. Their exact geometry, normals,
// materials and shadow settings are retained; animated parts keep their nodes.
export function batchStaticMeshes(root, excluded = []) {
  const protectedMeshes = new Set(excluded);
  const groups = new Map();
  for (const mesh of root.children) {
    const material = mesh.material;
    if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || mesh.children.length || protectedMeshes.has(mesh)
      || !mesh.visible || mesh.userData.action || Array.isArray(material)
      || material.transparent || material.transmission > 0
      || mesh.customDepthMaterial || mesh.customDistanceMaterial
      || mesh.geometry.drawRange.count !== Infinity
      || Object.keys(mesh.geometry.morphAttributes).length) continue;
    mesh.updateMatrix();
    if (mesh.matrix.determinant() <= 0) continue;
    const attributes = Object.entries(mesh.geometry.attributes)
      .map(([name, value]) => `${name}:${value.itemSize}:${value.normalized}:${value.array.constructor.name}`).sort().join(',');
    const key = [material.uuid, mesh.castShadow, mesh.receiveShadow, mesh.renderOrder,
      mesh.layers.mask, Boolean(mesh.geometry.index), attributes].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mesh);
  }

  let meshesRemoved = 0;
  let batches = 0;
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const pieces = meshes.map(mesh => mesh.geometry.clone().applyMatrix4(mesh.matrix));
    const geometry = mergeGeometries(pieces, false);
    pieces.forEach(piece => piece.dispose());
    if (!geometry) continue;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const first = meshes[0];
    const merged = new Mesh(geometry, first.material);
    merged.name = `static-cabinet-batch-${batches}`;
    merged.castShadow = first.castShadow;
    merged.receiveShadow = first.receiveShadow;
    merged.renderOrder = first.renderOrder;
    merged.layers.mask = first.layers.mask;
    merged.matrixAutoUpdate = false;
    root.remove(...meshes);
    root.add(merged);
    meshesRemoved += meshes.length - 1;
    batches += 1;
  }
  return { batches, meshesRemoved };
}
