// Efeitos sonoros 100% sintetizados com Web Audio (nenhum arquivo de áudio).

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private applauseBuf!: AudioBuffer;
  private rollGain!: GainNode;
  private crunchGain!: GainNode;
  private volume = 0.8;
  private muted = false;
  private lastClack = 0;

  /** precisa ser chamado num gesto do usuário (clique/toque) */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.noise = this.makeNoise(2, false);
    this.applauseBuf = this.makeApplause(4.5);
    // rolamento: ruído marrom filtrado em loop, volume controlado pela velocidade
    const brown = this.makeNoise(3, true);
    const src = ctx.createBufferSource();
    src.buffer = brown;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    src.connect(lp).connect(this.rollGain).connect(this.master);
    const src2 = ctx.createBufferSource();
    src2.buffer = this.noise;
    src2.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.8;
    this.crunchGain = ctx.createGain();
    this.crunchGain.gain.value = 0;
    src2.connect(bp).connect(this.crunchGain).connect(this.master);
    src.start();
    src2.start();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  private makeNoise(seconds: number, brown: boolean): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  /** aplausos: centenas de palmas curtas com timbres variados */
  private makeApplause(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(2, Math.floor(sr * seconds), sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const claps = Math.floor(seconds * 55);
      for (let c = 0; c < claps; c++) {
        const t = Math.random() * seconds;
        const env = Math.min(1, t / 0.35) * Math.min(1, (seconds - t) / 1.6);
        const start = Math.floor(t * sr);
        const len = Math.floor(sr * (0.012 + Math.random() * 0.02));
        const amp = (0.25 + Math.random() * 0.5) * env;
        const f = 0.2 + Math.random() * 0.5; // "brilho" da palma
        let lp = 0;
        for (let i = 0; i < len && start + i < d.length; i++) {
          const w = Math.random() * 2 - 1;
          lp += f * (w - lp);
          d[start + i] += (w - lp) * amp * Math.exp(-i / (len * 0.3));
        }
      }
    }
    return buf;
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private noiseBurst(t: number, type: BiquadFilterType, freq: number, q: number, peak: number, decay: number, rate = 1): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, peak, 0.003, decay);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 1.5);
    s.stop(t + decay + 0.05);
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, peak: number, decay: number, attack = 0.004): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + decay);
    const g = ctx.createGain();
    this.env(g, t, peak, attack, decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  /** bola caindo no saibro: baque surdo + areia */
  thud(speed: number, small = false): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const i = Math.min(1, speed / 9);
    const base = small ? 170 : 105;
    this.tone(t, 'sine', base * (1 + i * 0.2), base * 0.55, 0.55 * i + 0.05, 0.16 + i * 0.08);
    this.noiseBurst(t, 'lowpass', 700 + i * 900, 0.7, 0.45 * i + 0.04, 0.12 + i * 0.08);
    this.noiseBurst(t + 0.01, 'bandpass', 2400, 1.2, 0.12 * i, 0.09);
  }

  /** choque entre bolas de resina: "toc" seco e brilhante */
  clack(speed: number, bolim: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (t - this.lastClack < 0.015) return;
    this.lastClack = t;
    const i = Math.min(1, speed / 7);
    const f = bolim ? 2350 : 1480;
    this.tone(t, 'sine', f, f * 0.98, 0.42 * i + 0.03, 0.07 + i * 0.05, 0.001);
    this.tone(t, 'sine', f * 2.71, f * 2.65, 0.2 * i + 0.02, 0.045, 0.001);
    this.tone(t, 'triangle', f * 0.52, f * 0.5, 0.18 * i, 0.06, 0.001);
    this.noiseBurst(t, 'highpass', 3500, 0.7, 0.3 * i + 0.03, 0.02);
  }

  /** bola batendo na tabela de madeira */
  wall(speed: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const i = Math.min(1, speed / 6);
    this.tone(t, 'sine', 230, 140, 0.4 * i + 0.04, 0.12);
    this.noiseBurst(t, 'bandpass', 620, 1.4, 0.4 * i + 0.04, 0.1);
  }

  whoosh(power: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(320, t);
    f.frequency.exponentialRampToValueAtTime(900 + power * 900, t + 0.28);
    const g = ctx.createGain();
    this.env(g, t, 0.12 + power * 0.18, 0.08, 0.3);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + 0.5);
  }

  /** volume do rolamento (0..1) */
  setRolling(level: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const l = Math.min(1, level);
    this.rollGain.gain.setTargetAtTime(l * 0.55, t, 0.06);
    this.crunchGain.gain.setTargetAtTime(l * 0.045, t, 0.06);
  }

  click(): void {
    if (!this.ctx) return;
    this.tone(this.ctx.currentTime, 'triangle', 880, 660, 0.08, 0.05, 0.002);
  }

  turn(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(t, 'triangle', 660, 660, 0.09, 0.12);
    this.tone(t + 0.09, 'triangle', 880, 880, 0.08, 0.16);
  }

  /** confirmação de ponto */
  chime(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(t, 'triangle', 1318.5, 1318.5, 0.16, 0.45);
    this.tone(t + 0.11, 'triangle', 1975.5, 1975.5, 0.14, 0.7);
    this.tone(t + 0.11, 'sine', 987.8, 987.8, 0.08, 0.7);
  }

  error(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(t, 'sawtooth', 220, 180, 0.07, 0.25);
  }

  applause(intensity = 1): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.applauseBuf;
    s.playbackRate.value = 0.92 + Math.random() * 0.16;
    const g = ctx.createGain();
    g.gain.value = 0.5 * intensity;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 500;
    s.connect(f).connect(g).connect(this.master);
    s.start();
  }

  /** fanfarra de vitória */
  fanfare(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    const times = [0, 0.14, 0.28, 0.42, 0.62, 0.76];
    const lens = [0.13, 0.13, 0.13, 0.18, 0.12, 0.9];
    notes.forEach((f, k) => {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2400;
        const g = ctx.createGain();
        const st = t + times[k];
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(0.09, st + 0.02);
        g.gain.setValueAtTime(0.09, st + lens[k] * 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, st + lens[k] + 0.15);
        o.connect(lp).connect(g).connect(this.master);
        o.start(st);
        o.stop(st + lens[k] + 0.2);
      }
    });
    this.applause(1.2);
  }
}
