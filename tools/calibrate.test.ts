import { test } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEFAULT_COURT } from '../src/config';
import { World } from '../src/physics/world';
import { launchBody, launchSpeed, predictFlight } from '../src/physics/shot';

// Tabela de calibração: para cada altura/força mostra onde a bola cai,
// onde para, quanto rola e a altura máxima. Rodar com `npm run calibrate`.
test('tabela de calibração', () => {
  const court = DEFAULT_COURT;
  const rows: string[] = [];
  rows.push('arco  força  v(m/s)  ápice  queda(m)  parada(m)  rolou(m)  tempo(s)');
  for (const arc of [0, 4, 8, 12, 18, 26, 36, 50]) {
    for (const power of [0.2, 0.4, 0.6, 0.8, 1]) {
      const aim = { x0: 0, yaw: 0, arc, power };
      const f = predictFlight(aim, court);
      if (!f.landing) continue;
      const w = new World(court);
      const b = launchBody(w, 'ball', 'blue', aim);
      w.runUntilRest(40);
      const land = f.landing ? -f.landing.z : NaN;
      const stop = -b.pz;
      rows.push(
        `${String(arc).padStart(4)}  ${power.toFixed(2)}  ${launchSpeed(power, court, arc).toFixed(2).padStart(6)}  ${f.apex
          .toFixed(2)
          .padStart(5)}  ${land.toFixed(2).padStart(8)}  ${stop.toFixed(2).padStart(9)}  ${(stop - land)
          .toFixed(2)
          .padStart(8)}  ${w.time.toFixed(2).padStart(7)}${b.dead ? '  MORTA' : ''}`,
      );
    }
  }
  mkdirSync('tools/out', { recursive: true });
  writeFileSync('tools/out/calibration.txt', rows.join('\n'));
});
