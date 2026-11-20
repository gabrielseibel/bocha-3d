import { AIM } from '../config';
import type { Aim } from '../physics/shot';
import { clamp } from '../util/math';
import type { AimField } from './hud';

export interface InputCallbacks {
  /** pode mirar agora (vez de um humano, fase de mira, câmera de arremesso) */
  canAim(): boolean;
  /** pode girar a câmera (modos de inspeção) */
  canOrbit(): boolean;
  /** pode usar o teclado do jogo (fora de menus) */
  inGame(): boolean;
  getAim(): Aim;
  setAim(aim: Aim, dragging: boolean): void;
  throwNow(): void;
  cancelDrag(): void;
  releaseToThrow(): boolean;
  orbit(dx: number, dy: number): void;
  zoom(f: number): void;
  nudge(field: AimField, dir: 1 | -1, fine: boolean): void;
  key(action: 'camera' | 'distances' | 'pause' | 'style'): void;
  /** segurar a tela/Espaço acelera a jogada em andamento */
  fastForward(on: boolean): void;
}

/** Arrastar na tela: para baixo = força, para os lados = direção. Soltar = lançar. */
export class Input {
  private readonly el: HTMLElement;
  private readonly cb: InputCallbacks;
  private drag: { id: number; x0: number; y0: number; aim0: Aim; moved: boolean } | null = null;
  private orbitPtr: { id: number; x: number; y: number } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  /** feedback para a HUD */
  dragging = false;

  constructor(el: HTMLElement, cb: InputCallbacks) {
    this.el = el;
    this.cb = cb;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') this.cb.fastForward(false);
    });
  }

  private dragScale(): { power: number; yaw: number } {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    // distância de arraste para força total: ~34% da menor dimensão
    const power = clamp(Math.min(w, h) * 0.34, 110, 320);
    // meia largura da tela ≈ 12° de direção
    const yaw = 12 / Math.max(160, w * 0.5);
    return { power, yaw };
  }

  private onDown = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      // pinça: cancela a mira em andamento
      if (this.drag) this.cancel();
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.orbitPtr = null;
      return;
    }
    if (this.pointers.size > 2) return;
    this.cb.fastForward(true);
    if (this.cb.canAim()) {
      this.el.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, aim0: { ...this.cb.getAim() }, moved: false };
      this.dragging = true;
      e.preventDefault();
    } else if (this.cb.canOrbit()) {
      this.el.setPointerCapture(e.pointerId);
      this.orbitPtr = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2 && this.cb.canOrbit()) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0 && d > 0) this.cb.zoom(this.pinchDist / d);
      this.pinchDist = d;
      return;
    }
    if (this.drag && e.pointerId === this.drag.id) {
      const s = this.dragScale();
      const dx = e.clientX - this.drag.x0;
      const dy = e.clientY - this.drag.y0;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
      const aim: Aim = {
        ...this.drag.aim0,
        yaw: clamp(this.drag.aim0.yaw + dx * s.yaw, -AIM.yawMax, AIM.yawMax),
        power: clamp(dy / s.power, 0, 1),
      };
      this.cb.setAim(aim, true);
      return;
    }
    if (this.orbitPtr && e.pointerId === this.orbitPtr.id) {
      this.cb.orbit(e.clientX - this.orbitPtr.x, e.clientY - this.orbitPtr.y);
      this.orbitPtr.x = e.clientX;
      this.orbitPtr.y = e.clientY;
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.cb.fastForward(false);
    if (this.pointers.size < 2) this.pinchDist = 0;
    if (this.drag && e.pointerId === this.drag.id) {
      const d = this.drag;
      this.drag = null;
      this.dragging = false;
      const aim = this.cb.getAim();
      if (!d.moved) {
        // toque sem arrastar: não muda nada
        this.cb.setAim(d.aim0, false);
        return;
      }
      if (aim.power < 0.03) {
        // voltou ao ponto inicial: cancela
        this.cb.setAim(d.aim0, false);
        this.cb.cancelDrag();
        return;
      }
      this.cb.setAim(aim, false);
      if (this.cb.releaseToThrow()) this.cb.throwNow();
      return;
    }
    if (this.orbitPtr && e.pointerId === this.orbitPtr.id) this.orbitPtr = null;
  };

  private onCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.cb.fastForward(false);
    if (this.drag && e.pointerId === this.drag.id) this.cancel();
    if (this.orbitPtr && e.pointerId === this.orbitPtr.id) this.orbitPtr = null;
  };

  private cancel(): void {
    if (!this.drag) return;
    this.cb.setAim(this.drag.aim0, false);
    this.drag = null;
    this.dragging = false;
    this.cb.cancelDrag();
  }

  private onWheel = (e: WheelEvent): void => {
    if (!this.cb.inGame()) return;
    e.preventDefault();
    if (this.cb.canOrbit()) this.cb.zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
    else if (this.cb.canAim()) this.cb.nudge('arc', e.deltaY > 0 ? -1 : 1, e.shiftKey);
  };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.cb.inGame() || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.getAttribute('role') === 'slider')) return;
    const k = e.key.toLowerCase();
    const fine = e.shiftKey;
    const aimKeys: Record<string, [AimField, 1 | -1]> = {
      arrowleft: ['yaw', -1],
      arrowright: ['yaw', 1],
      arrowup: ['arc', 1],
      arrowdown: ['arc', -1],
      w: ['power', 1],
      s: ['power', -1],
      '+': ['power', 1],
      '=': ['power', 1],
      '-': ['power', -1],
      a: ['x0', -1],
      d: ['x0', 1],
    };
    if (k === 'escape') {
      this.cb.key('pause');
      e.preventDefault();
      return;
    }
    if (k === 'c') return this.cb.key('camera');
    if (k === 'v') return this.cb.key('distances');
    if (k === 't') return this.cb.key('style');
    if (!this.cb.canAim()) {
      if (k === ' ') {
        this.cb.fastForward(true);
        e.preventDefault();
      }
      return;
    }
    if (aimKeys[k]) {
      const [f, dir] = aimKeys[k];
      this.cb.nudge(f, dir, fine);
      e.preventDefault();
    } else if (k === ' ' || k === 'enter') {
      if (target && target.tagName === 'BUTTON' && k === 'enter') return;
      if (!e.repeat) this.cb.throwNow();
      e.preventDefault();
    }
  };
}
