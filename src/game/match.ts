import { BALLS_PER_TEAM, BALL, BOLIM, type CourtSpec } from '../config';
import type { Difficulty } from '../ai/planner';
import { World, type Body, type Team } from '../physics/world';
import { defaultAim, launchBody, type Aim } from '../physics/shot';
import { Rng, randomSeed } from '../util/rng';
import { nextThrower, otherTeam, rankBalls, scoreRound, TEAM_NAME, type Rank, type RoundResult } from './rules';

export type Mode = 'cpu' | 'pvp' | 'training';
export type Phase = 'bolim-aim' | 'bolim-flight' | 'aim' | 'flight' | 'round-end' | 'match-end';

export interface MatchConfig {
  mode: Mode;
  target: number;
  starter: 'random' | Team;
  difficulty: Difficulty;
  bolimMode: 'throw' | 'auto';
  backWallRule: boolean;
  court: CourtSpec;
}

export type Tone = 'info' | 'good' | 'bad' | 'blue' | 'red';

export interface SettleReport {
  kind: 'bolim-ok' | 'bolim-invalid' | 'bolim-placed' | 'ball';
  messages: { text: string; tone: Tone }[];
  ranking: Rank[];
  roundOver: boolean;
  deadIds: number[];
}

/** Estado e regras de uma partida (independente de renderização). */
export class Match {
  readonly world: World;
  readonly cfg: MatchConfig;
  readonly humanTeam: Team = 'blue';
  score: Record<Team, number> = { blue: 0, red: 0 };
  round = 0;
  roundStarter: Team = 'blue';
  current: Team = 'blue';
  remaining: Record<Team, number> = { blue: BALLS_PER_TEAM, red: BALLS_PER_TEAM };
  phase: Phase = 'aim';
  lastThrower: Team | null = null;
  bolimTries = 0;
  activeId: number | null = null;
  lastResult: RoundResult | null = null;
  winner: Team | null = null;
  aims: Record<Team, Aim> = { blue: defaultAim(), red: defaultAim() };
  bolimAim: Aim = { x0: 0, yaw: 0, arc: 3, power: 0.55 };
  /** estatísticas do treino */
  training = { thrown: 0, last: null as number | null, best: null as number | null };
  private throwCounter = 0;
  private readonly rng = new Rng(randomSeed());

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    this.world = new World(cfg.court);
    this.world.backWallRule = cfg.backWallRule;
  }

  get court(): CourtSpec {
    return this.cfg.court;
  }

  get isTraining(): boolean {
    return this.cfg.mode === 'training';
  }

  isHumanTurn(): boolean {
    return this.cfg.mode !== 'cpu' || this.current === this.humanTeam;
  }

  start(): void {
    this.score = { blue: 0, red: 0 };
    this.round = 0;
    this.winner = null;
    this.training = { thrown: 0, last: null, best: null };
    const s = this.cfg.starter;
    this.roundStarter = this.isTraining ? 'blue' : s === 'random' ? (this.rng.next() < 0.5 ? 'blue' : 'red') : s;
    this.startRound();
  }

  startRound(): void {
    this.round++;
    this.world.clear();
    this.remaining = this.isTraining ? { blue: Infinity, red: 0 } : { blue: BALLS_PER_TEAM, red: BALLS_PER_TEAM };
    this.lastThrower = null;
    this.bolimTries = 0;
    this.lastResult = null;
    this.activeId = null;
    this.current = this.roundStarter;
    if (this.cfg.bolimMode === 'auto' || this.isTraining) {
      this.placeBolimRandom();
      this.phase = 'aim';
    } else {
      this.phase = 'bolim-aim';
    }
  }

  placeBolimRandom(): Body {
    const old = this.world.bolim;
    if (old) this.world.remove(old.id);
    const c = this.court;
    const s = this.rng.range(c.bolimMin + 0.8, c.bolimMax - 0.8);
    const x = this.rng.range(-c.width / 2 + 0.6, c.width / 2 - 0.6) * 0.6;
    const b = this.world.addBody('bolim', null, x, BOLIM.r, -s);
    b.asleep = true;
    return b;
  }

  /** lança a bola (ou o bolim) da vez com a mira dada */
  throw(aim: Aim): Body {
    let b: Body;
    if (this.phase === 'bolim-aim') {
      b = launchBody(this.world, 'bolim', null, aim);
      this.bolimAim = { ...aim };
      this.phase = 'bolim-flight';
    } else {
      b = launchBody(this.world, 'ball', this.current, aim);
      b.throwIndex = ++this.throwCounter;
      this.aims[this.current] = { ...aim };
      if (Number.isFinite(this.remaining[this.current])) this.remaining[this.current]--;
      this.lastThrower = this.current;
      this.phase = 'flight';
      if (this.isTraining) this.training.thrown++;
    }
    this.activeId = b.id;
    return b;
  }

  get inFlight(): boolean {
    return this.phase === 'flight' || this.phase === 'bolim-flight';
  }

  ranking(): Rank[] {
    const bolim = this.world.bolim;
    return bolim ? rankBalls(this.world.bodies, bolim) : [];
  }

  /** chamado quando tudo parou depois de um lançamento */
  settle(): SettleReport {
    const report: SettleReport = { kind: 'ball', messages: [], ranking: [], roundOver: false, deadIds: [] };
    const c = this.court;
    if (this.phase === 'bolim-flight') {
      const bo = this.world.bolim;
      const s = bo ? -bo.pz : 0;
      const valid = !!bo && !bo.hitBack && s >= c.bolimMin && s <= c.bolimMax;
      if (valid) {
        report.kind = 'bolim-ok';
        this.phase = 'aim';
        this.current = this.roundStarter;
        report.messages.push({ text: `Bolim valendo a ${s.toFixed(1).replace('.', ',')} m`, tone: 'info' });
        return report;
      }
      if (bo) this.world.remove(bo.id);
      this.bolimTries++;
      const why = !bo ? '' : bo.hitBack ? ' (bateu no fundo)' : s < c.bolimMin ? ' (curto demais)' : ' (longo demais)';
      if (this.isTraining) {
        report.kind = 'bolim-invalid';
        this.current = 'blue';
        this.phase = 'bolim-aim';
        report.messages.push({ text: `Bolim inválido${why}. Tente de novo.`, tone: 'bad' });
        return report;
      }
      if (this.bolimTries === 1) {
        report.kind = 'bolim-invalid';
        this.current = otherTeam(this.roundStarter);
        this.phase = 'bolim-aim';
        report.messages.push({ text: `Bolim inválido${why}. ${TEAM_NAME[this.current]} lança o bolim.`, tone: 'bad' });
      } else {
        report.kind = 'bolim-placed';
        this.placeBolimRandom();
        this.current = this.roundStarter;
        this.phase = 'aim';
        report.messages.push({ text: `Bolim inválido${why}. O árbitro posiciona o bolim.`, tone: 'bad' });
      }
      return report;
    }

    // bolas que não passaram da linha de arremesso saem de jogo
    for (const b of this.world.bodies) {
      if (b.kind !== 'ball' || !b.active || b.dead) continue;
      if (-b.pz < c.foulLine) {
        b.dead = true;
        b.deadReason = 'short';
        b.active = false;
      }
    }
    for (const b of this.world.bodies) {
      if (b.kind === 'ball' && b.dead && b.id === this.activeId) {
        report.deadIds.push(b.id);
        report.messages.push({
          text: b.deadReason === 'back' ? 'Bola anulada: bateu no fundo sem tocar outra' : 'Bola anulada: não passou da linha',
          tone: 'bad',
        });
      }
    }
    report.ranking = this.ranking();

    if (this.isTraining) {
      const me = this.activeId !== null ? this.world.get(this.activeId) : undefined;
      if (me && me.active && !me.dead) {
        const r = report.ranking.find((x) => x.id === me.id);
        if (r) {
          this.training.last = r.dist;
          this.training.best = this.training.best === null ? r.dist : Math.min(this.training.best, r.dist);
        }
      } else this.training.last = null;
      this.trimTrainingBalls();
      this.phase = 'aim';
      return report;
    }

    const next = nextThrower({ ranking: report.ranking, remaining: this.remaining, lastThrower: this.lastThrower, starter: this.roundStarter });
    if (next === null) {
      report.roundOver = true;
      this.endRound(report.ranking);
    } else {
      this.current = next;
      this.phase = 'aim';
    }
    return report;
  }

  private endRound(ranking: Rank[]): void {
    const res = scoreRound(ranking);
    this.lastResult = res;
    if (res.winner) {
      this.score[res.winner] += res.points;
      this.roundStarter = res.winner;
    }
    this.phase = 'round-end';
    const t = this.cfg.target;
    if (this.score.blue >= t || this.score.red >= t) this.winner = this.score.blue >= t ? 'blue' : 'red';
  }

  /** depois do resumo da rodada */
  continueAfterRound(): void {
    if (this.winner) this.phase = 'match-end';
    else this.startRound();
  }

  // ---------------------------------------------------------- treino
  private trimTrainingBalls(): void {
    const balls = this.world.bodies.filter((b) => b.kind === 'ball').sort((a, b) => a.throwIndex - b.throwIndex);
    while (balls.length > 12) {
      const b = balls.shift()!;
      this.world.remove(b.id);
    }
    // remove as anuladas que já sumiram
    for (const b of this.world.bodies.filter((x) => x.kind === 'ball' && x.dead)) this.world.remove(b.id);
  }

  collectBalls(): void {
    for (const b of this.world.bodies.filter((x) => x.kind === 'ball')) this.world.remove(b.id);
    this.training.last = null;
  }

  /** bola vermelha parada perto do bolim, para treinar o tiro */
  addRivalBall(): Body | null {
    const bo = this.world.bolim;
    if (!bo) return null;
    const c = this.court;
    for (let k = 0; k < 20; k++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(0.1, 0.35);
      const x = Math.max(-c.width / 2 + BALL.r, Math.min(c.width / 2 - BALL.r, bo.px + Math.cos(a) * (d + 0.08)));
      const z = bo.pz + Math.sin(a) * (d + 0.08);
      const clash = this.world.bodies.some((o) => o.active && Math.hypot(o.px - x, o.pz - z) < o.r + BALL.r + 0.01);
      if (clash) continue;
      const b = this.world.addBody('ball', 'red', x, BALL.r, z);
      b.asleep = true;
      b.throwIndex = ++this.throwCounter;
      return b;
    }
    return null;
  }

  startBolimThrow(): void {
    const old = this.world.bolim;
    if (old) this.world.remove(old.id);
    this.collectBalls();
    this.phase = 'bolim-aim';
  }
}
