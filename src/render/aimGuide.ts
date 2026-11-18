import * as THREE from 'three';
import type { CourtSpec } from '../config';
import type { BodyKind } from '../physics/world';
import { predictFlight, releasePoint, type Aim } from '../physics/shot';

export type GuideMode = 'off' | 'short' | 'full';

const MAX_DOTS = 70;

/** Seta de direção no piso + pontilhado da parábola (parcial ou completo). */
export class AimGuide {
  readonly group = new THREE.Group();
  private readonly arrow: THREE.Mesh;
  private readonly arrowMat: THREE.MeshBasicMaterial;
  private readonly dots: THREE.InstancedMesh;
  private readonly dotMat: THREE.MeshBasicMaterial;
  private readonly landing: THREE.Mesh;
  private readonly landingMat: THREE.MeshBasicMaterial;
  private last = '';
  private time = 0;

  constructor() {
    const shape = new THREE.Shape();
    shape.moveTo(-0.035, 0);
    shape.lineTo(0.035, 0);
    shape.lineTo(0.035, 0.82);
    shape.lineTo(0.11, 0.82);
    shape.lineTo(0, 1);
    shape.lineTo(-0.11, 0.82);
    shape.lineTo(-0.035, 0.82);
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2); // aponta para -z
    this.arrowMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false });
    this.arrow = new THREE.Mesh(g, this.arrowMat);
    this.arrow.renderOrder = 4;
    this.dotMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false });
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 8, 6), this.dotMat, MAX_DOTS);
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    this.landingMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false });
    this.landing = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.12, 40).rotateX(-Math.PI / 2), this.landingMat);
    this.landing.renderOrder = 4;
    this.group.add(this.arrow, this.dots, this.landing);
  }

  setColor(color: string): void {
    this.arrowMat.color.set(color).lerp(new THREE.Color('#ffffff'), 0.35);
    this.dotMat.color.set('#ffffff');
    this.landingMat.color.set(color).lerp(new THREE.Color('#ffffff'), 0.5);
  }

  hide(): void {
    this.group.visible = false;
  }

  update(aim: Aim, court: CourtSpec, kind: BodyKind, mode: GuideMode, dt: number): void {
    this.group.visible = true;
    this.time += dt;
    const key = `${aim.x0.toFixed(4)}|${aim.yaw.toFixed(4)}|${aim.arc.toFixed(3)}|${aim.power.toFixed(4)}|${mode}|${kind}|${court.length}|${court.width}`;
    const rp = releasePoint(aim, court);
    const yaw = (aim.yaw * Math.PI) / 180;
    // seta no piso: começa na linha de arremesso, comprimento ~ força
    const len = 0.6 + aim.power * 2.6;
    this.arrow.position.set(rp.x + Math.sin(yaw) * 0.05, 0.006, rp.z);
    this.arrow.rotation.set(0, -yaw, 0);
    this.arrow.scale.set(1, 1, len);
    this.arrowMat.opacity = 0.55 + 0.25 * Math.sin(this.time * 4);
    if (key === this.last) return;
    this.last = key;
    if (mode === 'off') {
      this.dots.count = 0;
      this.landing.visible = false;
      return;
    }
    const f = predictFlight(aim, court, kind, 4);
    const pts = f.points;
    const total = pts.length / 3;
    // modo curto: só o começo da parábola (habilidade continua importando)
    const show = mode === 'full' ? total : Math.max(4, Math.floor(total * 0.42));
    const step = Math.max(1, Math.ceil(show / MAX_DOTS));
    const m = new THREE.Matrix4();
    let n = 0;
    for (let i = 1; i < show && n < MAX_DOTS; i += step) {
      const s = mode === 'short' ? 1 - (i / show) * 0.55 : 1;
      m.makeScale(s, s, s).setPosition(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
      this.dots.setMatrixAt(n++, m);
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
    this.landing.visible = mode === 'full' && f.landing !== null;
    if (f.landing) this.landing.position.set(f.landing.x, 0.006, f.landing.z);
  }
}
