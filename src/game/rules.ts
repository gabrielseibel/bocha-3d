import type { Team } from '../physics/world';

// Regras da bocha (puras, sem dependência de renderização — testáveis).

export const TEAMS: readonly Team[] = ['blue', 'red'];
export const TEAM_NAME: Record<Team, string> = { blue: 'Azul', red: 'Vermelho' };

export function otherTeam(t: Team): Team {
  return t === 'blue' ? 'red' : 'blue';
}

/** empate técnico: diferença menor que 1 mm */
export const TIE_EPS = 0.001;

export interface BallLike {
  id: number;
  kind: 'ball' | 'bolim';
  team: Team | null;
  px: number;
  pz: number;
  r: number;
  active: boolean;
  dead: boolean;
}

export interface Rank {
  id: number;
  team: Team;
  /** distância entre centros, no plano do piso (m) — usada para ordenar */
  center: number;
  /** distância borda a borda (m) — o que se mede com a trena */
  dist: number;
}

export function rankBalls(bodies: readonly BallLike[], bolim: BallLike): Rank[] {
  const out: Rank[] = [];
  for (const b of bodies) {
    if (b.kind !== 'ball' || !b.active || b.dead || !b.team) continue;
    const center = Math.hypot(b.px - bolim.px, b.pz - bolim.pz);
    out.push({ id: b.id, team: b.team, center, dist: Math.max(0, center - b.r - bolim.r) });
  }
  out.sort((x, y) => x.center - y.center || x.id - y.id);
  return out;
}

export interface RoundResult {
  winner: Team | null;
  points: number;
  tie: boolean;
  ranking: Rank[];
  scoringIds: number[];
}

/**
 * A equipe com a bola mais próxima do bolim marca 1 ponto para cada bola
 * sua mais próxima que a melhor bola adversária.
 */
export function scoreRound(ranking: Rank[]): RoundResult {
  if (ranking.length === 0) return { winner: null, points: 0, tie: false, ranking, scoringIds: [] };
  const best = ranking[0];
  const rival = ranking.find((r) => r.team !== best.team);
  if (rival && rival.center - best.center < TIE_EPS) {
    return { winner: null, points: 0, tie: true, ranking, scoringIds: [] };
  }
  const limit = rival ? rival.center - TIE_EPS : Infinity;
  const scoringIds: number[] = [];
  for (const r of ranking) {
    if (r.team !== best.team || r.center >= limit) break;
    scoringIds.push(r.id);
  }
  return { winner: best.team, points: scoringIds.length, tie: false, ranking, scoringIds };
}

export interface TurnContext {
  ranking: Rank[];
  remaining: Record<Team, number>;
  lastThrower: Team | null;
  starter: Team;
}

/** Quem joga a próxima bola: a equipe que NÃO tem a bola mais próxima (se ainda tiver bolas). */
export function nextThrower(ctx: TurnContext): Team | null {
  const { remaining } = ctx;
  const blue = remaining.blue > 0;
  const red = remaining.red > 0;
  if (!blue && !red) return null;
  if (!blue) return 'red';
  if (!red) return 'blue';
  const r = ctx.ranking;
  if (r.length === 0) {
    // ninguém tem bola em jogo
    return ctx.lastThrower ? otherTeam(ctx.lastThrower) : ctx.starter;
  }
  const best = r[0];
  const rival = r.find((x) => x.team !== best.team);
  if (rival && rival.center - best.center < TIE_EPS) {
    // empate: quem jogou por último joga de novo
    return ctx.lastThrower ?? ctx.starter;
  }
  return otherTeam(best.team);
}

/** Quem tem o ponto no momento (para o placar parcial). */
export function pointHolder(ranking: Rank[]): Team | null {
  const res = scoreRound(ranking);
  return res.winner;
}
