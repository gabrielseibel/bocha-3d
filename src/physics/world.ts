import { AIR, BALL, BOLIM, CONTACT, GRAVITY, GROUND, PHYS_DT, WALL, type CourtSpec } from '../config';

// Motor de física próprio e determinístico para bolas de bocha.
// - voo: gravidade + arrasto do ar
// - impacto no saibro: restituição baixa, a bola "afunda" (perde velocidade
//   tangencial proporcional à velocidade vertical) e atrito de Coulomb leva ao rolamento
// - no chão: deslizamento -> rolamento puro, resistência ao rolamento até parar
// - colisões esfera-esfera em 3D com impulso (inclui o "tiro" pelo ar)
// - tabelas laterais e de fundo como planos rígidos
// Mesmo código roda no jogo, nos testes e no planejador da IA (Web Worker).

export type Team = 'blue' | 'red';
export type BodyKind = 'ball' | 'bolim';
export type WallId = 'left' | 'right' | 'front' | 'back';

export interface Body {
  id: number;
  kind: BodyKind;
  team: Team | null;
  r: number;
  m: number;
  invM: number;
  invI: number;
  rollRes: number;
  dragK: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  active: boolean;
  asleep: boolean;
  grounded: boolean;
  /** lançada e ainda não tocou nem o chão nem outro corpo */
  inFlight: boolean;
  restTime: number;
  /** encostou em outro corpo desde que foi lançada */
  touched: boolean;
  /** bateu na tabela do fundo */
  hitBack: boolean;
  dead: boolean;
  deadReason: 'back' | 'short' | null;
  /** ordem de lançamento (usada no modo treino) */
  throwIndex: number;
}

export type PhysEvent =
  | { type: 'land'; id: number; speed: number; x: number; z: number; vx: number; vz: number; first: boolean }
  | { type: 'hit'; a: number; b: number; speed: number; x: number; y: number; z: number; air: boolean }
  | { type: 'wall'; id: number; wall: WallId; speed: number; x: number; y: number; z: number }
  | { type: 'dead'; id: number; reason: 'back' };

export interface WorldData {
  court: CourtSpec;
  bodies: Body[];
  nextId: number;
  backWallRule: boolean;
}

export class World {
  court: CourtSpec;
  bodies: Body[] = [];
  time = 0;
  events: PhysEvent[] = [];
  recordEvents = true;
  integrateOrientation = true;
  /** bola que bate no fundo sem ter tocado em outra é anulada */
  backWallRule = true;
  private nextId = 1;

  constructor(court: CourtSpec) {
    this.court = court;
  }

  static fromData(d: WorldData): World {
    const w = new World(d.court);
    w.bodies = d.bodies.map((b) => ({ ...b }));
    w.nextId = d.nextId;
    w.backWallRule = d.backWallRule;
    return w;
  }

  toData(): WorldData {
    return { court: this.court, bodies: this.bodies.map((b) => ({ ...b })), nextId: this.nextId, backWallRule: this.backWallRule };
  }

  clone(): World {
    const w = World.fromData(this.toData());
    w.time = this.time;
    return w;
  }

  addBody(kind: BodyKind, team: Team | null, px: number, py: number, pz: number, vx = 0, vy = 0, vz = 0): Body {
    const spec = kind === 'ball' ? BALL : BOLIM;
    const r = spec.r;
    const m = spec.m;
    const area = Math.PI * r * r;
    const onGround = py <= r + 1e-6 && vy <= 0;
    const b: Body = {
      id: this.nextId++,
      kind,
      team,
      r,
      m,
      invM: 1 / m,
      invI: 1 / (0.4 * m * r * r),
      rollRes: spec.rollRes,
      dragK: (0.5 * AIR.rho * AIR.cd * area) / m,
      px,
      py: onGround ? r : py,
      pz,
      vx,
      vy: onGround ? 0 : vy,
      vz,
      wx: 0,
      wy: 0,
      wz: 0,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      active: true,
      asleep: false,
      grounded: onGround,
      inFlight: !onGround,
      restTime: 0,
      touched: false,
      hitBack: false,
      dead: false,
      deadReason: null,
      throwIndex: 0,
    };
    this.bodies.push(b);
    return b;
  }

  get(id: number): Body | undefined {
    for (const b of this.bodies) if (b.id === id) return b;
    return undefined;
  }

  get bolim(): Body | undefined {
    for (const b of this.bodies) if (b.kind === 'bolim' && b.active) return b;
    return undefined;
  }

  remove(id: number): void {
    this.bodies = this.bodies.filter((b) => b.id !== id);
  }

  clear(): void {
    this.bodies = [];
    this.events.length = 0;
  }

  get atRest(): boolean {
    for (const b of this.bodies) if (b.active && !b.asleep) return false;
    return true;
  }

  /** Avança até tudo parar (ou até maxTime segundos simulados). */
  runUntilRest(maxTime = 40): void {
    const end = this.time + maxTime;
    while (!this.atRest && this.time < end) this.step();
  }

  step(): void {
    const dt = PHYS_DT;
    const bodies = this.bodies;
    const n = bodies.length;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (!b.active || b.asleep) continue;
      if (b.grounded) this.integrateGrounded(b, dt);
      else this.integrateAir(b, dt);
    }
    for (let i = 0; i < n; i++) {
      const a = bodies[i];
      if (!a.active) continue;
      for (let j = i + 1; j < n; j++) {
        const b = bodies[j];
        if (!b.active || (a.asleep && b.asleep)) continue;
        this.collidePair(a, b);
      }
    }
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (!b.active || b.asleep) continue;
      this.collideWalls(b);
      if (!b.active) continue;
      this.collideGround(b);
      if (this.integrateOrientation) this.integrateRotation(b, dt);
      this.updateSleep(b, dt);
    }
    this.time += dt;
  }

  private integrateAir(b: Body, dt: number): void {
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
    const k = b.dragK * sp;
    b.vx -= b.vx * k * dt;
    b.vy -= (GRAVITY + b.vy * k) * dt;
    b.vz -= b.vz * k * dt;
    b.px += b.vx * dt;
    b.py += b.vy * dt;
    b.pz += b.vz * dt;
  }

  private integrateGrounded(b: Body, dt: number): void {
    const r = b.r;
    b.vy = 0;
    // deslizamento: o atrito leva o ponto de contato ao repouso (rolamento puro)
    const cvx = b.vx + r * b.wz;
    const cvz = b.vz - r * b.wx;
    const cv = Math.sqrt(cvx * cvx + cvz * cvz);
    if (cv > 1e-5) {
      const k = b.invM + r * r * b.invI;
      const jNeed = cv / k;
      const jMax = GROUND.muSlide * b.m * GRAVITY * dt;
      const j = jNeed < jMax ? jNeed : jMax;
      const jx = (-cvx / cv) * j;
      const jz = (-cvz / cv) * j;
      b.vx += jx * b.invM;
      b.vz += jz * b.invM;
      b.wx += -r * jz * b.invI;
      b.wz += r * jx * b.invI;
    }
    // resistência ao rolamento do saibro
    const sp = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
    if (sp > 0) {
      const dec = (b.rollRes * GRAVITY + GROUND.rollDrag * sp) * dt;
      const f = sp > dec ? (sp - dec) / sp : 0;
      b.vx *= f;
      b.vz *= f;
      b.wx *= f;
      b.wz *= f;
    }
    b.wy *= Math.max(0, 1 - 3 * dt);
    b.px += b.vx * dt;
    b.pz += b.vz * dt;
    b.py = r;
  }

  private groundImpact(b: Body, vn: number, plowScale: number): void {
    const r = b.r;
    const e = GROUND.restitution / (1 + GROUND.restitutionK * vn);
    const jn = b.m * (1 + e) * vn;
    // a bola afunda no saibro: perde parte da velocidade tangencial
    const plow = Math.min(GROUND.plowMax, GROUND.plow * vn * plowScale);
    b.vx *= 1 - plow;
    b.vz *= 1 - plow;
    b.wx *= 1 - plow;
    b.wz *= 1 - plow;
    // atrito de Coulomb durante o impacto, limitado a mu * impulso normal
    const cvx = b.vx + r * b.wz;
    const cvz = b.vz - r * b.wx;
    const cv = Math.sqrt(cvx * cvx + cvz * cvz);
    if (cv > 1e-6) {
      const k = b.invM + r * r * b.invI;
      const j = Math.min(cv / k, GROUND.muImpact * jn);
      const jx = (-cvx / cv) * j;
      const jz = (-cvz / cv) * j;
      b.vx += jx * b.invM;
      b.vz += jz * b.invM;
      b.wx += -r * jz * b.invI;
      b.wz += r * jx * b.invI;
    }
    const up = e * vn;
    const first = b.inFlight;
    if (up < GROUND.bounceMin) {
      b.vy = 0;
      b.grounded = true;
    } else {
      b.vy = up;
      b.grounded = false;
    }
    b.inFlight = false;
    b.asleep = false;
    b.restTime = 0;
    if (this.recordEvents && vn > 0.2) {
      this.events.push({ type: 'land', id: b.id, speed: vn, x: b.px, z: b.pz, vx: b.vx, vz: b.vz, first });
    }
  }

  private collideGround(b: Body): void {
    if (b.grounded) {
      if (b.vy > 0.05) {
        b.grounded = false; // levantada por uma colisão
      } else if (b.vy < -1e-6) {
        b.py = b.r;
        this.groundImpact(b, -b.vy, GROUND.plowGrounded); // empurrada contra o piso (tiro)
      } else {
        b.vy = 0;
        b.py = b.r;
      }
      return;
    }
    if (b.py <= b.r) {
      b.py = b.r;
      if (b.vy < 0) this.groundImpact(b, -b.vy, 1);
    }
  }

  private collidePair(a: Body, b: Body): void {
    const dx = b.px - a.px;
    const dy = b.py - a.py;
    const dz = b.pz - a.pz;
    const rs = a.r + b.r;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= rs * rs) return;
    let d = Math.sqrt(d2);
    let nx = 0;
    let ny = 0;
    let nz = -1;
    if (d > 1e-9) {
      nx = dx / d;
      ny = dy / d;
      nz = dz / d;
    } else d = 0;
    const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny + (a.vz - b.vz) * nz;
    // toque muito lento em corpo parado: o parado se comporta como fixo
    const gentle = vn < 0.03;
    let ima = a.invM;
    let imb = b.invM;
    if (gentle) {
      if (a.asleep) ima = 0;
      if (b.asleep) imb = 0;
    }
    const isum = ima + imb;
    if (isum === 0) return;
    const pen = rs - d - CONTACT.slop;
    if (pen > 0) {
      const ca = (pen * 0.8 * ima) / isum;
      const cb = (pen * 0.8 * imb) / isum;
      a.px -= nx * ca;
      a.py -= ny * ca;
      a.pz -= nz * ca;
      b.px += nx * cb;
      b.py += ny * cb;
      b.pz += nz * cb;
    }
    if (vn <= 0) return;
    const withBolim = a.kind === 'bolim' || b.kind === 'bolim';
    const e = vn < 0.06 ? 0 : withBolim ? CONTACT.ballBolim : CONTACT.ballBall;
    const j = ((1 + e) * vn) / isum;
    a.vx -= nx * j * ima;
    a.vy -= ny * j * ima;
    a.vz -= nz * j * ima;
    b.vx += nx * j * imb;
    b.vy += ny * j * imb;
    b.vz += nz * j * imb;
    if (ima > 0) {
      a.asleep = false;
      a.restTime = 0;
    }
    if (imb > 0) {
      b.asleep = false;
      b.restTime = 0;
    }
    a.touched = true;
    b.touched = true;
    const air = a.inFlight || b.inFlight;
    a.inFlight = false;
    b.inFlight = false;
    if (this.recordEvents && vn > 0.05) {
      const t = a.r / rs;
      this.events.push({
        type: 'hit',
        a: a.id,
        b: b.id,
        speed: vn,
        x: a.px + dx * t,
        y: a.py + dy * t,
        z: a.pz + dz * t,
        air,
      });
    }
  }

  private collideWalls(b: Body): void {
    const hw = this.court.width / 2;
    const L = this.court.length;
    if (b.px > hw - b.r) {
      b.px = hw - b.r;
      if (b.vx > 0) this.wallImpact(b, 'right', b.vx);
    } else if (b.px < -hw + b.r) {
      b.px = -hw + b.r;
      if (b.vx < 0) this.wallImpact(b, 'left', -b.vx);
    }
    if (b.pz > -b.r) {
      b.pz = -b.r;
      if (b.vz > 0) this.wallImpact(b, 'front', b.vz);
    } else if (b.pz < -L + b.r) {
      b.pz = -L + b.r;
      if (b.vz < 0) this.wallImpact(b, 'back', -b.vz);
    }
  }

  private wallImpact(b: Body, wall: WallId, vn: number): void {
    const side = wall === 'left' || wall === 'right';
    const e = side ? WALL.restitutionSide : WALL.restitutionEnd;
    const keep = 1 - WALL.friction;
    if (side) {
      b.vx = wall === 'right' ? -e * vn : e * vn;
      b.vz *= keep;
    } else {
      b.vz = wall === 'front' ? -e * vn : e * vn;
      b.vx *= keep;
    }
    b.vy *= keep;
    b.wx *= keep;
    b.wy *= keep;
    b.wz *= keep;
    b.asleep = false;
    b.restTime = 0;
    if (this.recordEvents && vn > 0.08) {
      this.events.push({ type: 'wall', id: b.id, wall, speed: vn, x: b.px, y: b.py, z: b.pz });
    }
    if (wall === 'back' && vn > 0.02) {
      b.hitBack = true;
      if (this.backWallRule && b.kind === 'ball' && !b.touched && !b.dead) {
        b.dead = true;
        b.deadReason = 'back';
        b.active = false;
        if (this.recordEvents) this.events.push({ type: 'dead', id: b.id, reason: 'back' });
      }
    }
  }

  private integrateRotation(b: Body, dt: number): void {
    const wx = b.wx;
    const wy = b.wy;
    const wz = b.wz;
    if (wx === 0 && wy === 0 && wz === 0) return;
    const hx = 0.5 * dt * wx;
    const hy = 0.5 * dt * wy;
    const hz = 0.5 * dt * wz;
    const qx = b.qx;
    const qy = b.qy;
    const qz = b.qz;
    const qw = b.qw;
    let nx = qx + hx * qw + hy * qz - hz * qy;
    let ny = qy - hx * qz + hy * qw + hz * qx;
    let nz = qz + hx * qy - hy * qx + hz * qw;
    let nw = qw - hx * qx - hy * qy - hz * qz;
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
    nx *= inv;
    ny *= inv;
    nz *= inv;
    nw *= inv;
    b.qx = nx;
    b.qy = ny;
    b.qz = nz;
    b.qw = nw;
  }

  private updateSleep(b: Body, dt: number): void {
    if (!b.grounded) {
      b.restTime = 0;
      return;
    }
    const rs = GROUND.restSpeed;
    const sp2 = b.vx * b.vx + b.vz * b.vz;
    const cvx = b.vx + b.r * b.wz;
    const cvz = b.vz - b.r * b.wx;
    if (sp2 < rs * rs && cvx * cvx + cvz * cvz < rs * rs) {
      b.restTime += dt;
      if (b.restTime > 0.12) {
        b.asleep = true;
        b.vx = b.vy = b.vz = 0;
        b.wx = b.wy = b.wz = 0;
      }
    } else b.restTime = 0;
  }
}
