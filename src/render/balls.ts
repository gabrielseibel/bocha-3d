import * as THREE from 'three';
import { BALL, BOLIM } from '../config';
import type { Body, Team, World } from '../physics/world';
import { damp } from '../util/math';
import { ballTexture, bolimTexture, radialTexture } from './textures';

interface View {
  id: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  shadow: THREE.Mesh;
  shadowMat: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  highlight: number;
  targetHighlight: number;
  fade: number;
  r: number;
}

export const TEAM_COLOR: Record<Team, string> = { blue: '#1d5fd1', red: '#d0262b' };

/** Malhas das bolas sincronizadas com o mundo físico. */
export class BallViews {
  readonly group = new THREE.Group();
  private views = new Map<number, View>();
  private readonly ballGeo: THREE.SphereGeometry;
  private readonly bolimGeo: THREE.SphereGeometry;
  private readonly shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly ringGeo = new THREE.RingGeometry(0.78, 1, 48).rotateX(-Math.PI / 2);
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly baseMats: Record<Team | 'bolim', THREE.MeshStandardMaterial>;
  private time = 0;

  constructor(detail: 'high' | 'medium' | 'low') {
    const seg = detail === 'high' ? 40 : detail === 'medium' ? 30 : 22;
    this.ballGeo = new THREE.SphereGeometry(BALL.r, seg, Math.round(seg * 0.66));
    this.bolimGeo = new THREE.SphereGeometry(BOLIM.r, 24, 16);
    const shadowTex = radialTexture([
      [0, 'rgba(0,0,0,0.75)'],
      [0.35, 'rgba(0,0,0,0.45)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    this.shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.6 });
    this.baseMats = {
      blue: new THREE.MeshStandardMaterial({ map: ballTexture('#1d5fd1', '#0c2f6e', '#7fb2ff', 3), roughness: 0.26, metalness: 0.08 }),
      red: new THREE.MeshStandardMaterial({ map: ballTexture('#d0262b', '#6e0f12', '#ff9a8a', 2), roughness: 0.26, metalness: 0.08 }),
      bolim: new THREE.MeshStandardMaterial({ map: bolimTexture(), roughness: 0.3, metalness: 0.02 }),
    };
  }

  /** bola "na mão" do jogador (não pertence à física) */
  makeHeldBall(team: Team | 'bolim'): THREE.Mesh {
    const m = new THREE.Mesh(team === 'bolim' ? this.bolimGeo : this.ballGeo, this.baseMats[team]);
    m.castShadow = true;
    return m;
  }

  private create(b: Body): View {
    const key = b.kind === 'bolim' ? 'bolim' : (b.team as Team);
    const mat = this.baseMats[key].clone();
    const mesh = new THREE.Mesh(b.kind === 'bolim' ? this.bolimGeo : this.ballGeo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const shadowMat = this.shadowMat.clone();
    const shadow = new THREE.Mesh(this.shadowGeo, shadowMat);
    shadow.renderOrder = 1;
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffd54a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.visible = false;
    ring.renderOrder = 2;
    this.group.add(mesh, shadow, ring);
    return { id: b.id, mesh, mat, shadow, shadowMat, ring, ringMat, highlight: 0, targetHighlight: 0, fade: 1, r: b.r };
  }

  private destroy(v: View): void {
    this.group.remove(v.mesh, v.shadow, v.ring);
    v.mat.dispose();
    v.ringMat.dispose();
    v.shadowMat.dispose();
  }

  sync(world: World, dt: number): void {
    this.time += dt;
    const seen = new Set<number>();
    const q = new THREE.Quaternion();
    for (const b of world.bodies) {
      seen.add(b.id);
      let v = this.views.get(b.id);
      if (!v) {
        v = this.create(b);
        this.views.set(b.id, v);
      }
      if (b.active) {
        v.mesh.position.set(b.px, b.py, b.pz);
        q.set(b.qx, b.qy, b.qz, b.qw);
        // a orientação da física começa na identidade; compõe com uma variação
        // por bola para que não pareçam clonadas
        v.mesh.quaternion.copy(q).multiply(seedRot(b.id));
      }
      // bola anulada some aos poucos
      const targetFade = b.dead ? 0 : 1;
      v.fade = damp(v.fade, targetFade, b.dead ? 2.2 : 10, dt);
      const transparent = v.fade < 0.99;
      v.mat.transparent = transparent;
      v.mat.opacity = v.fade;
      v.mat.depthWrite = !transparent;
      v.mesh.visible = v.fade > 0.02;
      // sombra de contato: menor e mais fraca quanto mais alta a bola
      const h = Math.max(0, b.py - b.r);
      const s = b.r * 3.1 * (1 + h * 0.55);
      v.shadow.position.set(b.px, 0.003, b.pz);
      v.shadow.scale.set(s, 1, s);
      v.shadow.visible = v.mesh.visible;
      v.shadowMat.opacity = (0.75 / (1 + h * 2.2)) * v.fade;
      // destaque (bola com o ponto / bolas que pontuaram)
      v.highlight = damp(v.highlight, v.targetHighlight, 6, dt);
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 5.5 + b.id);
      v.ring.visible = v.highlight > 0.02 && v.mesh.visible;
      v.ring.position.set(b.px, 0.006, b.pz);
      const rs = b.r * (1.6 + 0.35 * pulse) * (0.6 + 0.4 * v.highlight);
      v.ring.scale.set(rs, 1, rs);
      v.ringMat.opacity = v.highlight * (0.45 + 0.4 * pulse);
      v.mat.emissive.setRGB(0.12 * v.highlight * pulse, 0.1 * v.highlight * pulse, 0.02 * v.highlight * pulse);
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        this.destroy(v);
        this.views.delete(id);
      }
    }
  }

  setHighlights(ids: readonly number[], color = '#ffd54a'): void {
    for (const v of this.views.values()) {
      const on = ids.includes(v.id);
      v.targetHighlight = on ? 1 : 0;
      if (on) v.ringMat.color.set(color);
    }
  }

  clear(): void {
    for (const v of this.views.values()) this.destroy(v);
    this.views.clear();
  }

  meshOf(id: number): THREE.Mesh | undefined {
    return this.views.get(id)?.mesh;
  }
}

const seedCache = new Map<number, THREE.Quaternion>();
function seedRot(id: number): THREE.Quaternion {
  let q = seedCache.get(id);
  if (!q) {
    q = new THREE.Quaternion().setFromEuler(new THREE.Euler(id * 1.7, id * 2.3, id * 0.9));
    seedCache.set(id, q);
  }
  return q;
}
