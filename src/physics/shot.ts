import { AIM, BALL, GRAVITY, PHYS_DT, type CourtSpec } from '../config';
import { DEG, clamp } from '../util/math';
import { World, type Body, type BodyKind, type Team } from './world';

/**
 * Parâmetros do arremesso.
 * x0    posição lateral do arremessador (m, + = direita)
 * yaw   direção (graus, + = direita)
 * arc   ângulo de saída / altura da parábola (graus)
 * power força 0..1 (mapeada para que a distância cresça ~linearmente)
 */
export interface Aim {
  x0: number;
  yaw: number;
  arc: number;
  power: number;
}

export function defaultAim(): Aim {
  return { x0: 0, yaw: 0, arc: 40, power: 0.55 };
}

export function clampAim(a: Aim, court: CourtSpec): Aim {
  const hw = court.width / 2 - AIM.lateralMargin;
  const arc = clamp(a.arc, AIM.arcMin, AIM.arcMax);
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
  const y0 = releasePoint({ x0: 0, yaw: 0, arc, power: 0 }, court).y;
  const vy = Math.sqrt(2 * GRAVITY * Math.max(0.1, court.ceiling - BALL.r - y0));
  const s = Math.sin(clamp(arc, AIM.arcMin, AIM.arcMax) * DEG);
  return s <= 0 ? 1 : powerForSpeed(vy / s, court);
}

/** distância (ao longo da cancha) do ponto de soltura da bola */
export function releaseDistance(court: CourtSpec): number {
  return court.foulLine - 0.12;
}

/**
 * Velocidade máxima: permite tiros rasantes e fortes até o fundo da zona do
 * bolim (a 45° com força total a bola passaria do fundo — bola anulada).
 */
export function maxSpeed(court: CourtSpec): number {
  const range = court.length + 2.5 - releaseDistance(court);
  return Math.sqrt(GRAVITY * range) * 1.03;
}

export function launchSpeed(power: number, court: CourtSpec): number {
  const vmin = AIM.minSpeed;
  const vmax = maxSpeed(court);
  return Math.sqrt(vmin * vmin + (vmax * vmax - vmin * vmin) * clamp(power, 0, 1));
}

/** inverso de launchSpeed */
export function powerForSpeed(v: number, court: CourtSpec): number {
  const vmin = AIM.minSpeed;
  const vmax = maxSpeed(court);
  return clamp((v * v - vmin * vmin) / (vmax * vmax - vmin * vmin), 0, 1);
}

export function releasePoint(aim: Aim, court: CourtSpec): { x: number; y: number; z: number } {
  const t = (clamp(aim.arc, AIM.arcMin, AIM.arcMax) - AIM.arcMin) / (AIM.arcMax - AIM.arcMin);
  return { x: aim.x0, y: 0.42 + 0.3 * t, z: -releaseDistance(court) };
}

export function launchVelocity(aim: Aim, court: CourtSpec): { vx: number; vy: number; vz: number } {
  const v = launchSpeed(aim.power, court);
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
  return b;
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
