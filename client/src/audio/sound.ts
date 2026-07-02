// Procedural placeholder SFX via the WebAudio API — no audio files ship at all.
// Each sound is synthesized from a handful of oscillator / filtered-noise
// "voices" with short envelopes, so the whole sound bank is code (trivial to
// retune, and matches the project's generated-placeholder-asset ethos).
//
// Design notes:
//  - The AudioContext is created lazily and resumed on the first user gesture
//    (browsers block audio until then). Login is a click, so audio is unlocked
//    before any gameplay sound needs to play.
//  - Every <button> on the page gets a generic "click" via one delegated
//    listener here, so UI feedback is automatic and call sites only add the
//    gameplay-specific cues (move / attack / chop / hit / …).
//  - play() throttles per sound name so a battle (or 40 villagers chopping)
//    becomes a steady rhythm, not a wall of overlapping copies.

type ToneVoice = {
  kind: 'tone';
  wave: OscillatorType;
  freq: number;
  freqEnd?: number;
  dur: number;
  gain: number;
  delay?: number;
};
type NoiseVoice = {
  kind: 'noise';
  filter: BiquadFilterType;
  freq: number;
  q?: number;
  dur: number;
  gain: number;
  delay?: number;
};
type Voice = ToneVoice | NoiseVoice;

export type SoundName =
  | 'click' | 'select' | 'move' | 'attackCmd' | 'gatherCmd' | 'rally'
  | 'place' | 'error' | 'complete'
  | 'chop' | 'mine' | 'forage' | 'hammer' | 'hit' | 'death' | 'bow';

interface Recipe {
  voices: Voice[];
  throttle: number; // ms; ignore repeats of the same sound within this window
}

const BANK: Record<SoundName, Recipe> = {
  // --- UI ---
  click: { throttle: 0, voices: [
    { kind: 'tone', wave: 'square', freq: 330, dur: 0.05, gain: 0.10 },
    { kind: 'tone', wave: 'square', freq: 520, dur: 0.035, gain: 0.05, delay: 0.005 },
  ] },
  select: { throttle: 40, voices: [
    { kind: 'tone', wave: 'triangle', freq: 540, freqEnd: 760, dur: 0.09, gain: 0.12 },
  ] },
  error: { throttle: 60, voices: [
    { kind: 'tone', wave: 'square', freq: 240, freqEnd: 130, dur: 0.20, gain: 0.13 },
    { kind: 'tone', wave: 'square', freq: 180, freqEnd: 110, dur: 0.12, gain: 0.07, delay: 0.06 },
  ] },
  complete: { throttle: 80, voices: [
    { kind: 'tone', wave: 'triangle', freq: 660, dur: 0.12, gain: 0.11 },
    { kind: 'tone', wave: 'triangle', freq: 880, dur: 0.12, gain: 0.11, delay: 0.10 },
    { kind: 'tone', wave: 'triangle', freq: 1175, dur: 0.18, gain: 0.11, delay: 0.20 },
  ] },

  // --- commands ---
  move: { throttle: 50, voices: [
    { kind: 'tone', wave: 'sine', freq: 360, freqEnd: 300, dur: 0.10, gain: 0.14 },
    { kind: 'tone', wave: 'triangle', freq: 540, dur: 0.05, gain: 0.05 },
  ] },
  attackCmd: { throttle: 50, voices: [
    { kind: 'tone', wave: 'square', freq: 420, freqEnd: 300, dur: 0.07, gain: 0.13 },
    { kind: 'tone', wave: 'square', freq: 300, freqEnd: 210, dur: 0.07, gain: 0.11, delay: 0.06 },
  ] },
  gatherCmd: { throttle: 50, voices: [
    { kind: 'tone', wave: 'triangle', freq: 480, freqEnd: 640, dur: 0.08, gain: 0.12 },
    { kind: 'tone', wave: 'sine', freq: 300, dur: 0.04, gain: 0.05 },
  ] },
  rally: { throttle: 50, voices: [
    { kind: 'tone', wave: 'triangle', freq: 600, freqEnd: 840, dur: 0.10, gain: 0.12 },
  ] },
  place: { throttle: 0, voices: [
    { kind: 'noise', filter: 'lowpass', freq: 500, q: 1, dur: 0.12, gain: 0.28 },
    { kind: 'tone', wave: 'sine', freq: 150, freqEnd: 90, dur: 0.14, gain: 0.22 },
  ] },

  // --- world / work (positional, looped on the work cadence) ---
  chop: { throttle: 130, voices: [
    { kind: 'noise', filter: 'lowpass', freq: 900, q: 1, dur: 0.07, gain: 0.26 },
    { kind: 'tone', wave: 'sine', freq: 200, freqEnd: 120, dur: 0.05, gain: 0.14 },
  ] },
  mine: { throttle: 130, voices: [
    { kind: 'tone', wave: 'square', freq: 1300, dur: 0.04, gain: 0.09 },
    { kind: 'tone', wave: 'triangle', freq: 1950, dur: 0.03, gain: 0.05, delay: 0.005 },
    { kind: 'noise', filter: 'highpass', freq: 2200, dur: 0.04, gain: 0.07 },
  ] },
  forage: { throttle: 160, voices: [
    { kind: 'noise', filter: 'highpass', freq: 2600, dur: 0.06, gain: 0.10 },
  ] },
  hammer: { throttle: 150, voices: [
    { kind: 'noise', filter: 'lowpass', freq: 700, dur: 0.05, gain: 0.18 },
    { kind: 'tone', wave: 'square', freq: 240, dur: 0.04, gain: 0.10 },
  ] },
  hit: { throttle: 55, voices: [
    { kind: 'noise', filter: 'lowpass', freq: 600, q: 1, dur: 0.10, gain: 0.30 },
    { kind: 'tone', wave: 'square', freq: 160, freqEnd: 70, dur: 0.09, gain: 0.20 },
  ] },
  death: { throttle: 70, voices: [
    { kind: 'tone', wave: 'sawtooth', freq: 320, freqEnd: 60, dur: 0.34, gain: 0.22 },
    { kind: 'noise', filter: 'lowpass', freq: 500, dur: 0.28, gain: 0.18 },
  ] },
  // Bowstring release: a quick airy thwip (the arrow loosing).
  bow: { throttle: 45, voices: [
    { kind: 'noise', filter: 'highpass', freq: 2400, dur: 0.07, gain: 0.13 },
    { kind: 'tone', wave: 'triangle', freq: 760, freqEnd: 280, dur: 0.09, gain: 0.08 },
  ] },
};

export interface PlayOpts {
  pan?: number; // -1 (left) .. 1 (right)
  gain?: number; // multiplier on the recipe's gains
  rate?: number; // pitch multiplier (use small random spread to avoid sameness)
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private readonly last = new Map<SoundName, number>();
  private _muted = false;
  private readonly volume = 0.5;

  constructor() {
    try {
      this._muted = localStorage.getItem('jz_muted') === '1';
    } catch {
      /* private mode / no storage — default unmuted */
    }
    if (typeof window !== 'undefined') {
      // Resume on any user gesture (covers the autoplay policy).
      const unlock = (): void => {
        this.ensure();
        void this.ctx?.resume();
      };
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
      // Universal button-click feedback.
      document.addEventListener('click', (e) => {
        const el = e.target as HTMLElement | null;
        if (el && el.closest('button')) this.play('click');
      });
    }
  }

  private ensure(): void {
    if (this.ctx) return;
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this._muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
    // One reusable white-noise buffer for the filtered-noise voices.
    const len = Math.floor(this.ctx.sampleRate * 0.4);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  get muted(): boolean {
    return this._muted;
  }

  toggleMute(): boolean {
    this._muted = !this._muted;
    if (this.master) this.master.gain.value = this._muted ? 0 : this.volume;
    try {
      localStorage.setItem('jz_muted', this._muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    return this._muted;
  }

  play(name: SoundName, opts: PlayOpts = {}): void {
    if (this._muted) return;
    this.ensure();
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noiseBuf) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const recipe = BANK[name];
    const nowMs = ctx.currentTime * 1000;
    const last = this.last.get(name) ?? -1e9;
    if (nowMs - last < recipe.throttle) return;
    this.last.set(name, nowMs);

    // Per-play bus: optional stereo pan, then the master gain.
    let bus: AudioNode = master;
    if (opts.pan != null && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      p.connect(master);
      bus = p;
    }

    const now = ctx.currentTime;
    const outGain = opts.gain ?? 1;
    const rate = opts.rate ?? 1;
    for (const v of recipe.voices) {
      const t0 = now + (v.delay ?? 0);
      const g = ctx.createGain();
      g.connect(bus);
      const peak = Math.max(0.0001, v.gain * outGain);
      const atk = Math.min(0.01, v.dur * 0.3);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + v.dur);

      if (v.kind === 'tone') {
        const o = ctx.createOscillator();
        o.type = v.wave;
        o.frequency.setValueAtTime(v.freq * rate, t0);
        if (v.freqEnd != null)
          o.frequency.exponentialRampToValueAtTime(Math.max(1, v.freqEnd * rate), t0 + v.dur);
        o.connect(g);
        o.start(t0);
        o.stop(t0 + v.dur + 0.02);
      } else {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        const f = ctx.createBiquadFilter();
        f.type = v.filter;
        f.frequency.value = v.freq;
        if (v.q != null) f.Q.value = v.q;
        src.connect(f);
        f.connect(g);
        src.start(t0);
        src.stop(t0 + v.dur + 0.02);
      }
    }
  }
}

export const sound = new SoundEngine();

// Map a screen x-coordinate to a stereo pan value (-1 left .. 1 right).
export function panAt(screenX: number): number {
  const w = window.innerWidth || 1;
  return Math.max(-1, Math.min(1, (screenX / w) * 2 - 1));
}

// A small random pitch spread so repeated impacts/chops don't sound identical.
export function vary(spread = 0.12): number {
  return 1 - spread / 2 + Math.random() * spread;
}
