import { test } from 'vitest';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { BALL, BOLIM, DEFAULT_COURT } from '../src/config';
import { planBall, type Difficulty } from '../src/ai/planner';
import { rankBalls, scoreRound } from '../src/game/rules';
import { World } from '../src/physics/world';
import { launchBody } from '../src/physics/shot';

test('estatísticas da IA', () => {
  mkdirSync('tools/out', { recursive: true });
  const out = 'tools/out/ai.txt';
  writeFileSync(out, '');
  for (const diff of ['easy', 'medium', 'hard'] as Difficulty[]) {
    let sum = 0, n = 0, worst = 0, ms = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const w = new World(DEFAULT_COURT);
      w.addBody('bolim', null, (seed % 5) * 0.25 - 0.5, BOLIM.r, -(13 + (seed % 9)));
      const t0 = performance.now();
      const plan = planBall(w.toData(), 'red', diff, seed * 7919);
      ms += performance.now() - t0;
      const b = launchBody(w, 'ball', 'red', plan.aim);
      w.runUntilRest(40);
      const d = b.active ? rankBalls(w.bodies, w.bolim!)[0].dist : 3;
      sum += d; n++; worst = Math.max(worst, d);
    }
    appendFileSync(out, `${diff}: média ${(100 * sum / n).toFixed(1)} cm, pior ${(100 * worst).toFixed(0)} cm, ${(ms / n).toFixed(0)} ms/jogada\n`);
    // cenário de tiro
    const intents: string[] = [];
    let wins = 0; let tms = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const w = new World(DEFAULT_COURT);
      w.addBody('bolim', null, 0, BOLIM.r, -16);
      w.addBody('ball', 'blue', 0.095, BALL.r, -15.97);
      w.addBody('ball', 'blue', -0.3, BALL.r, -15.6);
      const t0 = performance.now();
      const plan = planBall(w.toData(), 'red', diff, seed * 104729);
      tms += performance.now() - t0;
      intents.push(plan.intent);
      launchBody(w, 'ball', 'red', plan.aim);
      w.runUntilRest(40);
      if (scoreRound(rankBalls(w.bodies, w.bolim!)).winner === 'red') wins++;
    }
    appendFileSync(out, `   cenário difícil: ganhou o ponto ${wins}/10, ${(tms / 10).toFixed(0)} ms, jogadas: ${intents.join(',')}\n`);
  }
});
