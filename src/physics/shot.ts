import { AIM, BALL, GRAVITY, PHYS_DT, type CourtSpec } from '../config';
import { DEG, clamp } from '../util/math';
import { World, type Body, type BodyKind, type Team } from './world';

/**
 * Parâmetros do arremesso.
 * x0    posição lateral do arremessador (m, + = direita)
 * yaw   direção (graus, + = direita)
 * arc   ângulo de saída (graus). Até 12° é PONTO (agachado, bola rente ao
 *       chão, sai rolando); a partir de 16° é TIRO (em pé, alto e forte, para bater)
 * power força 0..1 (mapeada para que a distância cresça ~linearmente)
 */
export interface Aim {
  x0: number;
  yaw: number;
  arc: number;
  power: number;
}

export type ShotStyle = 'ponto' | 'tiro';

export const STYLE_RANGE: Record<ShotStyle, { min: number; max: number; def: number }> = {
  ponto: { min: 0, max: 12, def: 3 },
  tiro: { min: 16, max: 50, def: 24 },
};

export function styleOf(arc: number): ShotStyle {
  return arc < 14 ? 'ponto' : 'tiro';
}

export function defaultAim(style: ShotStyle = 'ponto'): Aim {
  return { x0: 0, yaw: 0, arc: STYLE_RANGE[style].def, power: style === 'ponto' ? 0.6 : 0.75 };
}

/** troca o estilo mantendo direção e posição */
export function withStyle(a: Aim, style: ShotStyle): Aim {
  if (styleOf(a.arc) === style) return a;
  return { ...a, arc: STYLE_RANGE[style].def, power: style === 'ponto' ? 0.6 : 0.75 };
}

export function clampAim(a: Aim, court: CourtSpec): Aim {
  const hw = court.width / 2 - AIM.lateralMargin;
  const r = STYLE_RANGE[styleOf(a.arc)];
  const arc = clamp(a.arc, r.min, r.max);
  return {
    x0: clamp(a.x0, -hw, hw),
    yaw: clamp(a.yaw, -AIM.yawMax, AIM.yawMax),
    arc,
    power: clamp(a.power, 0, maxPowerForArc(arc, court)),
  };
}

/**
 * Força máxima para um arco sem que a bola ultrapasse a altura livre do
 * telhado. Desconsidera o arrasto (que só reduz o ápice), então é conservador.
 */
export function maxPowerForArc(arc: number, court: CourtSpec): number {
  if (styleOf(arc) === 'ponto') return 1;
  const y0 = releasePoint({ x0: 0, yaw: 0, arc, power: 0 }, court).y;
  const vy = Math.sqrt(2 * GRAVITY * Math.max(0.1, court.ceiling - BALL.r - y0));
  const s = Math.sin(arc * DEG);
  return s <= 0 ? 1 : powerForSpeed(vy / s, court, arc);
}

/** distância (ao longo da cancha) do ponto de soltura da bola */
export function releaseDistance(court: CourtSpec): number {
  return court.foulLine - 0.12;
}

/** tiro: força total a 45° passaria do fundo (bola anulada) */
function tiroMaxSpeed(court: CourtSpec): number {
  const range = court.length + 2.5 - releaseDistance(court);
  return Math.sqrt(GRAVITY * range) * 1.03;
}

const pontoCache = new Map<number, number>();
/**
 * ponto: com força total a bola rolando chega ~1,5 m além do fundo.
 * Calculado uma vez por comprimento de cancha simulando o rolamento.
 */
function pontoMaxSpeed(court: CourtSpec): number {
  const key = court.length;
  const cached = pontoCache.get(key);
  if (cached) return cached;
  const target = court.length + 1.5 - releaseDistance(court);
  const big = { ...court, length: court.length + 40 };
  let lo = 2;
  let hi = 20;
  for (let i = 0; i < 22; i++) {
    const v = (lo + hi) / 2;
    const w = new World(big);
    w.integrateOrientation = false;
    w.backWallRule = false;
    const b = w.addBody('ball', null, 0, 0.12, -releaseDistance(court), 0, 0, -v);
    b.inFlight = true;
    b.wx = -v / b.r;
    w.runUntilRest(60);
    if (-b.pz - releaseDistance(court) < target) lo = v;
    else hi = v;
  }
  const v = (lo + hi) / 2;
  pontoCache.set(key, v);
  return v;
}

function speedRange(court: CourtSpec, arc: number): [number, number] {
  return styleOf(arc) === 'ponto' ? [1.0, pontoMaxSpeed(court)] : [AIM.minSpeed, tiroMaxSpeed(court)];
}

/** velocidade de saída: v² cresce linearmente com a força (distância ~ linear) */
export function launchSpeed(power: number, court: CourtSpec, arc: number): number {
  const [vmin, vmax] = speedRange(court, arc);
  return Math.sqrt(vmin * vmin + (vmax * vmax - vmin * vmin) * clamp(power, 0, 1));
}

/** inverso de launchSpeed */
export function powerForSpeed(v: number, court: CourtSpec, arc: number): number {
  const [vmin, vmax] = speedRange(court, arc);
  return clamp((v * v - vmin * vmin) / (vmax * vmax - vmin * vmin), 0, 1);
}

export function releasePoint(aim: Aim, court: CourtSpec): { x: number; y: number; z: number } {
  const z = -releaseDistance(court);
  if (styleOf(aim.arc) === 'ponto') {
    // agachado: a bola sai rente ao chão, quase encostando no saibro
    return { x: aim.x0, y: 0.075 + 0.004 * clamp(aim.arc, 0, 12), z };
  }
  const r = STYLE_RANGE.tiro;
  const t = (clamp(aim.arc, r.min, r.max) - r.min) / (r.max - r.min);
  return { x: aim.x0, y: 0.82 + 0.28 * t, z };
}

export function launchVelocity(aim: Aim, court: CourtSpec): { vx: number; vy: number; vz: number } {
  const v = launchSpeed(aim.power, court, aim.arc);
  const yaw = aim.yaw * DEG;
  const arc = aim.arc * DEG;
  const h = v * Math.cos(arc);
  return { vx: h * Math.sin(yaw), vy: v * Math.sin(arc), vz: -h * Math.cos(yaw) };
}

/** Cria o corpo lançado no mundo. */
export function launchBody(world: World, kind: BodyKind, team: Team | null, aim: Aim): Body {
  const p = releasePoint(aim, world.court);
  const v = launchVelocity(aim, world.court);
  const b = world.addBody(kind, team, p.x, p.y, p.z, v.vx, v.vy, v.vz);
  b.inFlight = true;
  if (styleOf(aim.arc) === 'ponto') {
    // no ponto a bola sai da mão já rolando (sem deslizar no saibro)
    b.wx = v.vz / b.r;
    b.wz = -v.vx / b.r;
  }
  return b;
}

export interface PathPrediction {
  /** pontos (x,y,z) do caminho inteiro até parar */
  points: number[];
  /** índice (em pontos) onde a bola toca o chão pela primeira vez */
  landingIndex: number;
  landing: { x: number; z: number } | null;
  stop: { x: number; z: number };
  /** bateria no fundo sem tocar outra bola (seria anulada) */
  dead: boolean;
}

/** Caminho completo (voo + rolamento) numa cancha vazia, com o mesmo motor do jogo. */
export function predictPath(aim: Aim, court: CourtSpec, kind: BodyKind = 'ball', backWallRule = true): PathPrediction {
  const w = new World(court);
  w.integrateOrientation = false;
  w.backWallRule = backWallRule;
  const b = launchBody(w, kind, null, aim);
  const points: number[] = [b.px, b.py, b.pz];
  let landingIndex = -1;
  let landing: { x: number; z: number } | null = null;
  let lx = b.px;
  let lz = b.pz;
  let ly = b.py;
  const maxSteps = Math.ceil(20 / PHYS_DT);
  for (let i = 1; i <= maxSteps && b.active && !b.asleep; i++) {
    w.step();
    if (!landing && !b.inFlight) {
      landing = { x: b.px, z: b.pz };
      points.push(b.px, b.py, b.pz);
      landingIndex = points.length / 3 - 1;
      lx = b.px;
      ly = b.py;
      lz = b.pz;
      continue;
    }
    // amostra por distância percorrida (uns 6 cm)
    if (Math.hypot(b.px - lx, b.py - ly, b.pz - lz) > 0.06) {
      points.push(b.px, b.py, b.pz);
      lx = b.px;
      ly = b.py;
      lz = b.pz;
    }
  }
  points.push(b.px, b.py, b.pz);
  return { points, landingIndex, landing, stop: { x: b.px, z: b.pz }, dead: b.dead };
}

export interface FlightPrediction {
  /** pontos (x,y,z) do voo até o primeiro toque no chão */
  points: number[];
  landing: { x: number; z: number } | null;
  apex: number;
  /** a bola passaria por cima de uma tabela (sairia da cancha) */
  leavesCourt: boolean;
}

/** Simula apenas o voo livre (sem outras bolas) com o mesmo integrador do jogo. */
export function predictFlight(aim: Aim, court: CourtSpec, kind: BodyKind = 'ball', sampleEvery = 8): FlightPrediction {
  const w = new World(court);
  w.integrateOrientation = false;
  w.backWallRule = false;
  const b = launchBody(w, kind, null, aim);
  const points: number[] = [b.px, b.py, b.pz];
  let apex = b.py;
  let leaves = false;
  const hw = court.width / 2;
  const maxSteps = Math.ceil(6 / PHYS_DT);
  for (let i = 1; i <= maxSteps; i++) {
    w.step();
    if (b.py > apex) apex = b.py;
    if (!leaves) {
      if (Math.abs(b.px) >= hw - b.r - 1e-4 && b.py > court.sideWallHeight - b.r) leaves = true;
      if (b.pz <= -court.length + b.r + 1e-4 && b.py > court.endWallHeight - b.r) leaves = true;
    }
    if (i % sampleEvery === 0 || !b.inFlight) points.push(b.px, b.py, b.pz);
    if (!b.inFlight) {
      return { points, landing: { x: b.px, z: b.pz }, apex, leavesCourt: leaves };
    }
  }
  return { points, landing: null, apex, leavesCourt: leaves };
}

/**
 * Garante que o voo não passe por cima das tabelas laterais: reduz a direção
 * (mantendo o lado) até o maior ângulo válido. Direção 0 é sempre válida.
 */
export function limitAimToCourt(aim: Aim, court: CourtSpec, kind: BodyKind = 'ball'): Aim {
  const a = clampAim(aim, court);
  if (!predictFlight(a, court, kind, 1000).leavesCourt) return a;
  let lo = 0;
  let hi = Math.abs(a.yaw);
  const sign = Math.sign(a.yaw) || 1;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (predictFlight({ ...a, yaw: sign * mid }, court, kind, 1000).leavesCourt) hi = mid;
    else lo = mid;
  }
  return { ...a, yaw: sign * lo };
}

/** distância percorrida ao longo da cancha (positiva a partir da tabela de trás) */
export function along(z: number): number {
  return -z;
}
