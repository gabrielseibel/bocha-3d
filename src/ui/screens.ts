import type { Settings } from '../game/settings';
import { TEAM_NAME, type Rank, type RoundResult } from '../game/rules';
import type { Team } from '../physics/world';
import { byId } from './hud';

export type ScreenId = 'loading' | 'menu' | 'settings' | 'help' | 'pause' | 'confirm' | 'round' | 'victory';

export interface ScreenCallbacks {
  play(): void;
  training(): void;
  settingChanged(key: keyof Settings): void;
  resume(): void;
  restart(): void;
  toMenu(): void;
  roundContinue(): void;
  again(): void;
  click(): void;
}

const cm = (d: number) => {
  const v = d * 100;
  return `${v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)} cm`;
};

/** Menus, configurações, diálogos e tela de vitória. */
export class Screens {
  private readonly settings: Settings;
  private readonly cb: ScreenCallbacks;
  private stack: ScreenId[] = [];
  private confirmAction: (() => void) | null = null;
  private confirmCancel: (() => void) | null = null;
  private confetti: Confetti | null = null;

  constructor(settings: Settings, cb: ScreenCallbacks) {
    this.settings = settings;
    this.cb = cb;
    this.bindSettings();
    const on = (id: string, fn: () => void) =>
      byId(id).addEventListener('click', () => {
        cb.click();
        fn();
      });
    on('btn-play', () => cb.play());
    on('btn-training', () => cb.training());
    on('btn-settings', () => this.open('settings'));
    on('btn-help', () => this.open('help'));
    on('btn-resume', () => cb.resume());
    on('btn-pause-restart', () => this.confirm('Reiniciar a partida?', 'O placar volta a zero.', 'REINICIAR', () => cb.restart()));
    on('btn-pause-settings', () => this.open('settings'));
    on('btn-pause-help', () => this.open('help'));
    on('btn-pause-menu', () => this.confirm('Sair para o menu?', 'A partida em andamento será encerrada.', 'SAIR', () => cb.toMenu()));
    on('btn-confirm-no', () => this.close('confirm'));
    on('btn-confirm-yes', () => {
      const a = this.confirmAction;
      this.confirmAction = null;
      this.confirmCancel = null;
      this.close('confirm');
      a?.();
    });
    on('btn-round-continue', () => cb.roundContinue());
    on('btn-again', () => cb.again());
    on('btn-victory-menu', () => cb.toMenu());
    for (const el of document.querySelectorAll<HTMLElement>('[data-close]')) {
      el.addEventListener('click', () => {
        cb.click();
        const screen = el.closest('.screen') as HTMLElement;
        this.close(screen.id.replace('screen-', '') as ScreenId);
      });
    }
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const top = this.top;
      if (top === 'settings' || top === 'help' || top === 'confirm') {
        this.close(top);
        e.stopImmediatePropagation();
      } else if (top === 'pause') {
        cb.resume();
        e.stopImmediatePropagation();
      }
    }, true);
  }

  get top(): ScreenId | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  isOpen(id: ScreenId): boolean {
    return this.stack.includes(id);
  }

  open(id: ScreenId): void {
    const el = byId(`screen-${id}`);
    el.hidden = false;
    this.stack = this.stack.filter((s) => s !== id);
    this.stack.push(id);
    const focus = el.querySelector<HTMLElement>('.btn.primary, [data-close], button');
    window.setTimeout(() => focus?.focus({ preventScroll: true }), 30);
  }

  close(id: ScreenId): void {
    byId(`screen-${id}`).hidden = true;
    this.stack = this.stack.filter((s) => s !== id);
    if (id === 'confirm' && this.confirmCancel) {
      // fechado sem confirmar (Cancelar, Esc)
      const c = this.confirmCancel;
      this.confirmCancel = null;
      this.confirmAction = null;
      c();
    }
    if (id === 'victory') {
      this.confetti?.stop();
      this.confetti = null;
    }
  }

  closeAll(): void {
    for (const id of [...this.stack]) this.close(id);
  }

  confirm(title: string, sub: string, yes: string, action: () => void, onCancel?: () => void): void {
    byId('confirm-text').textContent = title;
    byId('confirm-sub').textContent = sub;
    byId('btn-confirm-yes').textContent = yes;
    this.confirmAction = action;
    this.confirmCancel = onCancel ?? null;
    this.open('confirm');
  }

  // ------------------------------------------------------------ configurações
  private bindSettings(): void {
    const s = this.settings as unknown as Record<string, unknown>;
    for (const seg of document.querySelectorAll<HTMLElement>('.seg[data-setting]')) {
      const key = seg.dataset.setting as keyof Settings;
      for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) {
        b.addEventListener('click', () => {
          const raw = b.dataset.value!;
          const cur = s[key];
          s[key] = typeof cur === 'number' ? Number(raw) : raw;
          this.cb.click();
          this.refresh();
          this.cb.settingChanged(key);
        });
      }
    }
    for (const sw of document.querySelectorAll<HTMLElement>('.switch[data-setting]')) {
      const key = sw.dataset.setting as keyof Settings;
      sw.addEventListener('click', () => {
        s[key] = !s[key];
        this.cb.click();
        this.refresh();
        this.cb.settingChanged(key);
      });
    }
    const vol = byId<HTMLInputElement>('set-volume');
    vol.addEventListener('input', () => {
      this.settings.volume = Number(vol.value) / 100;
      this.cb.settingChanged('volume');
    });
    this.refresh();
  }

  refresh(): void {
    const s = this.settings as unknown as Record<string, unknown>;
    for (const seg of document.querySelectorAll<HTMLElement>('.seg[data-setting]')) {
      const key = seg.dataset.setting!;
      for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(String(s[key]) === b.dataset.value));
    }
    for (const sw of document.querySelectorAll<HTMLElement>('.switch[data-setting]')) sw.setAttribute('aria-checked', String(!!s[sw.dataset.setting!]));
    byId<HTMLInputElement>('set-volume').value = String(Math.round(this.settings.volume * 100));
    for (const el of document.querySelectorAll<HTMLElement>('[data-show-if]')) {
      const [k, v] = el.dataset.showIf!.split('=');
      el.hidden = String(s[k]) !== v;
    }
  }

  // ------------------------------------------------------------ rodada
  showRound(res: RoundResult, score: Record<Team, number>, round: number, matchOver: boolean): void {
    byId('round-head').textContent = `FIM DA RODADA ${round}`;
    const title = byId('round-title');
    title.className = `round-title ${res.winner ?? ''}`;
    if (res.winner) title.textContent = `${TEAM_NAME[res.winner].toUpperCase()} MARCA ${res.points} ${res.points === 1 ? 'PONTO' : 'PONTOS'}`;
    else title.textContent = res.tie ? 'EMPATE — NINGUÉM PONTUA' : 'NENHUMA BOLA VÁLIDA';
    const list = byId('round-list');
    list.innerHTML = '';
    res.ranking.slice(0, 8).forEach((r: Rank, i: number) => {
      const li = document.createElement('li');
      const scored = res.scoringIds.includes(r.id);
      if (scored) li.className = 'scored';
      li.innerHTML = `<span class="pos">${i + 1}º</span><span class="dot ${r.team}"></span><span>${TEAM_NAME[r.team]}</span><span class="cm">${cm(r.dist)}</span><span class="star">${scored ? '★' : ''}</span>`;
      list.appendChild(li);
    });
    if (!res.ranking.length) list.innerHTML = '<li>Nenhuma bola em jogo.</li>';
    byId('round-blue').textContent = String(score.blue);
    byId('round-red').textContent = String(score.red);
    byId('btn-round-continue').textContent = matchOver ? 'VER RESULTADO' : 'PRÓXIMA RODADA';
    this.open('round');
  }

  // ------------------------------------------------------------ vitória
  showVictory(winner: Team, score: Record<Team, number>, target: number, vsCpu: boolean): void {
    const title = byId('victory-title');
    title.className = winner;
    title.textContent = vsCpu ? (winner === 'blue' ? 'VOCÊ VENCEU!' : 'O COMPUTADOR VENCEU') : `VITÓRIA DO ${TEAM_NAME[winner].toUpperCase()}!`;
    byId('final-blue').textContent = String(score.blue);
    byId('final-red').textContent = String(score.red);
    byId('victory-sub').textContent = `Partida até ${target} pontos · Azul × Vermelho`;
    this.open('victory');
    this.confetti?.stop();
    this.confetti = new Confetti(byId<HTMLCanvasElement>('confetti'), winner);
  }
}

/** Confete simples em canvas 2D. */
class Confetti {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly parts: { x: number; y: number; vx: number; vy: number; r: number; vr: number; w: number; h: number; c: string }[] = [];
  private raf = 0;
  private last = performance.now();
  private elapsed = 0;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, winner: Team) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.fit();
    const colors = winner === 'blue' ? ['#2f7df2', '#8fbaff', '#ffd54a', '#ffffff'] : ['#e83a3d', '#ff9a8a', '#ffd54a', '#ffffff'];
    const w = window.innerWidth;
    for (let i = 0; i < 170; i++) {
      this.parts.push({
        x: Math.random() * w,
        y: -Math.random() * window.innerHeight * 0.8,
        vx: (Math.random() - 0.5) * 80,
        vy: 80 + Math.random() * 160,
        r: Math.random() * 6,
        vr: (Math.random() - 0.5) * 8,
        w: 6 + Math.random() * 6,
        h: 10 + Math.random() * 8,
        c: colors[i % colors.length],
      });
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  /** ajusta a resolução do canvas ao tamanho exibido (também após girar o celular) */
  private fit(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  private frame = (t: number): void => {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.elapsed += dt;
    this.fit();
    const { ctx } = this;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    for (const p of this.parts) {
      p.vy += 30 * dt;
      p.x += (p.vx + Math.sin(t / 400 + p.r) * 30) * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      if (p.y > h + 20 && this.elapsed < 5) {
        p.y = -20;
        p.x = Math.random() * w;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 1.7)));
      ctx.restore();
    }
    if (this.elapsed < 9) this.raf = requestAnimationFrame(this.frame);
  };

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
