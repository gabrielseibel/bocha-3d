import { describe, expect, it } from 'vitest';
import { BALL, BOLIM, DEFAULT_COURT } from '../src/config';
import { World } from '../src/physics/world';
import { clampAim, launchBody, limitAimToCourt, maxPowerForArc, predictFlight, type Aim } from '../src/physics/shot';
import { Rng } from '../src/util/rng';

const court = DEFAULT_COURT;

function throwOnce(aim: Aim, setup?: (w: World) => void) {
  const w = new World(court);
  setup?.(w);
  const b = launchBody(w, 'ball', 'blue', aim);
  let apex = b.py;
  let maxAbsX = 0;
  let minZ = 0;
  let maxZ = -Infinity;
  while (!w.atRest && w.time < 40) {
    w.step();
    for (const o of w.bodies) {
      if (!o.active) continue;
      maxAbsX = Math.max(maxAbsX, Math.abs(o.px) + o.r);
      minZ = Math.min(minZ, o.pz - o.r);
      maxZ = Math.max(maxZ, o.pz + o.r);
    }
    apex = Math.max(apex, b.py);
  }
  return { w, b, apex, maxAbsX, minZ, maxZ };
}

describe('lançamento', () => {
  it('é determinístico: mesmo arremesso, mesmo resultado', () => {
    const aim = { x0: 0.3, yaw: -1.2, arc: 42, power: 0.57 };
    const setup = (w: World) => {
      w.addBody('bolim', null, 0.1, BOLIM.r, -17);
      w.addBody('ball', 'red', -0.2, BALL.r, -16.4);
    };
    const a = throwOnce(aim, setup);
    const b = throwOnce(aim, setup);
    expect(a.w.bodies.map((o) => [o.px, o.pz])).toEqual(b.w.bodies.map((o) => [o.px, o.pz]));
  });

  it('mais força leva a bola mais longe (ponto e tiro)', () => {
    for (const arc of [3, 40]) {
      let last = -Infinity;
      for (const power of [0.2, 0.35, 0.5, 0.65]) {
        const { b } = throwOnce({ x0: 0, yaw: 0, arc, power });
        expect(-b.pz).toBeGreaterThan(last);
        last = -b.pz;
      }
    }
  });

  it('ponto: bola sai rente ao chão e rola até perto do alvo', () => {
    const f = predictFlight({ x0: 0, yaw: 0, arc: 3, power: 0.5 }, court);
    expect(f.apex).toBeLessThan(0.15);
    expect(-f.landing!.z).toBeLessThan(3);
    const { b } = throwOnce({ x0: 0, yaw: 0, arc: 3, power: 0.5 });
    expect(-b.pz).toBeGreaterThan(12);
    expect(-b.pz).toBeLessThan(19);
  });

  it('arco maior faz uma parábola mais alta', () => {
    const low = predictFlight({ x0: 0, yaw: 0, arc: 20, power: 0.6 }, court);
    const high = predictFlight({ x0: 0, yaw: 0, arc: 50, power: 0.6 }, court);
    expect(high.apex).toBeGreaterThan(low.apex + 1.5);
    expect(low.apex).toBeGreaterThan(1); // tiro sempre vai pelo alto
  });

  it('bola alta rola menos depois de cair do que bola baixa', () => {
    const roll = (arc: number, power: number) => {
      const f = predictFlight({ x0: 0, yaw: 0, arc, power }, court);
      const { b } = throwOnce({ x0: 0, yaw: 0, arc, power });
      return -b.pz - -f.landing!.z;
    };
    expect(roll(58, 0.5)).toBeLessThan(roll(22, 0.32) * 0.5);
  });

  it('a bola para sozinha pelo atrito', () => {
    const { w, b } = throwOnce({ x0: 0, yaw: 0, arc: 35, power: 0.45 });
    expect(w.atRest).toBe(true);
    expect(w.time).toBeLessThan(15);
    expect(Math.hypot(b.vx, b.vy, b.vz)).toBe(0);
  });

  it('o telhado limita a força dos arcos muito altos', () => {
    expect(maxPowerForArc(60, court)).toBeLessThan(1);
    expect(maxPowerForArc(30, court)).toBe(1);
    const a = clampAim({ x0: 0, yaw: 0, arc: 60, power: 1 }, court);
    expect(predictFlight(a, court).apex).toBeLessThan(court.ceiling);
  });
});

describe('colisões', () => {
  it('nenhuma bola atravessa as tabelas (200 arremessos aleatórios)', () => {
    const rng = new Rng(42);
    const hw = court.width / 2;
    for (let i = 0; i < 200; i++) {
      const aim = clampAim(
        { x0: rng.range(-1.5, 1.5), yaw: rng.range(-14, 14), arc: rng.range(8, 62), power: rng.range(0, 1) },
        court,
      );
      const { maxAbsX, minZ, maxZ } = throwOnce(aim, (w) => {
        w.backWallRule = false;
        w.addBody('ball', 'red', rng.range(-1.6, 1.6), BALL.r, -rng.range(10, 23));
      });
      expect(maxAbsX).toBeLessThanOrEqual(hw + 1e-9);
      expect(minZ).toBeGreaterThanOrEqual(-court.length - 1e-9);
      expect(maxZ).toBeLessThanOrEqual(1e-9);
    }
  });

  it('tabelada: bola rolando que bate na lateral volta para o meio', () => {
    const hw = court.width / 2;
    for (const side of [1, -1]) {
      const w = new World(court);
      const b = launchBody(w, 'ball', 'blue', { x0: -side * 1.2, yaw: side * 13, arc: 3, power: 0.7 });
      let hit = false;
      let after = 0;
      while (!w.atRest && w.time < 40) {
        w.step();
        if (!hit && Math.abs(b.px) >= hw - b.r - 1e-6) hit = true;
        if (hit) after = Math.max(after, hw - Math.abs(b.px));
      }
      expect(hit).toBe(true);
      // depois da batida ela se afasta bem da tabela (não fica grudada)
      expect(after).toBeGreaterThan(0.6);
      expect(hw - Math.abs(b.px)).toBeGreaterThan(0.4);
    }
  });

  it('a mira não deixa o voo passar por cima da tabela lateral', () => {
    const a = limitAimToCourt({ x0: 1.2, yaw: 14, arc: 55, power: 0.7 }, court);
    expect(a.yaw).toBeLessThan(14);
    expect(predictFlight(a, court).leavesCourt).toBe(false);
  });

  it('tiro: bola acerta outra pelo ar e a desloca', () => {
    // bola-alvo parada a 15 m; arremesso rasante e forte bem na direção dela
    let target = 0;
    const res = throwOnce(findDirectHit(15), (w) => {
      target = w.addBody('ball', 'red', 0, BALL.r, -15).id;
    });
    const t = res.w.get(target)!;
    expect(t.touched).toBe(true);
    expect(-t.pz - 15).toBeGreaterThan(1); // foi empurrada pelo menos 1 m
    // a bola atiradora perde quase toda a velocidade no choque e fica bem atrás
    expect(-res.b.pz).toBeLessThan(-t.pz);
  });

  it('o bolim pode ser deslocado', () => {
    let bolimId = 0;
    const res = throwOnce({ x0: 0, yaw: 0, arc: 25, power: 0.38 }, (w) => {
      bolimId = w.addBody('bolim', null, 0, BOLIM.r, -12).id;
    });
    const bo = res.w.get(bolimId)!;
    expect(bo.touched).toBe(true);
    expect(Math.abs(-bo.pz - 12)).toBeGreaterThan(0.3);
  });

  it('a bola que bate no fundo sem tocar outra é anulada', () => {
    const { b } = throwOnce({ x0: 0, yaw: 0, arc: 3, power: 1 });
    expect(b.dead).toBe(true);
    expect(b.deadReason).toBe('back');
  });

  it('bola parada encostada no bolim fica em repouso estável', () => {
    const w = new World(court);
    w.addBody('bolim', null, 0, BOLIM.r, -15);
    w.addBody('ball', 'blue', 0, BALL.r, -15 + 0.0717 + 0.0002);
    w.runUntilRest(5);
    expect(w.atRest).toBe(true);
    expect(w.time).toBeLessThan(1);
  });
});

/** procura a força que faz a bola (arco 18°) acertar em cheio uma bola a `dist` metros */
function findDirectHit(dist: number): Aim {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const f = predictFlight({ x0: 0, yaw: 0, arc: 18, power: mid }, court);
    if (-f.landing!.z < dist + 0.03) lo = mid;
    else hi = mid;
  }
  return { x0: 0, yaw: 0, arc: 18, power: (lo + hi) / 2 };
}
