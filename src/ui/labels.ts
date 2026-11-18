import * as THREE from 'three';
import type { Rank } from '../game/rules';
import type { World } from '../physics/world';

const v = new THREE.Vector3();

/** Rótulos flutuantes com a distância de cada bola até o bolim. */
export class Labels {
  private readonly root: HTMLElement;
  private readonly pool = new Map<number, HTMLDivElement>();

  constructor(root: HTMLElement) {
    this.root = root;
  }

  hideAll(): void {
    for (const el of this.pool.values()) el.style.display = 'none';
  }

  update(camera: THREE.Camera, world: World, ranking: Rank[], w: number, h: number, show: boolean): void {
    if (!show) {
      this.hideAll();
      return;
    }
    const used = new Set<number>();
    ranking.forEach((r, i) => {
      const b = world.get(r.id);
      if (!b || !b.active) return;
      v.set(b.px, b.py + b.r + 0.07, b.pz).project(camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) return;
      let el = this.pool.get(r.id);
      if (!el) {
        el = document.createElement('div');
        this.root.appendChild(el);
        this.pool.set(r.id, el);
      }
      used.add(r.id);
      const cm = r.dist * 100;
      const txt = `${i === 0 ? '1º · ' : ''}${cm < 10 ? cm.toFixed(1).replace('.', ',') : Math.round(cm)} cm`;
      if (el.textContent !== txt) el.textContent = txt;
      const cls = `ball-label ${r.team}${i === 0 ? ' first' : ''}`;
      if (el.className !== cls) el.className = cls;
      const x = ((v.x + 1) / 2) * w;
      const y = ((1 - v.y) / 2) * h;
      el.style.display = 'block';
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      el.style.zIndex = String(100 - i);
    });
    for (const [id, el] of this.pool) {
      if (!used.has(id)) {
        if (!world.get(id)) {
          el.remove();
          this.pool.delete(id);
        } else el.style.display = 'none';
      }
    }
  }
}
