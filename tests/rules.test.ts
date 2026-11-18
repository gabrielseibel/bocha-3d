import { describe, expect, it } from 'vitest';
import { BALL, BOLIM } from '../src/config';
import { nextThrower, rankBalls, scoreRound, type BallLike } from '../src/game/rules';

const bolim: BallLike = { id: 0, kind: 'bolim', team: null, px: 0, pz: -18, r: BOLIM.r, active: true, dead: false };

/** cria uma bola a `cm` centímetros (borda a borda) do bolim, num ângulo qualquer */
function ballAt(id: number, team: 'blue' | 'red', cm: number, angle = id): BallLike {
  const c = cm / 100 + BALL.r + BOLIM.r;
  return {
    id,
    kind: 'ball',
    team,
    px: bolim.px + Math.cos(angle) * c,
    pz: bolim.pz + Math.sin(angle) * c,
    r: BALL.r,
    active: true,
    dead: false,
  };
}

describe('pontuação', () => {
  it('exemplo do enunciado: azul 12 e 18 cm, vermelho 25 e 32 cm → azul marca 2', () => {
    const balls = [ballAt(1, 'blue', 12), ballAt(2, 'blue', 18), ballAt(3, 'red', 25), ballAt(4, 'red', 32)];
    const res = scoreRound(rankBalls(balls, bolim));
    expect(res.winner).toBe('blue');
    expect(res.points).toBe(2);
    expect(res.scoringIds).toEqual([1, 2]);
    expect(res.ranking[0].dist).toBeCloseTo(0.12, 6);
    expect(res.ranking[3].dist).toBeCloseTo(0.32, 6);
  });

  it('conta só as bolas antes da melhor adversária', () => {
    const balls = [ballAt(1, 'red', 5), ballAt(2, 'blue', 9), ballAt(3, 'red', 11), ballAt(4, 'red', 13)];
    const res = scoreRound(rankBalls(balls, bolim));
    expect(res.winner).toBe('red');
    expect(res.points).toBe(1);
  });

  it('todas as bolas contam se o adversário não tem bola em jogo', () => {
    const dead = { ...ballAt(5, 'red', 2), dead: true };
    const balls = [ballAt(1, 'blue', 40), ballAt(2, 'blue', 60), ballAt(3, 'blue', 90), dead];
    const res = scoreRound(rankBalls(balls, bolim));
    expect(res.winner).toBe('blue');
    expect(res.points).toBe(3);
  });

  it('empate na bola mais próxima não dá ponto', () => {
    const balls = [ballAt(1, 'blue', 10, 0), ballAt(2, 'red', 10, 2)];
    const res = scoreRound(rankBalls(balls, bolim));
    expect(res.tie).toBe(true);
    expect(res.points).toBe(0);
    expect(res.winner).toBeNull();
  });

  it('bola encostada no bolim mede 0 cm', () => {
    const touching: BallLike = { id: 9, kind: 'ball', team: 'blue', px: 0, pz: bolim.pz + BALL.r + BOLIM.r, r: BALL.r, active: true, dead: false };
    expect(rankBalls([touching], bolim)[0].dist).toBeCloseTo(0, 9);
  });
});

describe('ordem de lançamento', () => {
  const remaining = { blue: 3, red: 3 };
  it('joga quem não tem a bola mais próxima', () => {
    const ranking = rankBalls([ballAt(1, 'blue', 10), ballAt(2, 'red', 30)], bolim);
    expect(nextThrower({ ranking, remaining, lastThrower: 'red', starter: 'blue' })).toBe('red');
  });
  it('se a equipe sem o ponto acabou as bolas, a outra continua', () => {
    const ranking = rankBalls([ballAt(1, 'blue', 10), ballAt(2, 'red', 30)], bolim);
    expect(nextThrower({ ranking, remaining: { blue: 2, red: 0 }, lastThrower: 'red', starter: 'blue' })).toBe('blue');
  });
  it('rodada termina quando ninguém tem bolas', () => {
    expect(nextThrower({ ranking: [], remaining: { blue: 0, red: 0 }, lastThrower: 'red', starter: 'blue' })).toBeNull();
  });
  it('sem bola em jogo: a outra equipe lança', () => {
    expect(nextThrower({ ranking: [], remaining, lastThrower: 'blue', starter: 'blue' })).toBe('red');
    expect(nextThrower({ ranking: [], remaining: { blue: 4, red: 4 }, lastThrower: null, starter: 'red' })).toBe('red');
  });
  it('empate: quem jogou por último joga de novo', () => {
    const ranking = rankBalls([ballAt(1, 'blue', 10, 0), ballAt(2, 'red', 10, 2)], bolim);
    expect(nextThrower({ ranking, remaining, lastThrower: 'red', starter: 'blue' })).toBe('red');
  });
});
