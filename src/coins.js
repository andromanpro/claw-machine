// Анимация монетки: падает с кувырком к прорези и въезжает внутрь
import {
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
} from 'three';

const DUR = 0.9;

export class CoinFX {
  constructor(scene, slotPos) {
    this.scene = scene;
    this.slot = slotPos.clone();
    this.active = [];
    this.geo = new CylinderGeometry(0.065, 0.065, 0.016, 24);
    this.mat = new MeshStandardMaterial({
      color: 0xffd54f, metalness: 1, roughness: 0.22,
      emissive: 0x331f00, emissiveIntensity: 0.5,
    });
  }

  drop(onDone) {
    const m = new Mesh(this.geo, this.mat);
    m.rotation.x = Math.PI / 2; // диск в плоскости XY — ребром к щели
    m.castShadow = true;
    this.scene.add(m);
    this.active.push({ m, t: 0, onDone, spin: 6 + Math.random() * 5 });
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const c = this.active[i];
      c.t += dt / DUR;
      const s = this.slot;
      if (c.t < 0.65) {
        // полёт по дуге к точке перед щелью
        const k = c.t / 0.65;
        c.m.position.set(
          s.x + 0.12 * (1 - k),
          s.y + 0.5 * (1 - k) + Math.sin(k * Math.PI) * 0.1,
          s.z + 0.22 * (1 - k) + 0.05
        );
        c.m.rotation.x += c.spin * dt;
      } else {
        // въезд в щель
        const k = (c.t - 0.65) / 0.35;
        c.m.rotation.x = Math.PI / 2;
        c.m.position.set(s.x, s.y, s.z + 0.05 - 0.12 * k);
        c.m.scale.setScalar(Math.max(0.01, 1 - k * 0.35));
      }
      if (c.t >= 1) {
        this.scene.remove(c.m);
        this.active.splice(i, 1);
        c.onDone?.();
      }
    }
  }
}
