import { BALL, BOLIM, type CourtSpec } from '../config';
import { otherTeam, rankBalls, scoreRound } from '../game/rules';
import { World, type Body, type BodyKind, type Team, type WorldData } from '../physics/world';
import { clampAim, launchBody, limitAimToCourt, maxPowerForArc, predictFlight, releaseDistance, type Aim } from '../physics/shot';
import { clamp } from '../util/math';
import { Rng } from '../util/rng';

// Planejador da IA. Para cada jogada candidata (ponto, tiro, empurrar,
// bater no bolim) a IA simula o arremesso completo com o MESMO motor de física
// do jogo, avalia a posição resultante e escolhe a melhor. A dificuldade define
// quantas opções ela considera e o erro de execução (mão trêmula).

export type Difficulty = 'easy' | 'medium' | 'hard';
export type ShotIntent = 'ponto' | 'tiro' | 'empurrar' | 'bolim' | 'lancar-bolim';

export interface Plan {
  aim: Aim;
  intent: ShotIntent;
  targetId?: number;
  expected: number;
}

interface DiffCfg {
  arcs: number[];
  laterals: number;
  hits: boolean;
  pushes: boolean;
  bolimHits: boolean;
  powerIters: number;
  noise: { yaw: number; power: number; arc: number };
  robustSamples: number;
  blunder: number;
}

export const DIFFICULTY: Record<Difficulty, DiffCfg> = {
  easy: {
    arcs: [46],
    laterals: 1,
    hits: false,
    pushes: false,
    bolimHits: false,
    powerIters: 8,
    noise: { yaw: 1.2, power: 0.03, arc: 1.5 },
    robustSamples: 0,
    blunder: 0.3,
  },
  medium: {
    arcs: [52, 38],
    laterals: 2,
    hits: true,
    pushes: true,
    bolimHits: false,
    powerIters: 11,
    noise: { yaw: 0.7, power: 0.016, arc: 0.8 },
    robustSamples: 3,
    blunder: 0.08,
  },
  hard: {
    arcs: [56, 46, 34],
    laterals: 3,
    hits: true,
    pushes: true,
    bolimHits: true,
    powerIters: 14,
    noise: { yaw: 0.3, power: 0.007, arc: 0.35 },
    robustSamples: 5,
    blunder: 0,
  },
};

export interface PlanRequest {
  id: number;
  kind: 'ball' | 'bolim';
  world: WorldData;
  team: Team;
  difficulty: Difficulty;
  seed: number;
}

export function runPlan(req: Omit<PlanRequest, 'id'>): Plan {
  return req.kind === 'bolim' ? planBolim(req.world, req.difficulty, req.seed) : planBall(req.world, req.team, req.difficulty, req.seed);
}

function quiet(w: World): World {
  w.recordEvents = false;
  w.integrateOrientation = false;
  w.events.length = 0;
  return w;
}

function yawTo(x0: number, tx: number, tz: number, court: CourtSpec): number {
  const relZ = -releaseDistance(court);
  return (Math.atan2(tx - x0, relZ - tz) * 180) / Math.PI;
}

function lateralOptions(tx: number, court: CourtSpec, n: number): number[] {
  const hw = court.width / 2 - 0.35;
  const base = clamp(tx * 0.6, -hw, hw);
  if (n <= 1) return [base];
  const out = [base, clamp(base + (base > 0 ? -0.55 : 0.55), -hw, hw)];
  if (n >= 3) out.push(clamp(base + (base > 0 ? 0.45 : -0.45), -hw, hw));
  return out;
}

/** Busca (bisseção) a força que faz o corpo PARAR no ponto alvo, em cancha vazia. */
function powerToStop(
  court: CourtSpec,
  backWallRule: boolean,
  kind: BodyKind,
  x0: number,
  arc: number,
  tx: number,
  tz: number,
  iters: number,
): Aim {
  const yaw = yawTo(x0, tx, tz, court);
  const dx = Math.sin((yaw * Math.PI) / 180);
  const dz = -Math.cos((yaw * Math.PI) / 180);
  let lo = 0;
  let hi = maxPowerForArc(arc, court);
  const w = quiet(new World(court));
  w.backWallRule = backWallRule;
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    w.clear();
    w.time = 0;
    const b = launchBody(w, kind, null, { x0, yaw, arc, power: mid });
    w.runUntilRest(30);
    const along = b.dead || b.hitBack ? 1e3 : (b.px - tx) * dx + (b.pz - tz) * dz;
    if (along < 0) lo = mid;
    else hi = mid;
  }
  return clampAim({ x0, yaw, arc, power: (lo + hi) / 2 }, court);
}

/** Força para que o voo encontre o alvo diretamente (tiro pelo ar). null se o arco não alcança. */
function powerToHit(court: CourtSpec, x0: number, arc: number, tx: number, tz: number, iters: number): Aim | null {
  const yaw = yawTo(x0, tx, tz, court);
  const relZ = -releaseDistance(court);
  const want = relZ - tz + 0.02;
  const reach = (power: number) => {
    const f = predictFlight({ x0, yaw, arc, power }, court, 'ball', 1000);
    return f.landing ? Math.hypot(f.landing.x - x0, f.landing.z - relZ) : 1e3;
  };
  let lo = 0;
  let hi = maxPowerForArc(arc, court);
  if (reach(hi) < want) return null;
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    if (reach(mid) < want) lo = mid;
    else hi = mid;
  }
  return clampAim({ x0, yaw, arc, power: (lo + hi) / 2 }, court);
}

/** Valor da posição para `team`: + pontos garantidos, - pontos do adversário, margem e proximidade. */
export function evaluate(w: World, team: Team): number {
  const bolim = w.bolim;
  if (!bolim) return 0;
  const ranking = rankBalls(w.bodies, bolim);
  if (!ranking.length) return 0;
  const res = scoreRound(ranking);
  const mine = ranking.find((r) => r.team === team);
  const theirs = ranking.find((r) => r.team !== team);
  const closeness = mine ? -4 * Math.min(2, mine.dist) : -8;
  if (res.winner === team) {
    const margin = theirs && mine ? Math.min(1, theirs.center - mine.center) : 1;
    return 10 * res.points + 3 * margin + closeness;
  }
  if (res.winner === otherTeam(team)) {
    const margin = mine && theirs ? Math.min(1, mine.center - theirs.center) : 1;
    return -10 * res.points - 3 * margin + closeness;
  }
  return closeness;
}

function simulate(base: World, team: Team, aim: Aim): World {
  const w = quiet(base.clone());
  launchBody(w, 'ball', team, aim);
  w.runUntilRest(30);
  return w;
}

function perturb(aim: Aim, cfg: DiffCfg, rng: Rng, court: CourtSpec): Aim {
  return clampAim(
    {
      x0: aim.x0,
      yaw: aim.yaw + rng.gauss(0, cfg.noise.yaw),
      arc: aim.arc + rng.gauss(0, cfg.noise.arc),
      power: aim.power + rng.gauss(0, cfg.noise.power),
    },
    court,
  );
}

export function planBall(data: WorldData, team: Team, difficulty: Difficulty, seed: number, trace?: Plan[]): Plan {
  const cfg = DIFFICULTY[difficulty];
  const rng = new Rng(seed);
  const base = quiet(World.fromData(data));
  const court = base.court;
  const bolim = base.bolim;
  if (!bolim) return { aim: clampAim({ x0: 0, yaw: 0, arc: 45, power: 0.5 }, court), intent: 'ponto', expected: 0 };

  const opp = otherTeam(team);
  const ranking = rankBalls(base.bodies, bolim);
  const myBest = ranking.find((r) => r.team === team);
  const candidates: Plan[] = [];
  const touch = BALL.r + BOLIM.r;

  // 1) ponto: parar a bola colada no bolim (um pouco antes dele)
  for (const arc of cfg.arcs) {
    for (const x0 of lateralOptions(bolim.px, court, cfg.laterals)) {
      const yaw = yawTo(x0, bolim.px, bolim.pz, court);
      const dx = Math.sin((yaw * Math.PI) / 180);
      const dz = -Math.cos((yaw * Math.PI) / 180);
      const short = touch + 0.012;
      const aim = powerToStop(court, base.backWallRule, 'ball', x0, arc, bolim.px - dx * short, bolim.pz - dz * short, cfg.powerIters);
      candidates.push({ aim, intent: 'ponto', expected: 0 });
    }
  }

  // 2) tiro / empurrar contra as bolas adversárias que estão ganhando
  const threats = ranking.filter((r) => r.team === opp && (!myBest || r.center < myBest.center)).slice(0, 2);
  for (const t of threats) {
    const tb = base.get(t.id) as Body;
    const x0 = clamp(tb.px * 0.5, -(court.width / 2 - 0.35), court.width / 2 - 0.35);
    if (cfg.hits) {
      for (const arc of [16, 23, 30]) {
        const aim = powerToHit(court, x0, arc, tb.px, tb.pz, cfg.powerIters);
        if (aim) candidates.push({ aim, intent: 'tiro', targetId: t.id, expected: 0 });
      }
    }
    if (cfg.pushes) {
      const yaw = yawTo(x0, tb.px, tb.pz, court);
      const dx = Math.sin((yaw * Math.PI) / 180);
      const dz = -Math.cos((yaw * Math.PI) / 180);
      const aim = powerToStop(court, base.backWallRule, 'ball', x0, 30, tb.px + dx * 0.5, tb.pz + dz * 0.5, cfg.powerIters);
      candidates.push({ aim, intent: 'empurrar', targetId: t.id, expected: 0 });
    }
  }

  // 3) bater no bolim (levá-lo para perto das nossas bolas)
  if (cfg.bolimHits && threats.length) {
    const x0 = clamp(bolim.px * 0.5, -(court.width / 2 - 0.35), court.width / 2 - 0.35);
    for (const arc of [18, 26]) {
      const aim = powerToHit(court, x0, arc, bolim.px, bolim.pz, cfg.powerIters);
      if (aim) candidates.push({ aim, intent: 'bolim', expected: 0 });
    }
  }

  for (const c of candidates) c.expected = evaluate(simulate(base, team, c.aim), team);
  candidates.sort((a, b) => b.expected - a.expected);

  // avaliação robusta: média sob o erro de execução da própria dificuldade.
  // Entram os 4 melhores e também o melhor de cada tipo de jogada (o tiro
  // perfeito costuma valer menos que o ponto perfeito, mas erra menos).
  if (cfg.robustSamples > 0) {
    const pool: Plan[] = candidates.slice(0, 4);
    for (const c of candidates) if (!pool.some((p) => p.intent === c.intent)) pool.push(c);
    for (const c of pool) {
      let sum = c.expected;
      for (let k = 0; k < cfg.robustSamples; k++) sum += evaluate(simulate(base, team, perturb(c.aim, cfg, rng, court)), team);
      c.expected = sum / (cfg.robustSamples + 1);
    }
    pool.sort((a, b) => b.expected - a.expected);
    const rest = candidates.filter((c) => !pool.includes(c));
    candidates.length = 0;
    candidates.push(...pool, ...rest);
  }

  if (trace) trace.push(...candidates.map((c) => ({ ...c, aim: { ...c.aim } })));
  let chosen = candidates[0];
  if (cfg.blunder > 0 && rng.next() < cfg.blunder && candidates.length > 1) {
    chosen = candidates[Math.min(candidates.length - 1, 1 + Math.floor(rng.next() * 2))];
  }
  const executed = limitAimToCourt(perturb(chosen.aim, cfg, rng, court), court);
  return { ...chosen, aim: executed };
}

export function planBolim(data: WorldData, difficulty: Difficulty, seed: number): Plan {
  const cfg = DIFFICULTY[difficulty];
  const rng = new Rng(seed);
  const court = data.court;
  const s = rng.range(court.bolimMin + 1.2, court.bolimMax - 1.2);
  const tx = clamp(rng.gauss(0, 0.35), -(court.width / 2 - 0.5), court.width / 2 - 0.5);
  const x0 = clamp(tx * 0.5, -(court.width / 2 - 0.35), court.width / 2 - 0.35);
  const aim = powerToStop(court, false, 'bolim', x0, 42, tx, -s, cfg.powerIters);
  const executed = limitAimToCourt(perturb(aim, cfg, rng, court), court, 'bolim');
  return { aim: executed, intent: 'lancar-bolim', expected: 0 };
}
