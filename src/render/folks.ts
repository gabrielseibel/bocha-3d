import * as THREE from 'three';
import type { CourtSpec } from '../config';
import { clamp, damp } from '../util/math';
import { Rng } from '../util/rng';
import { randomLook, type BoneName, type Character, type CharacterKit } from './characters';
import { TEAM_SHIRT } from './people';

// Torcida feita com os personagens do Blender, nas poses que aparecem nas
// fotos de canchas: apoiados no peitoril com os antebraços, de cerveja na mão,
// braços cruzados, mãos na cintura. No peitoril ficam garrafas, copos e o
// chimarrão; no fundo, jogadores das duas equipes esperando a vez.

type Rot = [number, number, number];
type PoseDef = Partial<Record<BoneName, Rot>>;

const mirror = (r: Rot): Rot => [r[0], -r[1], -r[2]];

function sym(def: Record<string, Rot>): PoseDef {
  const out: PoseDef = {};
  for (const [k, v] of Object.entries(def)) {
    if (k.endsWith('.L')) {
      out[k as BoneName] = v;
      out[(k.slice(0, -2) + '.R') as BoneName] = mirror(v);
    } else out[k as BoneName] = v;
  }
  return out;
}

/** apoiado no peitoril; `s` = inclinação do tronco (ajustada para as mãos caírem no peitoril) */
function leanPose(s: number): PoseDef {
  return sym({
    spine: [s * 0.55, 0, 0],
    chest: [s * 0.45, 0, 0],
    neck: [-s * 0.3, 0, 0],
    head: [-s * 0.35, 0, 0],
    'upper_arm.L': [-0.95 + s * 0.2, 0, -0.18],
    'forearm.L': [-0.85, 0, -0.42],
  });
}

const STAND = sym({ 'upper_arm.L': [0.04, 0, 0.07], 'forearm.L': [-0.18, 0, 0] });
const HIPS = sym({ 'upper_arm.L': [0.15, 0, 0.55], 'forearm.L': [-0.25, 0, -1.35] });
const CROSSED = sym({ 'upper_arm.L': [-0.35, 0, -0.18], 'forearm.L': [-1.55, 0, -0.95], head: [0.05, 0, 0] });
const CHEER = sym({ spine: [-0.05, 0, 0], head: [-0.2, 0, 0], 'upper_arm.L': [-2.75, 0, 0.3], 'forearm.L': [-0.35, 0, 0] });

interface Fan {
  c: Character;
  base: PoseDef;
  /** objeto na mão direita (garrafa), se houver */
  prop?: THREE.Object3D;
  phase: number;
  cheer: number;
  cheerT: number;
  look: number;
  lookT: number;
  baseYaw: number;
}

const BONES: BoneName[] = ['spine', 'chest', 'neck', 'head', 'upper_arm.L', 'forearm.L', 'upper_arm.R', 'forearm.R', 'hand.L', 'hand.R'];

export class KitCrowd {
  readonly group = new THREE.Group();
  private readonly kit: CharacterKit;
  private fans: Fan[] = [];
  private readonly props = new THREE.Group();
  private time = 0;

  constructor(kit: CharacterKit) {
    this.kit = kit;
    this.group.add(this.props);
  }

  private clear(): void {
    for (const f of this.fans) {
      f.c.root.removeFromParent();
      f.c.dispose();
    }
    this.fans = [];
    this.props.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.props.clear();
  }

  layout(spec: CourtSpec, count: number): void {
    this.clear();
    const rng = new Rng(4321);
    const { length: L, width: W } = spec;
    const rail = spec.sideWallHeight + 0.06;
    // primeira fila apoiada, segunda fila em pé
    const leaners = Math.round(count * 0.7);
    const slots: { x: number; z: number; side: number; row: number }[] = [];
    for (const side of [-1, 1]) {
      let z = -rng.range(1.6, 2.6);
      while (z > -L + 1.4) {
        slots.push({ x: side * (W / 2 + 0.5), z, side, row: 0 });
        z -= rng.range(0.75, 1.35);
      }
    }
    shuffle(slots, rng);
    const front = slots.slice(0, leaners);
    const back: typeof slots = [];
    for (let i = 0; i < count - leaners; i++) {
      const side = i % 2 ? 1 : -1;
      back.push({ x: side * (W / 2 + 1.1), z: -rng.range(2, L - 2), side, row: 1 });
    }
    for (const s of [...front, ...back]) {
      const c = this.kit.create(Math.floor(rng.next() * this.kit.variants.length), randomLook(rng));
      const yaw = s.side > 0 ? -Math.PI / 2 : Math.PI / 2;
      c.root.rotation.y = yaw + rng.range(-0.15, 0.15);
      c.root.position.set(s.x, 0, s.z);
      this.group.add(c.root);
      let base: PoseDef;
      let prop: THREE.Object3D | undefined;
      if (s.row === 0) {
        base = this.fitLean(c, rail, s, W);
        if (rng.next() < 0.3) {
          // segura a garrafa em pé no peitoril
          base = { ...base, 'forearm.R': [-1.35, 0, 0.15] };
          prop = bottle(rng);
        }
      } else {
        base = rng.pick([STAND, HIPS, CROSSED, STAND]);
        if (base === STAND && rng.next() < 0.6) {
          base = { ...base, 'upper_arm.R': [-0.25, 0, -0.05], 'forearm.R': [-1.5, 0, 0.1] };
          prop = bottle(rng);
        }
      }
      if (prop) c.bone('hand.R').add(prop);
      const fan: Fan = { c, base, prop, phase: rng.range(0, 10), cheer: 0, cheerT: 0, look: 0, lookT: rng.range(0, 4), baseYaw: c.root.rotation.y };
      this.apply(fan, 0);
      this.fans.push(fan);
      // no peitoril: garrafas, copos, chimarrão
      if (s.row === 0 && rng.next() < 0.55) this.railProp(rng, s.x - s.side * 0.38, rail - 0.01, s.z + rng.range(-0.45, 0.45));
    }
    this.waitingPlayers(spec, rng);
  }

  /** acha a inclinação que deixa os antebraços sobre o peitoril e encosta a pessoa nele */
  private fitLean(c: Character, rail: number, s: { x: number; z: number; side: number }, W: number): PoseDef {
    const hand = new THREE.Vector3();
    const handL = new THREE.Vector3();
    let lo = 0;
    let hi = 1.1;
    let pose = leanPose(0.5);
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      pose = leanPose(mid);
      this.applyPose(c, pose);
      c.root.updateMatrixWorld(true);
      c.bone('forearm.R').getWorldPosition(hand);
      c.bone('hand.R').getWorldPosition(handL);
      const y = (hand.y + handL.y) / 2;
      if (y > rail + 0.03) lo = mid;
      else hi = mid;
    }
    // aproxima/afasta da mureta para as mãos ficarem em cima do peitoril
    c.bone('hand.R').getWorldPosition(hand);
    const target = s.side * (W / 2 + 0.12);
    c.root.position.x += clamp(target - hand.x, -0.35, 0.35);
    return pose;
  }

  private applyPose(c: Character, p: PoseDef, extra?: PoseDef, k = 0): void {
    for (const b of BONES) {
      const a = p[b] ?? [0, 0, 0];
      const e = extra?.[b] ?? a;
      c.rotate(b, a[0] + (e[0] - a[0]) * k, a[1] + (e[1] - a[1]) * k, a[2] + (e[2] - a[2]) * k);
    }
  }

  private apply(f: Fan, dt: number): void {
    const t = this.time + f.phase;
    const breath = Math.sin(t * 1.7) * 0.025;
    const p: PoseDef = { ...f.base };
    const ch = p.chest ?? [0, 0, 0];
    p.chest = [ch[0] + breath, ch[1], ch[2]];
    const hd = p.head ?? [0, 0, 0];
    p.head = [hd[0], hd[1] + f.look, hd[2]];
    this.applyPose(f.c, p, CHEER, f.cheer);
    f.c.setHipsOffset(Math.abs(Math.sin(t * 9)) * 0.05 * f.cheer);
    void dt;
  }

  cheer(intensity: number): void {
    for (const f of this.fans) if (Math.random() < 0.3 + intensity * 0.6) f.cheerT = 0.9 + Math.random() * 1.1;
  }

  update(dt: number): void {
    this.time += dt;
    for (const f of this.fans) {
      if (f.cheerT > 0) f.cheerT -= dt;
      f.cheer = damp(f.cheer, f.cheerT > 0 ? 1 : 0, 7, dt);
      // de vez em quando vira a cabeça para olhar a jogada
      f.lookT -= dt;
      if (f.lookT <= 0) {
        f.lookT = 2 + Math.random() * 5;
        f.look = (Math.random() - 0.5) * 0.9;
      }
      this.apply(f, dt);
    }
  }

  private railProp(rng: Rng, x: number, y: number, z: number): void {
    const r = rng.next();
    let o: THREE.Object3D;
    if (r < 0.45) o = bottle(rng);
    else if (r < 0.7) {
      o = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.1, 10).translate(0, 0.05, 0), new THREE.MeshStandardMaterial({ color: rng.pick(['#f4f4f0', '#c62828', '#f1c232']), roughness: 0.5 }));
    } else o = chimarrao(rng);
    o.position.set(x, y, z);
    o.rotation.y = rng.range(0, Math.PI * 2);
    o.traverse((m) => ((m as THREE.Mesh).castShadow = true));
    this.props.add(o);
  }

  /** jogadores das duas equipes esperando atrás do fundo da cancha */
  private waitingPlayers(spec: CourtSpec, rng: Rng): void {
    const { length: L, width: W } = spec;
    const xs = [-W / 2 + 0.3, -W / 2 + 1.25, W / 2 - 1.25, W / 2 - 0.3];
    xs.forEach((x, i) => {
      const team = i < 2 ? 'blue' : 'red';
      const look = { ...randomLook(rng, TEAM_SHIRT[team]), forearm: '' };
      look.forearm = look.skin;
      const c = this.kit.create(Math.floor(rng.next() * this.kit.variants.length), look);
      c.root.position.set(x, 0, -L - 0.8 - rng.range(0, 0.3));
      c.root.rotation.y = rng.range(-0.3, 0.3);
      this.group.add(c.root);
      const fan: Fan = { c, base: rng.pick([HIPS, CROSSED, STAND]), phase: rng.range(0, 10), cheer: 0, cheerT: 0, look: 0, lookT: rng.range(0, 3), baseYaw: c.root.rotation.y };
      this.apply(fan, 0);
      this.fans.push(fan);
    });
  }
}

function shuffle<T>(a: T[], rng: Rng): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

const glass = new THREE.MeshStandardMaterial({ color: '#4a2a10', roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.92 });
const label = new THREE.MeshStandardMaterial({ color: '#f2d27a', roughness: 0.6 });

/** garrafa de cerveja (600 ml) */
function bottle(rng: Rng): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.19, 12).translate(0, 0.095, 0), glass);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.034, 0.1, 10).translate(0, 0.24, 0), glass);
  const lab = new THREE.Mesh(new THREE.CylinderGeometry(0.0365, 0.0365, 0.07, 12).translate(0, 0.09, 0), label);
  g.add(body, neck, lab);
  if (rng.next() < 0.3) {
    // isopor ("camisinha") de cerveja
    const cozy = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.2, 12).translate(0, 0.1, 0), new THREE.MeshStandardMaterial({ color: rng.pick(['#f4f4f0', '#1f3b70', '#2b2b2b']), roughness: 0.9 }));
    g.add(cozy);
  }
  return g;
}

/** chimarrão: garrafa térmica + cuia com bomba */
function chimarrao(rng: Rng): THREE.Object3D {
  const g = new THREE.Group();
  const thermos = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.3, 14).translate(0, 0.15, 0), new THREE.MeshStandardMaterial({ color: rng.pick(['#c0c4c8', '#2f6b3f', '#1d1d1f', '#8a2a2a']), roughness: 0.35, metalness: 0.5 }));
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.05, 12).translate(0, 0.325, 0), new THREE.MeshStandardMaterial({ color: '#202020', roughness: 0.5 }));
  const cuia = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.7).rotateX(Math.PI).translate(0.12, 0.05, 0), new THREE.MeshStandardMaterial({ color: '#6b4a22', roughness: 0.8 }));
  const erva = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12).rotateX(-Math.PI / 2).translate(0.12, 0.085, 0), new THREE.MeshStandardMaterial({ color: '#5d7d2a', roughness: 1 }));
  const bomba = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.17).rotateZ(0.25).translate(0.135, 0.13, 0), new THREE.MeshStandardMaterial({ color: '#d9d9d9', roughness: 0.2, metalness: 0.9 }));
  g.add(thermos, lid, cuia, erva, bomba);
  return g;
}
