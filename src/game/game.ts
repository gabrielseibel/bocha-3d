import * as THREE from 'three';
import { BALL, BALLS_PER_TEAM, BOLIM, PHYS_DT, makeCourt, type CourtSpec } from '../config';
import { AiClient } from '../ai/client';
import type { Plan } from '../ai/planner';
import { Sfx } from '../audio/sfx';
import { World, type BodyKind, type Team } from '../physics/world';
import { STYLE_RANGE, clampAim, defaultAim, limitAimToCourt, maxPowerForArc, releasePoint, styleOf, withStyle, type Aim, type ShotStyle } from '../physics/shot';
import { AimGuide, type GuideMode } from '../render/aimGuide';
import { BallViews } from '../render/balls';
import { CameraRig, type CamMode } from '../render/cameraRig';
import { CourtView } from '../render/court';
import { Dust, Marks, Trail } from '../render/effects';
import { Environment } from '../render/environment';
import { Crowd, Thrower } from '../render/people';
import { KitCrowd } from '../render/folks';
import type { CharacterKit } from '../render/characters';
import { Stage, type PipRect, type Quality } from '../render/stage';
import { carpetTextures, clayTextures, concreteFloorTextures, type ClayTextures } from '../render/textures';
import { VENUE_STYLES, type VenueStyle } from '../render/venueStyle';
import { venueById } from './venues';
import { Hud, byId, type AimField, type TrainingAction } from '../ui/hud';
import { Input } from '../ui/input';
import { Labels } from '../ui/labels';
import { Screens } from '../ui/screens';
import { clamp } from '../util/math';
import { randomSeed } from '../util/rng';
import { Match, type Mode, type SettleReport } from './match';
import { TEAM_NAME, scoreRound, type Rank } from './rules';
import { saveSettings, type Settings } from './settings';

type State = 'menu' | 'play' | 'paused' | 'victory';
type UserView = 'aim' | 'bolim' | 'overview';

const VIEW_NAME: Record<UserView, string> = { aim: 'Câmera do arremesso', bolim: 'Câmera do bolim', overview: 'Visão geral' };

interface Timer {
  t: number;
  fn: () => void;
}

/** Orquestra física, regras, IA, câmera, efeitos, som e interface. */
export class Game {
  readonly stage: Stage;
  readonly rig: CameraRig;
  readonly sfx = new Sfx();
  readonly settings: Settings;
  match: Match | null = null;
  world: World;
  aim: Aim = defaultAim();
  state: State = 'menu';

  private courtView: CourtView | null = null;
  private court: CourtSpec;
  private readonly env: Environment;
  private readonly crowd: Crowd | KitCrowd;
  private readonly thrower: Thrower;
  private readonly balls: BallViews;
  private readonly dust = new Dust();
  private readonly marks = new Marks();
  private readonly trail = new Trail();
  private trailLast: { id: number; x: number; y: number; z: number } | null = null;
  private readonly guide = new AimGuide();
  private readonly ai = new AiClient();
  private readonly hud: Hud;
  private readonly screens: Screens;
  private readonly labels: Labels;
  readonly input: Input;
  /** texturas de piso geradas sob demanda, uma por cancha */
  private readonly floors = new Map<string, ClayTextures>();
  private style: VenueStyle = VENUE_STYLES.clube;
  private readonly pipEl = byId('pip');
  private heldBall: THREE.Mesh | null = null;
  private heldKey = '';

  private physAcc = 0;
  private timeScale = 1;
  private slowMoT = 0;
  private restT = 0;
  private settleDelay = -1;
  private flightT = 0;
  private pendingThrow = false;
  private shotCalled = false;
  /** jogador segurando a tela/Espaço para acelerar a jogada */
  private fastForward = false;
  /** a vez atual já foi preparada (evita lançar antes da troca de vez) */
  private turnReady = false;
  private turnToken = 0;
  private aiToken = 0;
  private aiThinking = false;
  private aiAnim: { from: Aim; to: Aim; t: number; dur: number } | null = null;
  private showDistances = false;
  private userView: UserView = 'aim';
  private timers: Timer[] = [];
  private ranking: Rank[] = [];
  private labelsForced = false;
  private lastTime = 0;
  private fps = { acc: 0, frames: 0, checks: 0 };
  private qualityLevel: Quality;
  private menuWorld: World;
  private lastMode: Mode = 'cpu';

  constructor(canvas: HTMLCanvasElement, settings: Settings, kit: CharacterKit | null = null) {
    // personagens do Blender (torcida e jogador); sem eles, bonecos simples
    this.crowd = kit ? new KitCrowd(kit) : new Crowd();
    this.thrower = new Thrower(kit);
    this.settings = settings;
    this.qualityLevel = this.resolveQuality();
    this.stage = new Stage(canvas, this.qualityLevel);
    this.rig = new CameraRig(this.stage.camera, this.stage.pipCamera);
    this.env = new Environment(this.qualityLevel);
    this.balls = new BallViews(this.qualityLevel);
    const scene = this.stage.scene;
    scene.add(this.env.group, this.crowd.group, this.thrower.root, this.balls.group, this.marks.mesh, this.dust.points, this.trail.points, this.guide.group);
    this.guide.hide();
    this.thrower.root.visible = false;

    this.court = this.currentSpec();
    this.buildCourt(this.court);
    this.menuWorld = this.makeMenuWorld();
    this.world = this.menuWorld;

    this.labels = new Labels(byId('labels'));
    this.hud = new Hud({
      nudge: (f, d) => this.nudge(f, d, false),
      setFraction: (f, v) => this.setFraction(f, v),
      throwNow: () => this.humanThrow(),
      style: (st) => this.setStyle(st),
      pause: () => this.pause(),
      camera: () => this.cycleView(),
      distances: () => this.toggleDistances(),
      restart: () => this.askRestart(),
      fullscreen: () => this.toggleFullscreen(),
      training: (a) => this.trainingAction(a),
      click: () => this.sfx.click(),
    });
    this.screens = new Screens(settings, {
      play: () => this.startMatch(settings.mode),
      training: () => this.startMatch('training'),
      settingChanged: (k) => this.onSetting(k),
      resume: () => this.resume(),
      restart: () => this.startMatch(this.lastMode),
      toMenu: () => this.goMenu(),
      roundContinue: () => this.roundContinue(),
      again: () => this.startMatch(this.lastMode),
      click: () => this.sfx.click(),
    });
    this.input = new Input(canvas, {
      canAim: () => this.canHumanAim() && this.rig.mode === 'aim',
      canOrbit: () => this.state !== 'menu' && this.rig.canOrbit,
      inGame: () => (this.state === 'play' || this.state === 'paused') && !this.screens.isOpen('settings') && !this.screens.isOpen('help') && !this.screens.isOpen('confirm'),
      getAim: () => this.aim,
      setAim: (a, dragging) => {
        this.setAim(a);
        this.hud.setHint(dragging ? 'Solte para <b>lançar</b> · volte ao início para cancelar' : '', dragging);
      },
      throwNow: () => this.humanThrow(),
      cancelDrag: () => this.hud.setHint(''),
      releaseToThrow: () => this.settings.releaseToThrow,
      orbit: (dx, dy) => this.rig.orbitBy(dx, dy),
      zoom: (f) => this.rig.zoomBy(f),
      nudge: (f, d, fine) => this.nudge(f, d, fine),
      fastForward: (on) => (this.fastForward = on),
      key: (a) => {
        if (a === 'pause') {
          if (this.state === 'play') this.pause();
          else if (this.state === 'paused' && this.screens.top === 'pause') this.resume();
        } else if (this.state === 'play') {
          if (a === 'camera') this.cycleView();
          else if (a === 'style') this.setStyle(styleOf(this.aim.arc) === 'ponto' ? 'tiro' : 'ponto');
          else this.toggleDistances();
        }
      },
    });

    // áudio só pode começar após um gesto do usuário
    const unlock = () => {
      this.sfx.unlock();
      this.sfx.setVolume(settings.volume);
      this.sfx.setMuted(settings.muted);
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });

    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(canvas);
    this.onResize();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'play') this.pause();
    });
  }

  // ======================================================================= setup
  private resolveQuality(): Quality {
    const q = this.settings.quality;
    if (q !== 'auto') return q;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const small = Math.min(screen.width, screen.height) < 900;
    return coarse && small ? 'medium' : 'high';
  }

  /** dimensões + piso da cancha escolhida nas configurações */
  private currentSpec(): CourtSpec {
    return makeCourt(this.settings.courtLength, this.settings.courtWidth, venueById(this.settings.venue));
  }

  private floorTextures(style: VenueStyle): ClayTextures {
    let t = this.floors.get(style.id);
    if (!t) {
      const size = this.qualityLevel === 'low' ? 256 : 512;
      t =
        style.floor.kind === 'carpet'
          ? carpetTextures(size, style.floor.color)
          : style.floor.kind === 'concrete'
            ? concreteFloorTextures(size, style.floor.color)
            : clayTextures(size, style.floor.color);
      this.floors.set(style.id, t);
    }
    return t;
  }

  private buildCourt(spec: CourtSpec): void {
    const style = VENUE_STYLES[venueById(this.settings.venue).id];
    this.style = style;
    this.courtView?.dispose();
    this.courtView = new CourtView(spec, style, this.floorTextures(style));
    this.stage.scene.add(this.courtView.group);
    this.stage.fitShadow(spec.length, spec.width);
    this.stage.setLighting(style.light, this.courtView.lampPositions);
    this.env.layout(spec, style);
    this.dust.setColor(style.dust);
    const crowdCount = this.qualityLevel === 'high' ? 24 : this.qualityLevel === 'medium' ? 16 : 9;
    this.crowd.layout(spec, Math.max(4, Math.round(crowdCount * style.crowd)));
    this.court = spec;
    this.refreshPlaque();
  }

  private sameCourt(a: CourtSpec, b: CourtSpec): boolean {
    return a.length === b.length && a.width === b.width && a.surface === b.surface && a.ceiling === b.ceiling;
  }

  private makeMenuWorld(): World {
    const w = new World(this.court);
    const bz = -this.court.length * 0.66;
    w.addBody('bolim', null, 0.15, BOLIM.r, bz).asleep = true;
    const balls: [Team, number, number][] = [
      ['blue', 0.02, bz + 0.16],
      ['red', 0.36, bz + 0.05],
      ['blue', -0.3, bz - 0.22],
      ['red', 0.1, bz + 0.62],
      ['blue', -0.62, bz + 0.9],
      ['red', 0.7, bz - 0.5],
    ];
    for (const [t, x, z] of balls) w.addBody('ball', t, x, BALL.r, z).asleep = true;
    return w;
  }

  start(): void {
    this.screens.close('loading');
    this.goMenu();
    this.lastTime = performance.now();
    this.stage.renderer.setAnimationLoop((t) => this.frame(t));
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem('bocha3d.rotate') === '1';
    } catch {
      /* sem armazenamento */
    }
    const hint = byId('rotate-hint');
    const check = () => {
      hint.hidden = dismissed || !coarse || this.state !== 'play' || window.innerHeight <= window.innerWidth;
    };
    byId('rotate-ok').addEventListener('click', () => {
      dismissed = true;
      try {
        localStorage.setItem('bocha3d.rotate', '1');
      } catch {
        /* ok */
      }
      check();
    });
    window.addEventListener('resize', check);
    this.rotateCheck = check;
  }

  private rotateCheck: () => void = () => {};

  private onResize(): void {
    this.stage.resize();
    this.dust.setViewportHeight(this.stage.height);
    this.trail.setViewportHeight(this.stage.height);
  }

  // ======================================================================= telas
  goMenu(): void {
    this.aiToken++;
    this.ai.cancelAll();
    this.aiAnim = null;
    this.timers = [];
    this.state = 'menu';
    this.match = null;
    this.screens.closeAll();
    this.screens.open('menu');
    this.hud.show(false);
    this.hud.clearToasts();
    this.guide.hide();
    this.thrower.root.visible = false;
    this.thrower.setVisible(false);
    this.labels.hideAll();
    this.marks.clear();
    this.balls.clear();
    if (this.menuWorld.court !== this.court) this.menuWorld = this.makeMenuWorld();
    this.world = this.menuWorld;
    this.balls.setHighlights([]);
    this.sfx.setRolling(0);
    this.rig.setMode('menu');
    this.rotateCheck();
  }

  startMatch(mode: Mode): void {
    this.sfx.unlock();
    this.lastMode = mode;
    const spec = this.currentSpec();
    if (!this.sameCourt(spec, this.court)) {
      this.buildCourt(spec);
      this.menuWorld = this.makeMenuWorld();
    }
    this.aiToken++;
    this.ai.cancelAll();
    this.aiAnim = null;
    this.aiThinking = false;
    this.timers = [];
    this.pendingThrow = false;
    this.turnReady = false;
    this.timeScale = 1;
    this.slowMoT = 0;
    this.match = new Match({
      mode,
      target: this.settings.target,
      starter: this.settings.starter,
      difficulty: this.settings.difficulty,
      bolimMode: this.settings.bolimMode,
      backWallRule: this.settings.backWallRule,
      court: this.court,
    });
    this.match.start();
    this.world = this.match.world;
    this.balls.clear();
    this.balls.setHighlights([]);
    this.marks.clear();
    this.screens.closeAll();
    this.hud.show(true);
    this.hud.clearToasts();
    this.hud.setTraining(mode === 'training');
    this.state = 'play';
    this.userView = 'aim';
    this.showDistances = false;
    this.hud.setDistancesPressed(false);
    this.updateScoreboard(null);
    this.courtView?.setScore({ blue: 0, red: 0, round: 1, target: this.settings.target, training: mode === 'training' });
    this.rig.setMode('aim', null, true);
    this.thrower.setVisible(this.settings.thrower);
    this.beginTurn(true);
    this.rotateCheck();
    if (mode !== 'training') {
      const m = this.match;
      this.hud.toast(`${TEAM_NAME[m.roundStarter]} começa`, m.roundStarter);
    }
  }

  private pause(): void {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.sfx.setRolling(0);
    this.screens.open('pause');
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.screens.close('pause');
    this.screens.close('settings');
    this.screens.close('help');
    this.state = 'play';
    this.lastTime = performance.now();
  }

  private askRestart(): void {
    if (!this.match) return;
    if (this.match.isTraining) {
      this.startMatch('training');
      return;
    }
    this.state = 'paused';
    this.screens.confirm(
      'Reiniciar a partida?',
      'O placar volta a zero.',
      'REINICIAR',
      () => this.startMatch(this.lastMode),
      () => {
        // cancelou: volta ao jogo (se não estava no menu de pausa)
        if (this.state === 'paused' && !this.screens.isOpen('pause')) {
          this.state = 'play';
          this.lastTime = performance.now();
        }
      },
    );
  }

  private toggleFullscreen(): void {
    const el = byId('app');
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      void el.requestFullscreen?.().then(() => {
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        o.lock?.('landscape').catch(() => {});
      });
  }

  private onSetting(k: keyof Settings): void {
    saveSettings(this.settings);
    switch (k) {
      case 'volume':
        this.sfx.setVolume(this.settings.volume);
        break;
      case 'muted':
        this.sfx.setMuted(this.settings.muted);
        break;
      case 'quality': {
        const q = this.resolveQuality();
        this.qualityLevel = q;
        this.stage.setQuality(q);
        break;
      }
      case 'thrower':
        this.thrower.setVisible(this.settings.thrower && this.state !== 'menu');
        break;
      case 'backWallRule':
        if (this.match) this.match.world.backWallRule = this.settings.backWallRule;
        break;
      case 'courtLength':
      case 'courtWidth':
      case 'venue':
        if (this.state === 'menu') {
          this.buildCourt(this.currentSpec());
          this.menuWorld = this.makeMenuWorld();
          this.balls.clear();
          this.world = this.menuWorld;
        } else this.hud.toast('A nova cancha vale a partir da próxima partida', 'info');
        break;
      default:
        break;
    }
  }

  // ======================================================================= turnos
  private get kind(): BodyKind {
    return this.match?.phase === 'bolim-aim' ? 'bolim' : 'ball';
  }

  private canHumanAim(): boolean {
    const m = this.match;
    return (
      this.state === 'play' &&
      !!m &&
      (m.phase === 'aim' || m.phase === 'bolim-aim') &&
      m.isHumanTurn() &&
      this.turnReady &&
      !this.pendingThrow &&
      !this.aiThinking &&
      this.aiAnim === null
    );
  }

  /** prepara a vez da equipe atual (humano ou IA) */
  private beginTurn(first = false): void {
    const m = this.match;
    if (!m || this.state === 'menu' || this.pendingThrow) return;
    this.turnToken++;
    this.turnReady = true;
    const team = m.current;
    const isBolim = m.phase === 'bolim-aim';
    this.aim = clampAim(isBolim ? { ...m.bolimAim } : { ...m.aims[team] }, this.court);
    this.thrower.reset();
    this.thrower.setTeam(team);
    this.thrower.setVisible(this.settings.thrower);
    this.setHeldBall(isBolim ? 'bolim' : team);
    this.setAim(this.aim);
    this.guide.setColor(isBolim ? '#ffe066' : team === 'blue' ? '#3d9bff' : '#ff4f45');
    this.balls.setHighlights([]);
    this.labelsForced = false;
    this.rig.setMode(this.userView === 'aim' ? 'aim' : this.userView, null, first);
    this.refreshRanking();
    this.updateScoreboard(null);
    const who = m.isTraining ? '' : `${TEAM_NAME[team].toUpperCase()}`;
    if (m.isTraining) this.hud.setTurn('blue', isBolim ? 'LANCE O BOLIM' : 'TREINO LIVRE');
    else this.hud.setTurn(team, isBolim ? `${who} LANÇA O BOLIM` : `VEZ DO ${who}`);
    this.hud.setControlsVisible(true);
    if (!first) this.sfx.turn();
    if (m.isHumanTurn()) {
      this.hud.setControlsEnabled(true);
      this.hud.setHint('');
    } else {
      this.hud.setControlsEnabled(false);
      this.hud.setHint(null);
      void this.runAi();
    }
  }

  /** agenda a próxima vez; chamadas antigas são descartadas se algo mudar antes */
  private scheduleTurn(delay: number): void {
    const tk = ++this.turnToken;
    this.later(delay, () => {
      if (tk === this.turnToken) this.beginTurn();
    });
  }

  private setHeldBall(key: Team | 'bolim'): void {
    if (this.heldKey === key && this.heldBall) {
      this.heldBall.visible = true;
      return;
    }
    if (this.heldBall) this.thrower.heldBall.remove(this.heldBall);
    this.heldBall = this.balls.makeHeldBall(key);
    this.thrower.heldBall.add(this.heldBall);
    this.heldKey = key;
  }

  private async runAi(): Promise<void> {
    const m = this.match!;
    const token = ++this.aiToken;
    const team = m.current;
    this.aiThinking = true;
    const isBolim = m.phase === 'bolim-aim';
    this.hud.setTurn(team, `${TEAM_NAME[team].toUpperCase()} (CPU) PENSANDO…`, true);
    const t0 = performance.now();
    let plan: Plan;
    try {
      plan = await this.ai.plan({ kind: isBolim ? 'bolim' : 'ball', world: m.world.toData(), team, difficulty: m.cfg.difficulty, seed: randomSeed() });
    } catch {
      plan = { aim: { ...this.aim }, intent: 'ponto', expected: 0 };
    }
    const wait = Math.max(0, 850 - (performance.now() - t0));
    await new Promise((r) => window.setTimeout(r, wait));
    if (token !== this.aiToken || this.match !== m) return;
    this.aiThinking = false;
    this.hud.setTurn(team, isBolim ? `${TEAM_NAME[team].toUpperCase()} LANÇA O BOLIM` : `VEZ DO ${TEAM_NAME[team].toUpperCase()} (CPU)`);
    if (plan.intent === 'tiro') this.hud.toast(`${TEAM_NAME[team]} vai de tiro!`, team, 1500);
    else if (plan.intent === 'bolim') this.hud.toast(`${TEAM_NAME[team]} vai no bolim!`, team, 1500);
    else if (plan.intent === 'empurrar') this.hud.toast(`${TEAM_NAME[team]} vai empurrar`, team, 1300);
    // trocando de ponto para tiro (ou vice-versa) a altura muda direto, sem passar pela faixa intermediária
    const from = { ...this.aim };
    if (styleOf(from.arc) !== styleOf(plan.aim.arc)) from.arc = plan.aim.arc;
    this.aiAnim = { from, to: plan.aim, t: 0, dur: 0.9 };
  }

  private humanThrow(): void {
    if (!this.canHumanAim()) return;
    if (this.aim.power < 0.02) {
      this.hud.toast('Dê força ao arremesso: arraste para baixo ou use a barra de força', 'info');
      return;
    }
    this.doThrow();
  }

  private doThrow(): void {
    const m = this.match;
    if (!m || this.pendingThrow || (m.phase !== 'aim' && m.phase !== 'bolim-aim')) return;
    this.pendingThrow = true;
    this.turnReady = false;
    this.turnToken++;
    const kind = this.kind;
    const aim = limitAimToCourt(clampAim(this.aim, this.court), this.court, kind);
    this.aim = aim;
    this.thrower.placeFor(releasePoint(aim, this.court), styleOf(aim.arc));
    this.hud.setControlsEnabled(false);
    this.hud.setHint(null);
    this.guide.hide();
    const release = () => {
      if (this.match !== m || this.state === 'menu') return;
      const b = m.throw(aim);
      this.pendingThrow = false;
      this.shotCalled = false;
      this.sfx.whoosh(aim.power);
      this.flightT = 0;
      this.restT = 0;
      this.settleDelay = -1;
      this.rig.setMode('follow', b.id);
      this.hud.setHint('Segure na tela (ou <b>Espaço</b>) para acelerar a jogada');
      this.trail.clear();
      this.trail.setColor(kind === 'bolim' ? '#ffffff' : m.current === 'blue' ? '#9cc4ff' : '#ffb0a8');
      this.updateScoreboard(null);
      if (this.heldBall) this.heldBall.visible = false;
    };
    if (this.settings.thrower) this.thrower.throw(release);
    else this.later(0.05, release);
  }

  // ======================================================================= mira
  private setAim(a: Aim): void {
    let x = clampAim(a, this.court);
    x = limitAimToCourt(x, this.court, this.kind);
    this.aim = x;
    this.thrower.placeFor(releasePoint(x, this.court), styleOf(x.arc));
    this.hud.setAim(x, this.court, maxPowerForArc(x.arc, this.court), this.kind === 'bolim');
  }

  private nudge(field: AimField, dir: 1 | -1, fine: boolean): void {
    if (!this.canHumanAim()) return;
    const a = { ...this.aim };
    switch (field) {
      case 'yaw':
        a.yaw += dir * (fine ? 0.05 : 0.2);
        break;
      case 'arc':
        a.arc = Math.round((a.arc + dir * (fine ? 0.25 : 1)) * 4) / 4;
        break;
      case 'power':
        a.power += dir * (fine ? 0.002 : 0.01);
        break;
      case 'x0':
        a.x0 += dir * (fine ? 0.02 : 0.05);
        break;
    }
    this.setAim(a);
  }

  /** quanto da previsão da mira mostrar (configurável; 'auto' segue a dificuldade) */
  private guideMode(): GuideMode {
    const g = this.settings.guide;
    if (g !== 'auto') return g;
    const m = this.match;
    if (!m || m.isTraining) return 'full';
    if (m.cfg.mode === 'pvp') return 'short';
    return m.cfg.difficulty === 'easy' ? 'full' : m.cfg.difficulty === 'medium' ? 'short' : 'off';
  }

  /** ponto (agachado, rasteiro) ou tiro (alto, para bater) */
  private setStyle(style: ShotStyle): void {
    if (!this.canHumanAim() || styleOf(this.aim.arc) === style) return;
    this.setAim(withStyle(this.aim, style));
    this.hud.toast(style === 'ponto' ? 'Ponto: agachado, bola rente ao chão' : 'Tiro: bola alta e forte para bater', 'info', 1300);
  }

  private setFraction(field: 'power' | 'arc', v: number): void {
    if (!this.canHumanAim()) return;
    if (field === 'power') this.setAim({ ...this.aim, power: Math.round(v * 1000) / 1000 });
    else {
      const r = STYLE_RANGE[styleOf(this.aim.arc)];
      this.setAim({ ...this.aim, arc: Math.round((r.min + v * (r.max - r.min)) * 4) / 4 });
    }
  }

  // ======================================================================= câmera / UI
  private cycleView(): void {
    if (this.state !== 'play') return;
    const order: UserView[] = ['aim', 'bolim', 'overview'];
    this.userView = order[(order.indexOf(this.userView) + 1) % order.length];
    if (!this.match?.inFlight && this.rig.mode !== 'settle') this.rig.setMode(this.userView);
    this.hud.toast(VIEW_NAME[this.userView], 'info', 1100);
  }

  private toggleDistances(): void {
    this.showDistances = !this.showDistances;
    this.hud.setDistancesPressed(this.showDistances);
    if (this.showDistances && this.userView === 'aim' && this.match && !this.match.inFlight) {
      this.userView = 'bolim';
      this.rig.setMode('bolim');
    } else if (!this.showDistances && this.userView === 'bolim' && this.match && !this.match.inFlight) {
      this.userView = 'aim';
      this.rig.setMode('aim');
    }
  }

  private updateScoreboard(bump: Team | null): void {
    const m = this.match;
    if (!m) return;
    if (m.isTraining) {
      this.hud.setTrainingStats(m.training.thrown, m.training.last, m.training.best);
      return;
    }
    this.hud.setScore(m.score, m.round, m.cfg.target, bump);
    this.hud.setRemaining(m.remaining, BALLS_PER_TEAM);
  }

  private refreshRanking(): void {
    this.ranking = this.match ? this.match.ranking() : [];
    const m = this.match;
    if (!m || m.isTraining || !this.ranking.length) {
      this.hud.setPointInfo('');
      return;
    }
    const res = scoreRound(this.ranking);
    if (res.tie) this.hud.setPointInfo('Ponto empatado');
    else if (res.winner) {
      const best = this.ranking[0];
      const cm = best.dist * 100;
      this.hud.setPointInfo(`Ponto: ${TEAM_NAME[res.winner]} · ${cm < 10 ? cm.toFixed(1).replace('.', ',') : Math.round(cm)} cm`);
    }
  }

  private trainingAction(a: TrainingAction): void {
    const m = this.match;
    if (!m || !m.isTraining || m.inFlight || this.pendingThrow) return;
    if (a === 'collect') {
      m.collectBalls();
      this.marks.clear();
    } else if (a === 'bolim') {
      m.collectBalls();
      m.placeBolimRandom();
      m.phase = 'aim';
      this.marks.clear();
    } else if (a === 'throw-bolim') {
      m.startBolimThrow();
      this.marks.clear();
    } else if (a === 'rival') {
      if (!m.addRivalBall()) this.hud.toast('Sem espaço perto do bolim', 'bad');
    }
    this.beginTurn();
  }

  // ======================================================================= laço principal
  private later(t: number, fn: () => void): void {
    this.timers.push({ t, fn });
  }

  private frame(t: number): void {
    const dt = Math.min(0.05, Math.max(0, (t - this.lastTime) / 1000));
    this.lastTime = t;
    this.tick(dt);
    this.render();
    this.watchFps(dt);
  }

  /** avança o jogo dt segundos (também usado pelos testes automatizados) */
  tick(dt: number): void {
    if (this.state === 'play') this.updatePlay(dt);
    this.balls.sync(this.world, dt);
    this.dust.update(dt);
    this.trail.update(dt);
    this.crowd.update(dt);
    this.thrower.update(dt);
    if (this.match && this.state !== 'menu') {
      const m = this.match;
      const aiming = (m.phase === 'aim' || m.phase === 'bolim-aim') && !this.pendingThrow;
      if (aiming) this.guide.update(this.aim, this.court, this.kind, this.guideMode(), this.world.backWallRule, dt);
      else this.guide.hide();
      this.thrower.root.visible = this.thrower.root.visible && this.settings.thrower;
    }
    this.rig.update(dt, { world: this.world, court: this.court, aim: this.aim });
    const show = this.state !== 'menu' && (this.showDistances || this.settings.alwaysDistances || this.labelsForced);
    this.labels.update(this.stage.camera, this.world, this.ranking, this.stage.width, this.stage.height, show && this.state !== 'victory');
  }

  private render(): void {
    this.stage.render(this.pipRect());
  }

  private pipRect(): PipRect | null {
    const m = this.match;
    const want =
      this.settings.pip &&
      (this.state === 'play' || this.state === 'paused') &&
      !!m &&
      !!this.world.bolim &&
      (this.rig.mode === 'aim' || this.rig.mode === 'follow' || this.rig.mode === 'overview') &&
      m.phase !== 'round-end' &&
      m.phase !== 'bolim-aim' &&
      m.phase !== 'bolim-flight';
    this.pipEl.hidden = !want;
    if (!want) return null;
    const r = this.pipEl.getBoundingClientRect();
    const c = this.stage.renderer.domElement.getBoundingClientRect();
    return { x: r.left - c.left + 2, y: r.top - c.top + 2, w: r.width - 4, h: r.height - 4 };
  }

  private watchFps(dt: number): void {
    if (this.settings.quality !== 'auto' || this.state !== 'play' || this.qualityLevel === 'low') return;
    // quadros travados (aba oculta, painel em segundo plano, alerta do sistema) não contam
    if (document.visibilityState !== 'visible' || dt > 0.1) {
      this.fps.acc = 0;
      this.fps.frames = 0;
      return;
    }
    this.fps.acc += dt;
    this.fps.frames++;
    if (this.fps.acc >= 3) {
      const fps = this.fps.frames / this.fps.acc;
      this.fps.acc = 0;
      this.fps.frames = 0;
      if (++this.fps.checks >= 3 && fps < 34) {
        this.qualityLevel = this.qualityLevel === 'high' ? 'medium' : 'low';
        this.stage.setQuality(this.qualityLevel);
        this.onResize();
        this.hud.toast('Qualidade gráfica ajustada para manter a fluidez', 'info');
      }
    }
  }

  private updatePlay(dt: number): void {
    const m = this.match;
    if (!m) return;
    // timers do jogo (pausam junto com a partida)
    if (this.timers.length) {
      const due: Timer[] = [];
      for (const tm of this.timers) {
        tm.t -= dt;
        if (tm.t <= 0) due.push(tm);
      }
      if (due.length) {
        this.timers = this.timers.filter((x) => !due.includes(x));
        for (const tm of due) tm.fn();
      }
    }
    // IA "mexendo na mira" antes de lançar
    if (this.aiAnim) {
      const a = this.aiAnim;
      a.t += dt;
      const k = clamp(a.t / a.dur, 0, 1);
      const e = k * k * (3 - 2 * k);
      const mid: Aim = {
        x0: a.from.x0 + (a.to.x0 - a.from.x0) * e,
        yaw: a.from.yaw + (a.to.yaw - a.from.yaw) * e,
        arc: a.from.arc + (a.to.arc - a.from.arc) * e,
        power: a.from.power + (a.to.power - a.from.power) * e,
      };
      this.aim = k >= 1 ? a.to : mid;
      this.thrower.placeFor(releasePoint(this.aim, this.court), styleOf(this.aim.arc));
      this.hud.setAim(this.aim, this.court, maxPowerForArc(this.aim.arc, this.court), this.kind === 'bolim');
      if (k >= 1) {
        this.aiAnim = null;
        this.doThrow();
      }
    }
    // física em passo fixo (com câmera lenta nos tiros)
    if (!this.world.atRest) {
      const ff = this.fastForward && m.inFlight && this.slowMoT <= 0 ? 3 : 1;
      this.physAcc += dt * this.timeScale * ff;
      let n = 0;
      while (this.physAcc >= PHYS_DT && n < 400) {
        this.world.step();
        this.physAcc -= PHYS_DT;
        n++;
      }
      if (n >= 400) this.physAcc = 0;
    } else this.physAcc = 0;
    this.processEvents();
    if (this.slowMoT > 0) {
      this.slowMoT -= dt;
      if (this.slowMoT <= 0) this.timeScale = 1;
    }
    let roll = 0;
    for (const b of this.world.bodies) if (b.active && b.grounded && !b.asleep) roll += Math.hypot(b.vx, b.vz) * (b.kind === 'bolim' ? 0.35 : 1);
    this.sfx.setRolling(roll / 4);

    if (m.inFlight) {
      this.flightT += dt;
      const ab = m.activeId !== null ? this.world.get(m.activeId) : undefined;
      if (ab && ab.active && !ab.grounded) {
        // rastro contínuo: preenche o espaço percorrido neste quadro
        const lp = this.trailLast;
        if (lp && lp.id === ab.id) {
          const d = Math.hypot(ab.px - lp.x, ab.py - lp.y, ab.pz - lp.z);
          const n = Math.min(6, Math.floor(d / (ab.r * 0.9)));
          for (let i = 1; i <= n; i++) {
            const t = i / (n + 1);
            this.trail.push(lp.x + (ab.px - lp.x) * t, lp.y + (ab.py - lp.y) * t, lp.z + (ab.pz - lp.z) * t, ab.r);
          }
        }
        this.trail.push(ab.px, ab.py, ab.pz, ab.r);
        this.trailLast = { id: ab.id, x: ab.px, y: ab.py, z: ab.pz };
      } else this.trailLast = null;
      if (this.settleDelay > 0) {
        this.settleDelay -= dt;
        if (this.settleDelay <= 0 && this.rig.mode === 'follow') this.rig.setMode('settle', m.activeId);
      }
      // jogador fica transparente se a câmera passar por ele
      this.thrower.setFaded(this.rig.mode === 'follow' && this.flightT < 0.6);
      if (this.world.atRest || this.flightT > 40) {
        this.restT += dt;
        if (this.restT > 0.45 || this.flightT > 40) this.onSettled();
      } else this.restT = 0;
    }
  }

  private processEvents(): void {
    const w = this.world;
    const m = this.match;
    for (const e of w.events) {
      switch (e.type) {
        case 'land': {
          const b = w.get(e.id);
          const small = b?.kind === 'bolim';
          this.sfx.thud(e.speed, small);
          this.dust.burst(e.x, e.z, e.speed * (small ? 0.45 : 1), e.vx, e.vz);
          if (e.speed > 1.1 && this.style.marks) this.marks.add(e.x, e.z, (small ? 0.06 : 0.12) + e.speed * (small ? 0.004 : 0.009), e.vx, e.vz);
          if (e.speed > 4.5 && !small) this.rig.addShake(0.12 + e.speed * 0.015);
          if (m && e.id === m.activeId && this.settleDelay < 0) this.settleDelay = 0.4;
          break;
        }
        case 'hit': {
          const a = w.get(e.a);
          const b = w.get(e.b);
          const bolim = a?.kind === 'bolim' || b?.kind === 'bolim';
          this.sfx.clack(e.speed, bolim);
          this.dust.burst(e.x, e.z, e.speed * 0.25, 0, 0, Math.max(0.02, e.y - 0.05));
          const active = !!m && (e.a === m.activeId || e.b === m.activeId);
          if (active && !this.shotCalled && e.speed > 4) {
            // tiro: a bola lançada chega forte numa bola parada (ou no bolim)
            this.shotCalled = true;
            if (this.settings.slowMo) {
              this.timeScale = e.air ? 0.25 : 0.4;
              this.slowMoT = e.air ? 0.8 : 0.5;
            }
            this.hud.toast(bolim ? 'NO BOLIM!' : e.air ? 'TIRO DE AR!' : 'TIRO!', 'big', 1300);
            this.crowd.cheer(e.air ? 1 : 0.7);
            this.sfx.applause(e.air ? 0.7 : 0.45);
            this.rig.addShake(e.air ? 0.4 : 0.25);
          } else if (e.speed > 2) this.rig.addShake(0.12);
          if (m && this.settleDelay < 0) this.settleDelay = 0.25;
          break;
        }
        case 'wall':
          this.sfx.wall(e.speed);
          if (e.speed > 1.2) this.dust.burst(e.x, e.z, e.speed * 0.2, 0, 0, Math.max(0.02, e.y - 0.04));
          break;
        case 'dead':
          this.sfx.error();
          break;
      }
    }
    w.events.length = 0;
  }

  private onSettled(): void {
    const m = this.match;
    if (!m || !m.inFlight) return;
    this.restT = 0;
    const report: SettleReport = m.settle();
    this.turnReady = false;
    this.sfx.setRolling(0);
    for (const msg of report.messages) this.hud.toast(msg.text, msg.tone === 'good' ? 'info' : msg.tone, 2300);
    this.refreshRanking();
    this.updateScoreboard(null);
    if (report.kind !== 'ball') {
      // bolim lançado (válido ou não)
      this.scheduleTurn(report.kind === 'bolim-ok' ? 0.9 : 1.6);
      return;
    }
    if (m.isTraining) {
      const last = m.training.last;
      if (last !== null) {
        const cm = last * 100;
        const txt = `${cm < 10 ? cm.toFixed(1).replace('.', ',') : Math.round(cm)} cm do bolim`;
        this.hud.toast(cm < 5 ? `Na mosca! ${txt}` : txt, cm < 5 ? 'big' : 'info', 1600);
        if (cm < 5) {
          this.sfx.chime();
          this.crowd.cheer(0.6);
        }
      }
      this.labelsForced = true;
      this.scheduleTurn(1.2);
      return;
    }
    // mostra quem tem o ponto, destaca a bola e segue
    this.labelsForced = true;
    const res = scoreRound(report.ranking);
    if (res.winner && report.ranking.length) this.balls.setHighlights([report.ranking[0].id], res.winner === 'blue' ? '#7fb0ff' : '#ff8c84');
    if (report.roundOver) {
      this.later(0.6, () => this.showRoundEnd());
      return;
    }
    const me = m.lastThrower;
    if (res.winner && me && res.winner === me && !report.deadIds.length) {
      const best = report.ranking[0];
      if (best.dist < 0.05) {
        this.hud.toast('Encostou no bolim!', me, 1500);
        this.crowd.cheer(0.5);
      } else this.hud.toast(`Ponto do ${TEAM_NAME[me]}`, me, 1300);
    }
    this.scheduleTurn(1.35);
  }

  private showRoundEnd(): void {
    const m = this.match;
    if (!m || !m.lastResult) return;
    const res = m.lastResult;
    this.balls.setHighlights(res.scoringIds, '#ffd54a');
    this.labelsForced = true;
    this.rig.setMode('bolim');
    this.rig.orbit.dist = 2.4;
    this.hud.setControlsVisible(false);
    this.hud.setHint(null);
    this.hud.setTurn(res.winner, res.winner ? `${TEAM_NAME[res.winner].toUpperCase()} +${res.points}` : 'SEM PONTOS');
    this.updateScoreboard(res.winner);
    this.courtView?.setScore({ blue: m.score.blue, red: m.score.red, round: m.round, target: m.cfg.target, training: false });
    this.sfx.chime();
    if (res.points >= 2) {
      this.sfx.applause(0.4 + res.points * 0.15);
      this.crowd.cheer(0.4 + res.points * 0.15);
    }
    this.later(0.9, () => this.screens.showRound(res, m.score, m.round, m.winner !== null));
  }

  private roundContinue(): void {
    const m = this.match;
    if (!m) return;
    this.screens.close('round');
    m.continueAfterRound();
    if (m.phase === 'match-end' && m.winner) {
      this.state = 'victory';
      this.hud.show(false);
      this.guide.hide();
      this.rig.setMode('victory');
      this.sfx.fanfare();
      this.crowd.cheer(1);
      this.screens.showVictory(m.winner, m.score, m.cfg.target, m.cfg.mode === 'cpu');
      return;
    }
    this.marks.clear();
    this.balls.setHighlights([]);
    this.labelsForced = false;
    this.courtView?.setScore({ blue: m.score.blue, red: m.score.red, round: m.round, target: m.cfg.target, training: false });
    this.hud.toast(`Rodada ${m.round}`, 'info', 1200);
    this.beginTurn();
  }

  refreshPlaque(): void {
    const m = this.match;
    this.courtView?.setScore({
      blue: m?.score.blue ?? 0,
      red: m?.score.red ?? 0,
      round: m?.round ?? 1,
      target: m?.cfg.target ?? this.settings.target,
      training: m?.isTraining ?? false,
    });
  }

  // ======================================================================= depuração / testes
  debugApi() {
    return {
      game: this,
      /** avança o jogo manualmente (o painel do navegador oculto pausa o requestAnimationFrame) */
      step: (seconds: number, fps = 60) => {
        const dt = 1 / fps;
        for (let t = 0; t < seconds; t += dt) this.tick(dt);
        this.render();
      },
      render: () => this.render(),
      state: () => ({
        state: this.state,
        phase: this.match?.phase ?? null,
        mode: this.match?.cfg.mode ?? null,
        current: this.match?.current ?? null,
        score: this.match ? { ...this.match.score } : null,
        round: this.match?.round ?? 0,
        remaining: this.match ? { ...this.match.remaining } : null,
        aim: { ...this.aim },
        cam: this.rig.mode as CamMode,
        bodies: this.world.bodies.map((b) => ({ id: b.id, kind: b.kind, team: b.team, x: +b.px.toFixed(3), y: +b.py.toFixed(3), z: +b.pz.toFixed(3), active: b.active, dead: b.dead, asleep: b.asleep })),
        ranking: this.ranking.map((r) => ({ team: r.team, cm: +(r.dist * 100).toFixed(1) })),
        humanTurn: this.canHumanAim(),
        aiThinking: this.aiThinking,
        screens: [...document.querySelectorAll('.screen:not([hidden])')].map((s) => s.id),
      }),
      setAim: (a: Partial<Aim>) => this.setAim({ ...this.aim, ...a }),
      throw: () => this.humanThrow(),
      start: (mode: Mode) => this.startMatch(mode),
      continueRound: () => this.roundContinue(),
      menu: () => this.goMenu(),
    };
  }
}
