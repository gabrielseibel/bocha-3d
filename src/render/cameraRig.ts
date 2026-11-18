import * as THREE from 'three';
import type { CourtSpec } from '../config';
import type { World } from '../physics/world';
import { releasePoint, type Aim } from '../physics/shot';
import { clamp, damp } from '../util/math';

export type CamMode = 'menu' | 'aim' | 'follow' | 'settle' | 'bolim' | 'overview' | 'victory';

export interface CamContext {
  world: World;
  court: CourtSpec;
  aim: Aim;
}

const tmp = new THREE.Vector3();

/** Câmera com modos: mira (atrás do jogador), seguir a bola, enquadrar o bolim, visão geral. */
export class CameraRig {
  mode: CamMode = 'menu';
  private readonly cam: THREE.PerspectiveCamera;
  private readonly pip: THREE.PerspectiveCamera;
  private readonly pos = new THREE.Vector3(8, 5, 6);
  private readonly look = new THREE.Vector3(0, 0, -12);
  private fov = 45;
  private readonly tPos = new THREE.Vector3();
  private readonly tLook = new THREE.Vector3();
  private tFov = 45;
  private lambda = 3;
  private followId: number | null = null;
  private time = 0;
  private shake = 0;
  /** órbita controlada pelo usuário nos modos bolim/visão geral */
  readonly orbit = { yaw: 0, pitch: 0.9, dist: 2.8 };
  private readonly overviewOrbit = { yaw: 0, pitch: 0.3, dist: 1 };
  private readonly pipLook = new THREE.Vector3();
  private readonly pipPos = new THREE.Vector3();
  private aspect = 1.6;
  private snapNext = false;
  private pipInit = false;

  constructor(cam: THREE.PerspectiveCamera, pip: THREE.PerspectiveCamera) {
    this.cam = cam;
    this.pip = pip;
  }

  setMode(mode: CamMode, followId: number | null = null, snap = false): void {
    if (mode !== this.mode) {
      if (mode === 'bolim') Object.assign(this.orbit, { yaw: 0, pitch: 0.92, dist: 2.8 });
      if (mode === 'overview') Object.assign(this.overviewOrbit, { yaw: 0, pitch: 0.3, dist: 1 });
    }
    this.mode = mode;
    this.followId = followId;
    if (snap) this.snapNext = true;
  }

  addShake(a: number): void {
    this.shake = Math.min(1, this.shake + a);
  }

  /** usuário arrastando nos modos de inspeção */
  orbitBy(dx: number, dy: number): void {
    const o = this.mode === 'overview' ? this.overviewOrbit : this.orbit;
    o.yaw -= dx * 0.006;
    o.pitch = this.mode === 'overview' ? clamp(o.pitch + dy * 0.004, 0.1, 0.55) : clamp(o.pitch + dy * 0.005, 0.18, 1.45);
  }

  zoomBy(f: number): void {
    if (this.mode === 'overview') this.overviewOrbit.dist = clamp(this.overviewOrbit.dist * f, 0.4, 1.6);
    else this.orbit.dist = clamp(this.orbit.dist * f, 0.8, 9);
  }

  get canOrbit(): boolean {
    return this.mode === 'bolim' || this.mode === 'overview';
  }

  /** FOV vertical que mantém um FOV horizontal mínimo em telas em pé */
  private fitFov(base: number, minH: number): number {
    const a = this.aspect;
    const needV = (2 * Math.atan(Math.tan((minH * Math.PI) / 360) / a) * 180) / Math.PI;
    return clamp(Math.max(base, needV), base, 72);
  }

  update(dt: number, ctx: CamContext): void {
    this.time += dt;
    this.aspect = this.cam.aspect;
    const { world, court, aim } = ctx;
    const bolim = world.bolim;
    const L = court.length;
    const rp = releasePoint(aim, court);
    switch (this.mode) {
      case 'menu': {
        const t = this.time * 0.06;
        const cz = -L * 0.62;
        this.tPos.set(Math.sin(t) * 7.5, 3.1 + Math.sin(t * 0.7) * 0.6, cz + Math.cos(t) * 9);
        this.tLook.set(0, 0.2, cz);
        this.tFov = this.fitFov(42, 50);
        this.lambda = 1.2;
        break;
      }
      case 'victory': {
        const t = this.time * 0.12;
        const cz = bolim ? bolim.pz : -L * 0.7;
        this.tPos.set(Math.sin(t) * 3.2, 1.9, cz + Math.cos(t) * 3.2);
        this.tLook.set(0, 0.1, cz);
        this.tFov = this.fitFov(45, 50);
        this.lambda = 1.5;
        break;
      }
      case 'aim': {
        const bz = bolim ? bolim.pz : -L * 0.62;
        const bx = bolim ? bolim.px : 0;
        // atrás e acima do jogador, deslocada para a direita (visão sobre o ombro)
        this.tPos.set(rp.x + 0.85, 2.6, rp.z + 4.2);
        this.tLook.set(rp.x * 0.35 + bx * 0.45, 0, rp.z + (bz - rp.z) * 0.6);
        this.tFov = this.fitFov(40, 34);
        this.lambda = 4;
        break;
      }
      case 'follow': {
        // câmera "de transmissão": atrás e um pouco acima da bola, sempre com ela no quadro
        const b = this.followId !== null ? world.get(this.followId) : undefined;
        if (!b) break;
        const sp = Math.hypot(b.vx, b.vz);
        const dx = sp > 0.3 ? b.vx / sp : 0;
        const dz = sp > 0.3 ? b.vz / sp : -1;
        const back = 3.0;
        // antecipa pela velocidade para compensar o atraso da suavização
        const lead = 1 / 6;
        this.tPos.set(
          clamp(b.px - dx * back + b.vx * lead, -court.width / 2 - 0.6, court.width / 2 + 0.6),
          clamp(b.py + 0.85 + b.vy * lead * 0.5, 1.1, court.ceiling - 0.4),
          b.pz - dz * back + b.vz * lead,
        );
        tmp.set(b.px + dx * 1.6 + b.vx * lead, b.py * 0.75, b.pz + dz * 1.6 + b.vz * lead);
        if (bolim && bolim.id !== b.id) {
          // perto do bolim, a câmera passa a enquadrar a região do bolim
          const d = Math.hypot(bolim.px - b.px, bolim.pz - b.pz);
          const w = clamp(1 - d / 6, 0, 0.6);
          tmp.lerp(new THREE.Vector3(bolim.px, 0, bolim.pz), w);
        }
        this.tLook.copy(tmp);
        this.tFov = this.fitFov(54, 46);
        this.lambda = 6;
        break;
      }
      case 'settle': {
        // enquadra o bolim e tudo que ainda se move
        let cx = 0;
        let cz = 0;
        let wsum = 0;
        const pts: [number, number][] = [];
        if (bolim) {
          cx += bolim.px * 2;
          cz += bolim.pz * 2;
          wsum += 2;
          pts.push([bolim.px, bolim.pz]);
        }
        for (const b of world.bodies) {
          if (!b.active || b.kind === 'bolim') continue;
          const moving = !b.asleep;
          const near = bolim ? Math.hypot(b.px - bolim.px, b.pz - bolim.pz) < 1.6 : false;
          if (!moving && !near && b.id !== this.followId) continue;
          cx += b.px;
          cz += b.pz;
          wsum += 1;
          pts.push([b.px, b.pz]);
        }
        if (wsum === 0) break;
        cx /= wsum;
        cz /= wsum;
        let r = 0.9;
        for (const [x, z] of pts) r = Math.max(r, Math.hypot(x - cx, z - cz) + 0.5);
        r = Math.min(r, 6);
        this.tPos.set(cx * 0.8, 0.9 + r * 1.05, cz + 1.0 + r * 1.25);
        this.tLook.set(cx, 0, cz - 0.1);
        this.tFov = this.fitFov(46, 44);
        this.lambda = 2.6;
        break;
      }
      case 'bolim': {
        const cx = bolim ? bolim.px : 0;
        const cz = bolim ? bolim.pz : -L * 0.62;
        const o = this.orbit;
        this.tLook.set(cx, 0.02, cz);
        this.tPos.set(cx + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, 0.06 + Math.sin(o.pitch) * o.dist, cz + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
        this.tFov = this.fitFov(45, 46);
        this.lambda = 5;
        break;
      }
      case 'overview': {
        // visão geral alta, por baixo da cobertura, mostrando a cancha inteira
        const o = this.overviewOrbit;
        const cz = -L * 0.55;
        const d = L * 0.62 * o.dist;
        this.tLook.set(0, 0, cz);
        this.tPos.set(Math.sin(o.yaw) * Math.cos(o.pitch) * d, 0.5 + Math.sin(o.pitch) * d, cz + Math.cos(o.yaw) * Math.cos(o.pitch) * d);
        this.tFov = this.fitFov(40, 42);
        this.lambda = 4;
        break;
      }
    }
    // a câmera nunca entra no piso nem sobe no telhado
    this.tPos.y = clamp(this.tPos.y, 0.25, this.mode === 'menu' ? 40 : court.ceiling - 0.3);
    if (this.snapNext) {
      this.pos.copy(this.tPos);
      this.look.copy(this.tLook);
      this.fov = this.tFov;
      this.snapNext = false;
    }
    const k = 1 - Math.exp(-this.lambda * dt);
    this.pos.lerp(this.tPos, k);
    this.look.lerp(this.tLook, Math.min(1, k * 1.25));
    this.fov = damp(this.fov, this.tFov, this.lambda, dt);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const s = this.shake * this.shake * 0.05;
    this.cam.position.set(this.pos.x + (Math.random() - 0.5) * s, this.pos.y + (Math.random() - 0.5) * s, this.pos.z + (Math.random() - 0.5) * s);
    this.cam.lookAt(this.look);
    if (Math.abs(this.cam.fov - this.fov) > 0.01) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
    // câmera auxiliar (janela): enquadra o bolim e as bolas próximas, vista do lado do arremesso
    if (bolim) {
      let r = 0.42;
      let cx = bolim.px;
      let cz = bolim.pz;
      let n = 1;
      for (const b of world.bodies) {
        if (!b.active || b.kind === 'bolim' || !b.grounded) continue;
        const d = Math.hypot(b.px - bolim.px, b.pz - bolim.pz);
        if (d > 2.2) continue;
        cx += b.px * 0.5;
        cz += b.pz * 0.5;
        n += 0.5;
      }
      cx /= n;
      cz /= n;
      for (const b of world.bodies) {
        if (!b.active || !b.grounded) continue;
        const d = Math.hypot(b.px - bolim.px, b.pz - bolim.pz);
        if (d > 2.2) continue;
        r = Math.max(r, Math.hypot(b.px - cx, b.pz - cz) + 0.18);
      }
      const fov = 36;
      const dist = (r / Math.tan((fov * Math.PI) / 360)) * 1.15;
      this.pipLook.lerp(new THREE.Vector3(cx, 0.02, cz), this.pipInit ? 1 - Math.exp(-4 * dt) : 1);
      this.pipPos.lerp(new THREE.Vector3(cx * 0.85, 0.05 + dist * 0.78, cz + dist * 0.62), this.pipInit ? 1 - Math.exp(-4 * dt) : 1);
      this.pipInit = true;
      this.pip.position.copy(this.pipPos);
      this.pip.lookAt(this.pipLook);
      this.pip.fov = fov;
    } else this.pipInit = false;
  }

  /** a câmera está perto do jogador (para deixá-lo semitransparente) */
  nearThrower(rp: { x: number; z: number }): boolean {
    return Math.hypot(this.cam.position.x - rp.x, this.cam.position.z - rp.z - 0.4) < 1.2;
  }
}
