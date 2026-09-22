import {
  DoubleSide,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Raycaster,
  RingGeometry,
  Vector2,
  Vector3,
} from 'three';
import * as CANNON from 'cannon-es';

// Физическое перетаскивание только уже выданных призов на полу зала.
// Внутренняя куча намеренно не участвует в raycast.
export class PrizeDrag {
  constructor({ scene, world, camera, renderer, controls, toys, floorY, minZ, stand = null }) {
    this.world = world;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.toys = toys;
    this.floorY = floorY;
    this.minZ = minZ;
    this.stand = stand;

    this.raycaster = new Raycaster();
    this.pointer = new Vector2();
    this.dragPlane = new Plane(new Vector3(0, 1, 0), -floorY);
    this.target = new Vector3();
    this.hitPoint = new Vector3();
    this.active = null;
    this.hoverToy = null;

    this.anchor = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
    this.anchor.collisionFilterGroup = 0;
    this.anchor.collisionFilterMask = 0;
    this.world.addBody(this.anchor);

    this.markerMat = new MeshBasicMaterial({
      color: 0xffc247,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: DoubleSide,
    });
    this.marker = new Mesh(new RingGeometry(0.72, 1, 48), this.markerMat);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = floorY + 0.026;
    this.marker.visible = false;
    this.marker.renderOrder = 5;
    scene.add(this.marker);

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    // Capture нужен для touch: попадание по призу перехватываем раньше OrbitControls,
    // а касание пустого места пропускаем и камера продолжает вращаться как обычно.
    renderer.domElement.addEventListener('pointerdown', this.onPointerDown, { passive: false, capture: true });
    renderer.domElement.addEventListener('pointermove', this.onPointerMove, { passive: false, capture: true });
    window.addEventListener('pointerup', this.onPointerUp, { passive: false });
    window.addEventListener('pointercancel', this.onPointerUp, { passive: false });
  }

  floorToys() {
    return this.toys.toys.filter((toy) =>
      toy.onFloor
      && !toy.deliver
      && !toy.autoTransferring
      && (!toy.onStand || this.stand?.enabled !== false)
      && toy.body?.world
    );
  }

  setPointer(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  pick(e) {
    this.setPointer(e);
    let best = null;
    for (const toy of this.floorToys()) {
      const hit = this.raycaster.intersectObject(toy.mesh, true)[0];
      if (hit && (!best || hit.distance < best.hit.distance)) best = { toy, hit };
    }
    return best;
  }

  updateTarget(e) {
    this.setPointer(e);
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.hitPoint)) return;
    this.target.copy(this.hitPoint);
    this.target.x = MathUtils.clamp(this.target.x, -3.2, 3.2);
    this.target.z = MathUtils.clamp(this.target.z, this.minZ, 4.4);
  }

  onPointerDown(e) {
    if (this.active) {
      if (e.pointerType !== 'mouse') {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }
    const pointerSupported = e.pointerType === 'mouse'
      ? e.button === 0
      : (e.pointerType === 'touch' || e.pointerType === 'pen') && e.isPrimary;
    if (!pointerSupported) return;
    const picked = this.pick(e);
    if (!picked) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    const { toy, hit } = picked;
    this.stand?.beginDrag(toy);
    const body = toy.body;
    const oldCollisionFilterMask = body.collisionFilterMask;
    // Во время ручного переноса полки не должны цеплять игрушку между ярусами.
    // Остальные столкновения вернутся сразу после отпускания.
    body.collisionFilterMask &= ~8;
    body.wakeUp();

    const worldHit = new CANNON.Vec3(hit.point.x, hit.point.y, hit.point.z);
    const pivot = body.pointToLocalFrame(worldHit, new CANNON.Vec3());
    this.anchor.position.copy(worldHit);
    this.anchor.velocity.set(0, 0, 0);

    const constraint = new CANNON.PointToPointConstraint(
      body,
      pivot,
      this.anchor,
      new CANNON.Vec3(0, 0, 0),
      190
    );
    this.world.addConstraint(constraint);

    const dragY = Math.max(hit.point.y + 0.1, this.floorY + toy.r + 0.12);
    this.dragPlane.setFromNormalAndCoplanarPoint(
      new Vector3(0, 1, 0),
      new Vector3(0, dragY, 0)
    );
    this.target.set(hit.point.x, dragY, Math.max(this.minZ, hit.point.z));
    this.active = {
      id: e.pointerId,
      toy,
      constraint,
      oldLinearDamping: body.linearDamping,
      oldAngularDamping: body.angularDamping,
      oldCollisionFilterMask,
    };
    body.linearDamping = Math.max(body.linearDamping, 0.3);
    body.angularDamping = Math.max(body.angularDamping, 0.72);

    this.renderer.domElement.setPointerCapture?.(e.pointerId);
    this.controls.enabled = false;
    this.markerMat.color.setHex(0x38f5ff);
    this.marker.visible = true;
    if (e.pointerType === 'mouse') this.renderer.domElement.style.cursor = 'grabbing';
    this.updateTarget(e);
  }

  onPointerMove(e) {
    if (this.active) {
      if (e.pointerId !== this.active.id) return;
      e.preventDefault();
      this.updateTarget(e);
      return;
    }
    if (e.pointerType !== 'mouse') return;
    const picked = this.pick(e);
    this.hoverToy = picked?.toy ?? null;
    this.markerMat.color.setHex(0xffc247);
    this.marker.visible = !!this.hoverToy;
    this.renderer.domElement.style.cursor = this.hoverToy ? 'grab' : '';
  }

  release() {
    if (!this.active) return;
    const active = this.active;
    const { toy, constraint, oldLinearDamping, oldAngularDamping, oldCollisionFilterMask } = active;
    this.world.removeConstraint(constraint);
    toy.body.linearDamping = oldLinearDamping;
    toy.body.angularDamping = oldAngularDamping;
    toy.body.collisionFilterMask = oldCollisionFilterMask;
    toy.body.wakeUp();

    const placed = this.stand?.tryPlace(toy, this.anchor.position) ?? false;

    if (!placed) {
      const vx = MathUtils.clamp(this.anchor.velocity.x * 0.62, -4.2, 4.2);
      const vz = MathUtils.clamp(this.anchor.velocity.z * 0.62, -4.2, 4.2);
      toy.body.velocity.set(
        MathUtils.clamp(toy.body.velocity.x + vx, -4.2, 4.2),
        MathUtils.clamp(toy.body.velocity.y + Math.max(0, this.anchor.velocity.y * 0.18), -4.2, 3.2),
        MathUtils.clamp(toy.body.velocity.z + vz, -4.2, 4.2)
      );
    }

    this.active = null;
    this.hoverToy = null;
    this.marker.visible = false;
    this.markerMat.color.setHex(0xffc247);
    this.stand?.preview(null, this.anchor.position);
    this.renderer.domElement.style.cursor = '';
    this.controls.enabled = true;
  }

  onPointerUp(e) {
    if (!this.active || e.pointerId !== this.active.id) return;
    e.preventDefault();
    this.renderer.domElement.releasePointerCapture?.(e.pointerId);
    this.release();
  }

  update(dt) {
    document.body.classList.toggle('has-floor-prize', this.floorToys().some((toy) => !toy.onStand));
    if (this.hoverToy && !this.toys.toys.includes(this.hoverToy)) {
      this.hoverToy = null;
      this.marker.visible = false;
    }
    if (!this.active) {
      if (this.hoverToy) {
        this.marker.position.set(this.hoverToy.body.position.x, this.floorY + 0.026, this.hoverToy.body.position.z);
        this.marker.scale.setScalar(Math.max(0.2, this.hoverToy.r * 1.35));
      }
      return;
    }
    if (!this.toys.toys.includes(this.active.toy)) {
      this.release();
      return;
    }

    const oldX = this.anchor.position.x;
    const oldY = this.anchor.position.y;
    const oldZ = this.anchor.position.z;
    const k = 1 - Math.exp(-18 * dt);
    this.anchor.position.x += (this.target.x - this.anchor.position.x) * k;
    this.anchor.position.y += (this.target.y - this.anchor.position.y) * k;
    this.anchor.position.z += (this.target.z - this.anchor.position.z) * k;
    this.anchor.velocity.set(
      (this.anchor.position.x - oldX) / Math.max(dt, 0.001),
      (this.anchor.position.y - oldY) / Math.max(dt, 0.001),
      (this.anchor.position.z - oldZ) / Math.max(dt, 0.001)
    );
    this.active.toy.body.wakeUp();
    this.stand?.preview(this.active.toy, this.anchor.position);
    this.marker.position.set(this.anchor.position.x, this.floorY + 0.026, this.anchor.position.z);
    this.marker.scale.setScalar(Math.max(0.2, this.active.toy.r * 1.45));
  }
}
