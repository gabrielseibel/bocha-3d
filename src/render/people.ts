import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CourtSpec } from '../config';
import type { Team } from '../physics/world';
import type { ShotStyle } from '../physics/shot';
import { clamp, damp, easeInOutSine, lerp } from '../util/math';
import { Rng } from '../util/rng';

const SKIN = ['#f1c7a5', '#d9a37e', '#b97b52', '#8d5a3b', '#6b4430', '#e8b896'];
const HAIR = ['#2b2420', '#4a3426', '#9a9a96', '#cfcfcb', '#1b1b1b', '#6d5038'];
const SHIRTS = ['#f2f2f0', '#7f8c99', '#24324a', '#c0392b', '#2e7d4f', '#f4d03f', '#1f1f22', '#e67e22', '#3c6e9f', '#8e44ad', '#ffd84d', '#7b5b3a'];
const PANTS = ['#2e3440', '#4a4f57', '#1d2a44', '#6b5b4a', '#2f2f2f', '#c7b896'];

export const TEAM_SHIRT: Record<Team, string> = { blue: '#1f63c6', red: '#cc2b2b' };

function colored(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const g2 = g.index ? g.toNonIndexed() : g;
  const n = g2.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g2.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g2.deleteAttribute('uv');
  return g2;
}

function capsule(r: number, len: number, from: THREE.Vector3, to: THREE.Vector3, color: string): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(r, len, 3, 8);
  const dir = to.clone().sub(from);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const mid = from.clone().add(to).multiplyScalar(0.5);
  g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
  return colored(g, color);
}

function sphere(r: number, at: THREE.Vector3, color: string, sy = 1): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 10, 8);
  g.scale(1, sy, 1);
  g.translate(at.x, at.y, at.z);
  return colored(g, color);
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** torcedor apoiado no peitoril, olhando para +z local */
function spectatorGeometry(rng: Rng): THREE.BufferGeometry {
  const skin = rng.pick(SKIN);
  const shirt = rng.pick(SHIRTS);
  const pants = rng.pick(PANTS);
  const hair = rng.pick(HAIR);
  const lean = rng.range(0.05, 0.22);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(capsule(0.07, 0.62, V(-0.1, 0.08, 0), V(-0.1, 0.84, 0), pants));
  parts.push(capsule(0.07, 0.62, V(0.1, 0.08, 0), V(0.1, 0.84, 0), pants));
  parts.push(colored(new THREE.BoxGeometry(0.12, 0.07, 0.24).translate(-0.1, 0.035, 0.04), '#262626'));
  parts.push(colored(new THREE.BoxGeometry(0.12, 0.07, 0.24).translate(0.1, 0.035, 0.04), '#262626'));
  const hip = V(0, 0.9, 0);
  const neck = V(0, 1.42, lean * 1.1);
  parts.push(capsule(0.17, 0.34, hip, neck, shirt));
  const head = V(0, 1.6, lean * 1.25 + 0.04);
  parts.push(sphere(0.108, head, skin, 1.12));
  if (rng.next() < 0.45) {
    const capColor = rng.pick(['#f2f2f2', '#1f3b70', '#b52222', '#2b2b2b', '#e1c043']);
    const cap = new THREE.SphereGeometry(0.118, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.translate(head.x, head.y + 0.02, head.z);
    parts.push(colored(cap, capColor));
    parts.push(colored(new THREE.BoxGeometry(0.18, 0.015, 0.12).translate(head.x, head.y + 0.03, head.z + 0.12), capColor));
  } else {
    const hairG = new THREE.SphereGeometry(0.113, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.1);
    hairG.translate(head.x, head.y + 0.01, head.z - 0.01);
    parts.push(colored(hairG, hair));
  }
  // braços apoiados no peitoril (que fica à frente, em z ~ +0.32, y ~ 1.0)
  for (const s of [-1, 1]) {
    const sh = V(s * 0.2, 1.36, lean);
    const el = V(s * 0.22, 1.06, 0.2 + lean * 0.4);
    const hand = V(s * 0.12, 1.02, 0.36);
    parts.push(capsule(0.05, 0.2, sh, el, shirt));
    parts.push(capsule(0.042, 0.18, el, hand, skin));
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

interface Spectator {
  mesh: THREE.Mesh;
  base: THREE.Vector3;
  yaw: number;
  phase: number;
  cheer: number;
}

export class Crowd {
  readonly group = new THREE.Group();
  private list: Spectator[] = [];
  private readonly mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  private time = 0;

  layout(spec: CourtSpec, count: number): void {
    for (const s of this.list) {
      s.mesh.geometry.dispose();
      s.mesh.removeFromParent();
    }
    this.list = [];
    const rng = new Rng(1234);
    const { length: L, width: W } = spec;
    const slots: { x: number; z: number; yaw: number }[] = [];
    for (const side of [-1, 1]) {
      let z = -rng.range(1.2, 2.5);
      while (z > -L + 1.2) {
        if (rng.next() < 0.62) slots.push({ x: side * (W / 2 + 0.47), z, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
        z -= rng.range(0.62, 1.5);
      }
    }
    // embaralha e pega os primeiros
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    for (const s of slots.slice(0, count)) {
      const mesh = new THREE.Mesh(spectatorGeometry(rng), this.mat);
      mesh.position.set(s.x, 0, s.z);
      mesh.rotation.y = s.yaw + rng.range(-0.2, 0.2);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.list.push({ mesh, base: mesh.position.clone(), yaw: mesh.rotation.y, phase: rng.range(0, 10), cheer: 0 });
    }
  }

  /** torcida comemora: intensidade 0..1 */
  cheer(intensity: number): void {
    for (const s of this.list) if (Math.random() < 0.35 + intensity * 0.6) s.cheer = 0.8 + Math.random() * 0.9;
  }

  update(dt: number): void {
    this.time += dt;
    for (const s of this.list) {
      const t = this.time + s.phase;
      let y = 0;
      if (s.cheer > 0) {
        s.cheer -= dt;
        y = Math.abs(Math.sin(t * 9)) * 0.09 * clamp(s.cheer, 0, 1);
      }
      s.mesh.position.y = s.base.y + y;
      s.mesh.rotation.y = s.yaw + Math.sin(t * 0.37) * 0.12;
      s.mesh.rotation.z = Math.sin(t * 0.61) * 0.015;
    }
  }
}

// ---------------------------------------------------------------- arremessador

interface Pose {
  pelvis: number; // altura do quadril
  lean: number; // inclinação do tronco (rad, + = para frente)
  armR: number; // braço do arremesso (rad, + = para frente)
  armL: number;
  legL: number; // perna da frente (passada)
  kneeL: number;
  legR: number;
  kneeR: number;
}

const READY: Pose = { pelvis: 0.9, lean: 0.18, armR: 0.25, armL: 0.15, legL: 0.12, kneeL: 0.18, legR: -0.05, kneeR: 0.12 };
/** agachado mirando, bola na mão perto do chão */
const PONTO_READY: Pose = { pelvis: 0.52, lean: 0.72, armR: 0.2, armL: -0.4, legL: 1.05, kneeL: 1.75, legR: -0.15, kneeR: 1.45 };

/** Jogador que faz o arremesso por baixo (pêndulo) — a bola sai no ponto exato da física. */
export class Thrower {
  readonly root = new THREE.Group();
  readonly heldBall = new THREE.Group();
  private readonly pelvis = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly kneeL = new THREE.Group();
  private readonly kneeR = new THREE.Group();
  private readonly shirtMat = new THREE.MeshStandardMaterial({ color: TEAM_SHIRT.blue, roughness: 0.8 });
  private readonly capMat = new THREE.MeshStandardMaterial({ color: TEAM_SHIRT.blue, roughness: 0.7 });
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private pose: Pose = { ...READY };
  private anim: { t: number; release: number; armRel: number; onRelease: (() => void) | null } | null = null;
  private recover = 0;
  private opacity = 1;
  private targetOpacity = 1;
  /** comprimento do braço até o centro da bola */
  private readonly armLen = 0.7;
  private relArm = 0.6;

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: '#d9a37e', roughness: 0.75 });
    const pants = new THREE.MeshStandardMaterial({ color: '#f1f1ee', roughness: 0.85 });
    const shoes = new THREE.MeshStandardMaterial({ color: '#202124', roughness: 0.6 });
    this.materials.push(skin, pants, shoes, this.shirtMat, this.capMat);
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
      const o = new THREE.Mesh(g, m);
      o.castShadow = true;
      return o;
    };
    this.root.add(this.pelvis);
    this.pelvis.add(this.torso);
    // tronco
    const chest = mesh(new THREE.CapsuleGeometry(0.165, 0.36, 4, 10), this.shirtMat);
    chest.position.y = 0.3;
    chest.scale.set(1, 1, 0.78);
    this.torso.add(chest);
    const shorts = mesh(new THREE.CapsuleGeometry(0.16, 0.08, 4, 10), pants);
    shorts.position.y = 0.02;
    this.pelvis.add(shorts);
    const head = mesh(new THREE.SphereGeometry(0.105, 14, 10), skin);
    head.position.set(0, 0.72, -0.02);
    head.scale.set(1, 1.12, 1);
    this.torso.add(head);
    const cap = mesh(new THREE.SphereGeometry(0.113, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.capMat);
    cap.position.set(0, 0.745, -0.02);
    this.torso.add(cap);
    const brim = mesh(new THREE.BoxGeometry(0.17, 0.014, 0.12), this.capMat);
    brim.position.set(0, 0.755, -0.13);
    this.torso.add(brim);
    // braços
    for (const [arm, s] of [
      [this.armR, 1],
      [this.armL, -1],
    ] as const) {
      arm.position.set(s * 0.215, 0.5, 0);
      const upper = mesh(new THREE.CapsuleGeometry(0.05, 0.24, 4, 8), this.shirtMat);
      upper.position.y = -0.15;
      const lower = mesh(new THREE.CapsuleGeometry(0.043, 0.26, 4, 8), skin);
      lower.position.y = -0.45;
      const hand = mesh(new THREE.SphereGeometry(0.05, 10, 8), skin);
      hand.position.y = -0.62;
      arm.add(upper, lower, hand);
      this.torso.add(arm);
    }
    this.heldBall.position.set(0, -this.armLen, -0.035);
    this.armR.add(this.heldBall);
    // pernas
    for (const [leg, knee, s] of [
      [this.legL, this.kneeL, -1],
      [this.legR, this.kneeR, 1],
    ] as const) {
      leg.position.set(s * 0.1, -0.02, 0);
      const thigh = mesh(new THREE.CapsuleGeometry(0.075, 0.3, 4, 8), pants);
      thigh.position.y = -0.21;
      leg.add(thigh);
      knee.position.y = -0.44;
      const shin = mesh(new THREE.CapsuleGeometry(0.06, 0.32, 4, 8), skin);
      shin.position.y = -0.2;
      const shoe = mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24), shoes);
      shoe.position.set(0, -0.42, -0.05);
      knee.add(shin, shoe);
      leg.add(knee);
      this.pelvis.add(leg);
    }
    this.applyPose();
  }

  setTeam(team: Team): void {
    this.shirtMat.color.set(TEAM_SHIRT[team]);
    this.capMat.color.set(TEAM_SHIRT[team]).multiplyScalar(0.8);
  }

  private applyPose(): void {
    const p = this.pose;
    this.pelvis.position.y = p.pelvis;
    this.torso.rotation.x = -p.lean;
    this.armR.rotation.x = p.armR + p.lean;
    this.armL.rotation.x = p.armL + p.lean * 0.6;
    this.legL.rotation.x = p.legL;
    this.kneeL.rotation.x = -p.kneeL;
    this.legR.rotation.x = p.legR;
    this.kneeR.rotation.x = -p.kneeR;
  }

  /** estilo do arremesso atual: ponto (agachado, rente ao chão) ou tiro (corrida, alto) */
  private style: ShotStyle = 'ponto';
  /** deslocamento da corrida do tiro (m para trás do ponto de soltura) */
  private run = 0;

  private readyPose(): Pose {
    return this.style === 'ponto' ? PONTO_READY : READY;
  }

  private releasePose(armRel: number, style = this.style): Pose {
    if (style === 'ponto') {
      // joelho de trás quase no chão, tronco bem inclinado, mão rente ao saibro
      return { pelvis: 0.4, lean: 0.85, armR: armRel, armL: -0.55, legL: 1.2, kneeL: 2.1, legR: -0.25, kneeR: 1.9 };
    }
    return { pelvis: 0.8, lean: 0.32, armR: armRel, armL: -0.5, legL: 0.62, kneeL: 0.5, legR: -0.4, kneeR: 0.3 };
  }

  setStyle(style: ShotStyle): void {
    this.style = style;
  }

  /**
   * Posiciona o jogador para que, no instante da soltura, o centro da bola na mão
   * coincida com o ponto de lançamento da física.
   */
  placeFor(release: { x: number; y: number; z: number }, style: ShotStyle = this.style): void {
    this.style = style;
    const saved = this.pose;
    const savedRun = this.run;
    this.run = 0;
    // altura do ombro na pose de soltura (braço vertical)
    this.pose = this.releasePose(0);
    this.root.position.set(0, 0, 0);
    this.applyPose();
    this.root.updateMatrixWorld(true);
    const sh = new THREE.Vector3();
    this.armR.getWorldPosition(sh);
    const cosA = clamp((sh.y - release.y) / this.armLen, -1, 1);
    // pose.armR é o ângulo absoluto do braço em relação à vertical
    this.relArm = Math.acos(cosA);
    this.pose = this.releasePose(this.relArm);
    this.applyPose();
    this.root.updateMatrixWorld(true);
    const hand = new THREE.Vector3();
    this.heldBall.getWorldPosition(hand);
    this.base.set(release.x - hand.x, 0, release.z - hand.z);
    this.pose = saved;
    this.run = savedRun;
    this.applyPose();
  }

  private readonly base = new THREE.Vector3();

  /** inicia o arremesso; onRelease é chamado no instante da soltura */
  throw(onRelease: () => void): void {
    this.anim = { t: 0, release: this.style === 'ponto' ? 0.95 : 1.05, armRel: this.relArm, onRelease };
    this.recover = 0;
  }

  get busy(): boolean {
    return this.anim !== null && this.anim.onRelease !== null;
  }

  setVisible(v: boolean): void {
    this.targetOpacity = v ? 1 : 0;
  }

  /** deixa o jogador semitransparente (quando a câmera passa perto) */
  setFaded(f: boolean): void {
    this.targetOpacity = f ? 0.25 : 1;
  }

  private animate(a: { t: number; release: number; armRel: number }): void {
    const rel = this.releasePose(a.armRel);
    if (this.style === 'ponto') {
      // agacha, balança o braço para trás rente ao chão e solta a bola rolando
      const crouch: Pose = { ...rel, armR: 0.15, armL: -0.3 };
      const back: Pose = { ...rel, armR: -0.95, armL: 0.25, lean: 0.8 };
      const follow: Pose = { ...rel, armR: a.armRel + 0.75, lean: 0.75, armL: -0.7 };
      const t1 = 0.35;
      const t2 = 0.62;
      if (a.t < t1) this.pose = mix(PONTO_READY, crouch, easeInOutSine(a.t / t1));
      else if (a.t < t2) this.pose = mix(crouch, back, easeInOutSine((a.t - t1) / (t2 - t1)));
      else if (a.t < a.release) this.pose = mix(back, rel, easeInOutSine((a.t - t2) / (a.release - t2)));
      else this.pose = mix(rel, follow, easeInOutSine((a.t - a.release) / 0.4));
      this.run = 0;
      return;
    }
    // tiro: corrida curta, braço lá atrás e soltura alta e forte
    const RUN = 1.15;
    const tRun = 0.62;
    const back: Pose = { pelvis: 0.86, lean: 0.25, armR: -1.6, armL: 0.35, legL: 0.45, kneeL: 0.4, legR: -0.3, kneeR: 0.35 };
    const follow: Pose = { ...rel, armR: Math.min(2.6, a.armRel + 1.0), lean: 0.22, pelvis: 0.84, armL: -0.6 };
    if (a.t < a.release) {
      const k = clamp(a.t / a.release, 0, 1);
      this.run = RUN * (1 - easeInOutSine(k));
      if (a.t < tRun) {
        const stride = Math.sin((a.t / tRun) * Math.PI * 3);
        const base = mix(READY, back, easeInOutSine(a.t / tRun));
        this.pose = { ...base, legL: base.legL + stride * 0.55, legR: base.legR - stride * 0.55, kneeL: base.kneeL + Math.max(0, -stride) * 0.6, kneeR: base.kneeR + Math.max(0, stride) * 0.6, pelvis: base.pelvis + Math.abs(stride) * 0.03 };
      } else this.pose = mix(back, rel, easeInOutSine((a.t - tRun) / (a.release - tRun)));
    } else {
      this.run = 0;
      this.pose = mix(rel, follow, easeInOutSine((a.t - a.release) / 0.35));
    }
  }

  update(dt: number): void {
    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      this.animate(a);
      if (a.onRelease && a.t >= a.release) {
        // pose exata da soltura neste quadro para a bola sair do lugar certo
        this.pose = this.releasePose(a.armRel);
        this.run = 0;
        const cb = a.onRelease;
        a.onRelease = null;
        this.heldBall.visible = false;
        cb();
      }
      if (a.t > a.release + 1.4) {
        this.anim = null;
        this.recover = 1;
      }
    } else {
      // pose de espera (agachado no ponto, em pé no tiro), com transição suave
      this.pose = mix(this.pose, this.readyPose(), 1 - Math.exp(-(this.recover > 0 ? 2.5 : 9) * dt));
      this.recover = Math.max(0, this.recover - dt);
      this.run = 0;
    }
    this.applyPose();
    this.root.position.set(this.base.x, 0, this.base.z + this.run);
    this.opacity = damp(this.opacity, this.targetOpacity, 8, dt);
    const transparent = this.opacity < 0.99;
    for (const m of this.materials) {
      m.transparent = transparent;
      m.opacity = this.opacity;
      m.depthWrite = !transparent;
    }
    this.root.visible = this.opacity > 0.02;
  }

  /** volta à pose de espera (novo turno) */
  reset(): void {
    this.anim = null;
    this.recover = 0;
    this.run = 0;
    this.pose = { ...this.readyPose() };
    this.heldBall.visible = true;
    this.applyPose();
    this.root.position.set(this.base.x, 0, this.base.z);
  }
}

function mix(a: Pose, b: Pose, t: number): Pose {
  return {
    pelvis: lerp(a.pelvis, b.pelvis, t),
    lean: lerp(a.lean, b.lean, t),
    armR: lerp(a.armR, b.armR, t),
    armL: lerp(a.armL, b.armL, t),
    legL: lerp(a.legL, b.legL, t),
    kneeL: lerp(a.kneeL, b.kneeL, t),
    legR: lerp(a.legR, b.legR, t),
    kneeR: lerp(a.kneeR, b.kneeR, t),
  };
}
