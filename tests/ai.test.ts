import { describe, expect, it } from 'vitest';
import { BALL, BOLIM, DEFAULT_COURT } from '../src/config';
import { planBall, planBolim, type Difficulty } from '../src/ai/planner';
import { rankBalls, scoreRound } from '../src/game/rules';
import { World } from '../src/physics/world';
import { launchBody } from '../src/physics/shot';

const court = DEFAULT_COURT;

function bolimWorld(z = -17, x = 0.2): World {
  const w = new World(court);
  w.addBody('bolim', null, x, BOLIM.r, z);
  return w;
}

function avgPointDistance(diff: Difficulty, n = 8): number {
  let sum = 0;
  for (let seed = 1; seed <= n; seed++) {
    const w = bolimWorld(-15 - (seed % 5), (seed % 3) * 0.3 - 0.3);
    const plan = planBall(w.toData(), 'red', diff, seed * 7919);
    const b = launchBody(w, 'ball', 'red', plan.aim);
    w.runUntilRest(40);
    sum += b.active ? rankBalls(w.bodies, w.bolim!)[0].dist : 2;
  }
  return sum / n;
}

describe('IA', () => {
  it('difícil aponta perto do bolim (média < 25 cm)', () => {
    const d = avgPointDistance('hard');
    expect(d).toBeLessThan(0.25);
  });

  it('fácil erra mais que difícil', () => {
    expect(avgPointDistance('easy')).toBeGreaterThan(avgPointDistance('hard'));
  });

  it('difícil tira a bola adversária colada no bolim', () => {
    let wins = 0;
    const n = 6;
    for (let seed = 1; seed <= n; seed++) {
      const w = bolimWorld(-16, 0);
      // bola azul a 2 cm do bolim, de lado: muito difícil ganhar só apontando
      w.addBody('ball', 'blue', 0.095, BALL.r, -15.97);
      w.runUntilRest(2);
      const plan = planBall(w.toData(), 'red', 'hard', seed * 104729);
      expect(['tiro', 'bolim', 'empurrar', 'ponto']).toContain(plan.intent);
      launchBody(w, 'ball', 'red', plan.aim);
      w.runUntilRest(40);
      if (scoreRound(rankBalls(w.bodies, w.bolim!)).winner === 'red') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(3);
  });

  it('lança o bolim dentro da zona válida', () => {
    let valid = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const w = new World(court);
      const plan = planBolim(w.toData(), 'medium', seed * 31);
      const b = launchBody(w, 'bolim', null, plan.aim);
      w.runUntilRest(40);
      const s = -b.pz;
      if (!b.hitBack && s >= court.bolimMin && s <= court.bolimMax) valid++;
    }
    expect(valid).toBeGreaterThanOrEqual(9);
  });
});
