import { AIM, type CourtSpec } from '../config';
import type { Team } from '../physics/world';
import type { Aim } from '../physics/shot';
import { clamp } from '../util/math';

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} não encontrado`);
  return el as T;
}

export type AimField = 'yaw' | 'arc' | 'power' | 'x0';
export type TrainingAction = 'collect' | 'bolim' | 'throw-bolim' | 'rival';

export interface HudCallbacks {
  /** ajuste relativo (botões); fine = ajuste fino */
  nudge(field: AimField, dir: 1 | -1): void;
  /** ajuste absoluto (barras), valor 0..1 */
  setFraction(field: 'power' | 'arc', v: number): void;
  throwNow(): void;
  pause(): void;
  camera(): void;
  distances(): void;
  restart(): void;
  fullscreen(): void;
  training(a: TrainingAction): void;
  click(): void;
}

const fmt = (v: number, d = 1) => v.toFixed(d).replace('.', ',');

/** Liga um botão com repetição enquanto pressionado. */
function holdButton(el: HTMLElement, action: () => void): void {
  let t1 = 0;
  let t2 = 0;
  const stop = () => {
    clearTimeout(t1);
    clearInterval(t2);
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    action();
    stop();
    t1 = window.setTimeout(() => {
      t2 = window.setInterval(action, 55);
    }, 330);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) el.addEventListener(ev, stop);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  });
}

/** Barra arrastável (horizontal ou vertical) que devolve uma fração 0..1. */
function dragBar(el: HTMLElement, vertical: boolean, onValue: (v: number) => void, onKey: (dir: 1 | -1) => void): void {
  let active = false;
  const read = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const v = vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    onValue(clamp(v, 0, 1));
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    active = true;
    el.setPointerCapture(e.pointerId);
    read(e);
  });
  el.addEventListener('pointermove', (e) => active && read(e));
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) el.addEventListener(ev, () => (active = false));
  el.addEventListener('keydown', (e) => {
    const inc = vertical ? ['ArrowUp', 'ArrowRight'] : ['ArrowRight', 'ArrowUp'];
    const dec = vertical ? ['ArrowDown', 'ArrowLeft'] : ['ArrowLeft', 'ArrowDown'];
    if (inc.includes(e.key)) onKey(1);
    else if (dec.includes(e.key)) onKey(-1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
}

export class Hud {
  readonly root = byId('hud');
  private readonly controls = byId('controls');
  private readonly turn = byId('turn');
  private readonly turnText = byId('turn-text');
  private readonly pointInfo = byId('point-info');
  private readonly hint = byId('hint');
  private readonly toasts = byId('toasts');
  private readonly powerFill = byId('power-meter').querySelector('.meter-fill') as HTMLElement;
  private readonly powerCap = byId('power-meter').querySelector('.meter-cap') as HTMLElement;
  private readonly powerMeter = byId('power-meter');
  private readonly powerValue = byId('power-value');
  private readonly yawValue = byId('yaw-value');
  private readonly arcValue = byId('arc-value');
  private readonly arcSlider = byId('arc-slider');
  private readonly arcFill = byId('arc-slider').querySelector('.vslider-fill') as HTMLElement;
  private readonly arcThumb = byId('arc-slider').querySelector('.vslider-thumb') as HTMLElement;
  private readonly arcPath = byId('arc-path');
  private readonly posDot = byId('pos-dot');
  private readonly throwBtn = byId('btn-throw');
  private readonly distBtn = byId('btn-dist');
  private lastAimKey = '';
  private lastTurnKey = '';
  private defaultHint: string;

  constructor(cb: HudCallbacks) {
    this.defaultHint = this.hint.innerHTML;
    holdButton(byId('yaw-left'), () => cb.nudge('yaw', -1));
    holdButton(byId('yaw-right'), () => cb.nudge('yaw', 1));
    holdButton(byId('power-minus'), () => cb.nudge('power', -1));
    holdButton(byId('power-plus'), () => cb.nudge('power', 1));
    holdButton(byId('pos-left'), () => cb.nudge('x0', -1));
    holdButton(byId('pos-right'), () => cb.nudge('x0', 1));
    dragBar(this.powerMeter, false, (v) => cb.setFraction('power', v), (d) => cb.nudge('power', d));
    dragBar(this.arcSlider, true, (v) => cb.setFraction('arc', v), (d) => cb.nudge('arc', d));
    this.throwBtn.addEventListener('click', () => cb.throwNow());
    const click = (id: string, fn: () => void) =>
      byId(id).addEventListener('click', () => {
        cb.click();
        fn();
      });
    click('btn-pause', () => cb.pause());
    click('btn-camera', () => cb.camera());
    click('btn-dist', () => cb.distances());
    click('btn-restart', () => cb.restart());
    click('btn-fullscreen', () => cb.fullscreen());
    click('tr-collect', () => cb.training('collect'));
    click('tr-bolim', () => cb.training('bolim'));
    click('tr-throw-bolim', () => cb.training('throw-bolim'));
    click('tr-rival', () => cb.training('rival'));
    if (document.fullscreenEnabled) byId('btn-fullscreen').hidden = false;
    // clique com mouse não deixa o botão focado (senão Espaço o acionaria em vez de lançar)
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b && e.detail > 0) b.blur();
    });
    this.root.addEventListener('pointerup', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b && e.pointerType !== 'keyboard') window.setTimeout(() => b.blur(), 0);
    });
  }

  show(v: boolean): void {
    this.root.hidden = !v;
  }

  setTraining(training: boolean): void {
    byId('scoreboard').hidden = training;
    byId('training-board').hidden = !training;
    byId('training-actions').hidden = !training;
    byId('btn-restart').title = training ? 'Recomeçar o treino' : 'Reiniciar a partida';
  }

  setScore(score: Record<Team, number>, round: number, target: number, bump: Team | null = null): void {
    const b = byId('sb-blue');
    const r = byId('sb-red');
    b.textContent = String(score.blue);
    r.textContent = String(score.red);
    byId('sb-meta').textContent = `RODADA ${round} · ATÉ ${target} PONTOS`;
    if (bump) {
      const el = bump === 'blue' ? b : r;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
  }

  setRemaining(rem: Record<Team, number>, total: number): void {
    for (const t of ['blue', 'red'] as Team[]) {
      const el = byId(`sb-balls-${t}`);
      const n = Number.isFinite(rem[t]) ? rem[t] : total;
      let html = '';
      for (let i = 0; i < total; i++) html += `<i class="${i < n ? '' : 'used'}"></i>`;
      if (el.innerHTML !== html) el.innerHTML = html;
    }
  }

  setTurn(team: Team | null, text: string, thinking = false): void {
    const key = `${team}|${text}|${thinking}`;
    if (key === this.lastTurnKey) return;
    const teamChanged = !this.lastTurnKey.startsWith(`${team}|`);
    this.lastTurnKey = key;
    this.turn.hidden = !text;
    this.turnText.textContent = text;
    this.turn.classList.toggle('blue', team === 'blue');
    this.turn.classList.toggle('red', team === 'red');
    this.turn.classList.toggle('thinking', thinking);
    if (teamChanged) {
      this.turn.classList.remove('pop');
      void this.turn.offsetWidth;
      this.turn.classList.add('pop');
    }
    document.querySelector('.sb-team.blue')?.classList.toggle('active', team === 'blue');
    document.querySelector('.sb-team.red')?.classList.toggle('active', team === 'red');
    this.throwBtn.classList.toggle('blue', team === 'blue');
    this.throwBtn.classList.toggle('red', team === 'red');
  }

  setPointInfo(text: string): void {
    if (this.pointInfo.textContent !== text) this.pointInfo.textContent = text;
  }

  setAim(aim: Aim, court: CourtSpec, maxPower: number, isBolim: boolean): void {
    const key = `${aim.x0.toFixed(3)}|${aim.yaw.toFixed(2)}|${aim.arc.toFixed(2)}|${aim.power.toFixed(3)}|${maxPower.toFixed(3)}|${isBolim}`;
    if (key === this.lastAimKey) return;
    this.lastAimKey = key;
    this.powerFill.style.width = `${aim.power * 100}%`;
    this.powerCap.style.width = `${(1 - maxPower) * 100}%`;
    this.powerValue.textContent = `${Math.round(aim.power * 100)}%`;
    this.powerMeter.setAttribute('aria-valuenow', String(Math.round(aim.power * 100)));
    const yaw = Math.abs(aim.yaw) < 0.05 ? 0 : aim.yaw;
    this.yawValue.textContent = `${yaw > 0 ? '+' : ''}${fmt(yaw)}°`;
    this.arcValue.textContent = `${Math.round(aim.arc)}°`;
    const f = (aim.arc - AIM.arcMin) / (AIM.arcMax - AIM.arcMin);
    this.arcFill.style.height = `${f * 100}%`;
    this.arcThumb.style.bottom = `${f * 100}%`;
    this.arcSlider.setAttribute('aria-valuenow', String(Math.round(aim.arc)));
    const apex = (20 * Math.sin((aim.arc * Math.PI) / 180)) / Math.sin((62 * Math.PI) / 180);
    this.arcPath.setAttribute('d', `M2 22 Q 20 ${(22 - 2 * apex).toFixed(1)} 38 22`);
    const hw = court.width / 2 - AIM.lateralMargin;
    this.posDot.style.left = `${(6 + 88 * ((aim.x0 + hw) / (2 * hw))).toFixed(1)}%`;
  }

  setControlsEnabled(on: boolean): void {
    this.controls.classList.toggle('disabled', !on);
  }

  setControlsVisible(on: boolean): void {
    this.controls.hidden = !on;
  }

  setHint(html: string | null, dragging = false): void {
    if (html === null) {
      this.hint.hidden = true;
      return;
    }
    this.hint.hidden = false;
    const content = html || this.defaultHint;
    if (this.hint.innerHTML !== content) this.hint.innerHTML = content;
    this.hint.classList.toggle('dragging', dragging);
  }

  setTrainingStats(thrown: number, last: number | null, best: number | null): void {
    const cm = (v: number | null) => (v === null ? '—' : `${fmt(v * 100, v < 0.1 ? 1 : 0)} cm`);
    byId('tb-count').textContent = String(thrown);
    byId('tb-last').textContent = cm(last);
    byId('tb-best').textContent = cm(best);
  }

  setDistancesPressed(on: boolean): void {
    this.distBtn.setAttribute('aria-pressed', String(on));
  }

  toast(text: string, tone: 'info' | 'good' | 'bad' | 'blue' | 'red' | 'big' = 'info', ms = 1900): void {
    const el = document.createElement('div');
    el.className = `toast ${tone}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => {
      el.classList.add('out');
      window.setTimeout(() => el.remove(), 420);
    }, ms);
  }

  clearToasts(): void {
    this.toasts.innerHTML = '';
  }
}
