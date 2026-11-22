// Tutorial guiado para jogadores novos: roda sobre o modo Treinamento e avança
// sozinho quando o jogador faz o que a etapa pede (ou com "Pular").

export type TutorialEvent =
  | { type: 'aim'; yaw: number; power: number; arc: number }
  | { type: 'style'; style: 'ponto' | 'tiro' }
  | { type: 'thrown'; style: 'ponto' | 'tiro' }
  | { type: 'settled'; dist: number | null; wall: boolean }
  | { type: 'camera' }
  | { type: 'distances' };

interface Step {
  title: string;
  /** HTML curto; teclas em <kbd> */
  body: string;
  /** devolve true quando a etapa foi cumprida */
  check?: (e: TutorialEvent, s: StepState) => boolean;
  /** etapa só de leitura (botão "Continuar") */
  read?: boolean;
}

interface StepState {
  yaw0: number | null;
  power0: number | null;
  wallHit: boolean;
}

const STEPS: Step[] = [
  {
    title: 'Bem-vindo à cancha!',
    body:
      'O objetivo é deixar <b>suas bolas mais perto do bolim</b> (a bolinha branca) do que as do adversário. ' +
      'Cada bola sua mais perto que a melhor bola rival vale 1 ponto.',
    read: true,
  },
  {
    title: '1 · Mirar',
    body: 'Arraste o dedo/mouse <b>para os lados</b> na tela para apontar, ou use <kbd>←</kbd> <kbd>→</kbd>.',
    check: (e, s) => e.type === 'aim' && s.yaw0 !== null && Math.abs(e.yaw - s.yaw0) > 1.5,
  },
  {
    title: '2 · Força',
    body: 'Arraste <b>para baixo</b> (ou <kbd>↑</kbd> <kbd>↓</kbd>) para dar força. A barra à direita mostra quanto.',
    check: (e, s) => e.type === 'aim' && s.power0 !== null && Math.abs(e.power - s.power0) > 0.08,
  },
  {
    title: '3 · O ponto',
    body:
      'O <b>ponto</b> é a jogada normal: o jogador agacha e solta a bola <b>rente ao chão</b>, rolando. ' +
      'Solte o arraste (ou aperte <kbd>Espaço</kbd> / o botão <b>LANÇAR</b>) para jogar.',
    check: (e) => e.type === 'thrown' && e.style === 'ponto',
  },
  {
    title: '4 · Chegue perto',
    body: 'Agora tente parar uma bola a <b>menos de 50 cm</b> do bolim. A faixa colorida mostra onde ela deve parar.',
    check: (e) => e.type === 'settled' && e.dist !== null && e.dist < 0.5,
  },
  {
    title: '5 · O tiro',
    body:
      'Quando o adversário está colado no bolim, use o <b>tiro</b>: bola alta e forte para tirar a bola dele. ' +
      'Aperte <kbd>T</kbd> ou o botão <b>TIRO</b>, mire numa bola e lance.',
    check: (e) => e.type === 'thrown' && e.style === 'tiro',
  },
  {
    title: '6 · A tabela',
    body:
      'As paredes laterais são a <b>tabela</b>: a bola bate e volta para o meio. ' +
      'Volte ao ponto (<kbd>T</kbd>), mire na parede e jogue uma tabelada.',
    check: (e) => e.type === 'settled' && e.wall,
  },
  {
    title: '7 · Câmeras e distâncias',
    body: 'Aperte <kbd>C</kbd> (ou o botão de câmera) para trocar a vista e <kbd>V</kbd> (ou o botão de régua) para ver as distâncias até o bolim.',
    check: (e) => e.type === 'camera' || e.type === 'distances',
  },
  {
    title: 'Pronto para a partida!',
    body:
      'Resumo: <b>ponto</b> para encostar, <b>tiro</b> para bater, <b>tabela</b> para contornar. ' +
      'Ganha quem chegar primeiro aos pontos combinados. Boa bocha, tchê!',
    read: true,
  },
];

export interface TutorialHost {
  exit: () => void;
  playCpu: () => void;
  click: () => void;
}

export class Tutorial {
  private el: HTMLElement;
  private idx = 0;
  private active = false;
  private busy = false;
  private state: StepState = { yaw0: null, power0: null, wallHit: false };

  constructor(private host: TutorialHost) {
    this.el = document.createElement('div');
    this.el.className = 'tutorial-card';
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  get running(): boolean {
    return this.active;
  }

  start(): void {
    this.active = true;
    this.idx = 0;
    this.show();
  }

  stop(): void {
    this.active = false;
    this.el.hidden = true;
  }

  notify(e: TutorialEvent): void {
    if (!this.active || this.busy) return;
    if (e.type === 'aim') {
      if (this.state.yaw0 === null) this.state.yaw0 = e.yaw;
      if (this.state.power0 === null) this.state.power0 = e.power;
    }
    const step = STEPS[this.idx];
    if (step.check && step.check(e, this.state)) this.advance(true);
  }

  private advance(done: boolean): void {
    if (this.busy) return;
    this.busy = true;
    if (done) this.el.classList.add('done');
    const next = () => {
      this.busy = false;
      this.el.classList.remove('done');
      this.idx++;
      this.state = { yaw0: null, power0: null, wallHit: false };
      if (this.idx >= STEPS.length) {
        this.stop();
        return;
      }
      this.show();
    };
    if (done) window.setTimeout(next, 650);
    else next();
  }

  private show(): void {
    const s = STEPS[this.idx];
    const last = this.idx === STEPS.length - 1;
    this.el.hidden = false;
    this.el.innerHTML =
      `<div class="tut-top"><span class="tut-count">Tutorial · ${this.idx + 1}/${STEPS.length}</span>` +
      `<button class="tut-x" data-a="exit" aria-label="Sair do tutorial">✕</button></div>` +
      `<h3>${s.title}</h3><p>${s.body}</p>` +
      `<div class="tut-actions">` +
      (last
        ? `<button class="btn primary" data-a="cpu">Jogar contra o computador</button><button class="btn" data-a="exit">Continuar treinando</button>`
        : s.read
          ? `<button class="btn primary" data-a="next">Continuar</button>`
          : `<span class="tut-wait">Faça o que a etapa pede…</span><button class="btn small" data-a="skip">Pular</button>`) +
      `</div>`;
    this.el.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) =>
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.host.click();
        const a = b.dataset.a;
        if (a === 'exit') {
          this.stop();
          this.host.exit();
        } else if (a === 'cpu') {
          this.stop();
          this.host.playCpu();
        } else this.advance(false);
      }),
    );
  }
}

const SEEN_KEY = 'bocha3d.tutorial.seen';

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* navegação privada */
  }
}
