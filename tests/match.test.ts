import { describe, expect, it } from 'vitest';
import { DEFAULT_COURT } from '../src/config';
import { planBall } from '../src/ai/planner';
import { Match, type MatchConfig } from '../src/game/match';

const base: MatchConfig = {
  mode: 'pvp',
  target: 12,
  starter: 'blue',
  difficulty: 'medium',
  bolimMode: 'auto',
  backWallRule: true,
  court: DEFAULT_COURT,
};

/** joga a jogada atual usando o planejador da IA e espera tudo parar */
function playTurn(m: Match, seed: number) {
  const plan = planBall(m.world.toData(), m.current, 'medium', seed);
  m.throw(plan.aim);
  m.world.runUntilRest(40);
  return m.settle();
}

describe('partida', () => {
  it('rodada completa: 8 bolas, quem não tem o ponto joga, placar atualiza', () => {
    const m = new Match({ ...base });
    m.start();
    expect(m.phase).toBe('aim');
    expect(m.current).toBe('blue');
    let throws = 0;
    let seed = 1;
    while (m.phase === 'aim') {
      const holderBefore = m.current;
      const r = playTurn(m, seed++);
      throws++;
      if (m.phase === 'aim' && !r.roundOver) {
        // a equipe da vez nunca é a que tem o ponto (se ainda tiver bolas)
        const best = r.ranking[0];
        if (best && m.remaining[m.current === 'blue' ? 'red' : 'blue'] > 0 && m.remaining[m.current] > 0) {
          expect(m.current).not.toBe(best.team);
        }
      }
      expect(holderBefore).toBeDefined();
      expect(throws).toBeLessThanOrEqual(8);
    }
    expect(throws).toBe(8);
    expect(m.phase).toBe('round-end');
    const res = m.lastResult!;
    if (res.winner) {
      expect(m.score[res.winner]).toBe(res.points);
      expect(res.points).toBeGreaterThan(0);
      expect(m.roundStarter).toBe(res.winner);
    }
    m.continueAfterRound();
    expect(m.round).toBe(2);
    expect(m.world.bodies.filter((b) => b.kind === 'ball')).toHaveLength(0);
    expect(m.world.bolim).toBeDefined();
  });

  it('partida termina ao atingir os pontos', () => {
    const m = new Match({ ...base, target: 2 });
    m.start();
    let seed = 100;
    let guard = 0;
    while (m.phase !== 'match-end' && guard++ < 200) {
      if (m.phase === 'aim') playTurn(m, seed++);
      else if (m.phase === 'round-end') m.continueAfterRound();
    }
    expect(m.phase).toBe('match-end');
    expect(m.winner).not.toBeNull();
    expect(m.score[m.winner!]).toBeGreaterThanOrEqual(2);
  });

  it('bolim inválido: a outra equipe tenta, depois o árbitro posiciona', () => {
    const m = new Match({ ...base, bolimMode: 'throw' });
    m.start();
    expect(m.phase).toBe('bolim-aim');
    expect(m.current).toBe('blue');
    // fraco demais: para antes da linha
    m.throw({ x0: 0, yaw: 0, arc: 45, power: 0.05 });
    m.world.runUntilRest(30);
    let r = m.settle();
    expect(r.kind).toBe('bolim-invalid');
    expect(m.current).toBe('red');
    expect(m.phase).toBe('bolim-aim');
    m.throw({ x0: 0, yaw: 0, arc: 45, power: 0.05 });
    m.world.runUntilRest(30);
    r = m.settle();
    expect(r.kind).toBe('bolim-placed');
    expect(m.phase).toBe('aim');
    // quem tinha o direito ao bolim continua jogando a primeira bola
    expect(m.current).toBe('blue');
    const s = -m.world.bolim!.pz;
    expect(s).toBeGreaterThanOrEqual(m.court.bolimMin);
    expect(s).toBeLessThanOrEqual(m.court.bolimMax);
  });

  it('treino: bolas ilimitadas e estatística de distância', () => {
    const m = new Match({ ...base, mode: 'training' });
    m.start();
    for (let i = 0; i < 5; i++) {
      playTurn(m, 300 + i);
      expect(m.phase).toBe('aim');
    }
    expect(m.training.thrown).toBe(5);
    expect(m.training.best).not.toBeNull();
    expect(m.addRivalBall()).not.toBeNull();
  });
});
