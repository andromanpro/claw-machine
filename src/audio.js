// Звук: чистый WebAudio-синтез, без сэмплов.
// AudioContext создаётся лениво по первому жесту пользователя (init()).
import { settings } from './settings.js';

class SoundFX {
  constructor() {
    this.ctx = null;
    this.lastScreamAt = -10;
  }

  get masterLevel() {
    const volume = clamp(Number(settings.volume ?? 65), 0, 100) / 100;
    return settings.sound ? 0.32 * volume : 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.masterLevel;
    this.master.connect(c.destination);

    // моторчик каретки/лебёдки: два расстроенных saw через lowpass
    this.motorGain = c.createGain();
    this.motorGain.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    this.motorOsc1 = c.createOscillator();
    this.motorOsc1.type = 'sawtooth';
    this.motorOsc1.frequency.value = 48;
    this.motorOsc2 = c.createOscillator();
    this.motorOsc2.type = 'sawtooth';
    this.motorOsc2.frequency.value = 71;
    this.motorOsc1.connect(lp);
    this.motorOsc2.connect(lp);
    lp.connect(this.motorGain);
    this.motorGain.connect(this.master);
    this.motorOsc1.start();
    this.motorOsc2.start();
  }

  syncSettings() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.masterLevel, t, 0.04);
    if (!settings.sound && this.motorGain) this.motorGain.gain.setTargetAtTime(0, t, 0.04);
  }

  get on() { return this.ctx && settings.sound; }

  // v: 0..1 — интенсивность мотора
  setMotor(v) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const target = settings.sound ? v * 0.16 : 0;
    this.motorGain.gain.setTargetAtTime(target, t, 0.06);
    this.motorOsc1.frequency.setTargetAtTime(44 + v * 42, t, 0.08);
    this.motorOsc2.frequency.setTargetAtTime(66 + v * 60, t, 0.08);
  }

  blip(freq, dur = 0.12, type = 'sine', vol = 0.3, delay = 0, glideTo = null) {
    if (!this.on) return;
    const c = this.ctx;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  noise(dur = 0.05, vol = 0.25, delay = 0) {
    if (!this.on) return;
    const c = this.ctx;
    const t0 = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(this.master);
    src.start(t0);
  }

  grabClick() {
    this.noise(0.045, 0.3);
    this.blip(720, 0.05, 'square', 0.22, 0.01);
  }

  coin() {
    this.blip(2520, 0.1, 'sine', 0.3);
    this.blip(3360, 0.22, 'sine', 0.22, 0.04);
  }

  fanfare(rare = false) {
    const notes = rare ? [523, 659, 784, 1047, 1319, 1568] : [523, 659, 784, 1047];
    notes.forEach((f, i) => this.blip(f, 0.3, 'triangle', 0.26, i * 0.095));
    if (rare) this.blip(2093, 0.5, 'sine', 0.18, notes.length * 0.095);
  }

  slip() { this.blip(390, 0.34, 'sawtooth', 0.22, 0, 130); }

  empty() {
    this.blip(230, 0.16, 'triangle', 0.22);
    this.blip(170, 0.24, 'triangle', 0.22, 0.13);
  }

  jackpotReady() {
    this.blip(1319, 0.14, 'triangle', 0.2);
    this.blip(1568, 0.3, 'triangle', 0.24, 0.1);
  }

  panic() {
    this.blip(620, 0.12, 'triangle', 0.14, 0, 860);
    this.blip(790, 0.16, 'square', 0.09, 0.09, 540);
  }

  // Короткий синтетический мультяшный крик. Без сэмпла — загрузка игры не растёт,
  // а два формантных фильтра делают сигнал менее похожим на обычную сирену.
  scream(variant = 0) {
    if (!this.on) return;
    const now = this.ctx.currentTime;
    if (now - this.lastScreamAt < 0.34) return;
    this.lastScreamAt = now;
    const c = this.ctx;
    const t0 = now;
    const duration = 0.62;
    const sourceGain = c.createGain();
    sourceGain.gain.setValueAtTime(0.001, t0);
    sourceGain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.035);
    sourceGain.gain.setValueAtTime(0.15, t0 + 0.24);
    sourceGain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

    const formantA = c.createBiquadFilter();
    formantA.type = 'bandpass';
    formantA.frequency.value = 920 + variant * 70;
    formantA.Q.value = 3.8;
    const formantB = c.createBiquadFilter();
    formantB.type = 'bandpass';
    formantB.frequency.value = 1850 + variant * 90;
    formantB.Q.value = 5.2;
    const mix = c.createGain();
    mix.gain.value = 0.9;
    sourceGain.connect(formantA);
    sourceGain.connect(formantB);
    formantA.connect(mix);
    formantB.connect(mix);
    mix.connect(this.master);

    for (let i = 0; i < 2; i++) {
      const osc = c.createOscillator();
      osc.type = i ? 'triangle' : 'sawtooth';
      const base = 430 + variant * 22 + i * 17;
      osc.frequency.setValueAtTime(base, t0);
      osc.frequency.exponentialRampToValueAtTime(base * 1.82, t0 + 0.18);
      osc.frequency.exponentialRampToValueAtTime(base * 1.18, t0 + duration);
      osc.connect(sourceGain);
      osc.start(t0);
      osc.stop(t0 + duration + 0.04);
    }
    this.noise(0.16, 0.035, 0.02);
  }

  // «вставь монету» — двойной пик
  nag() {
    this.blip(880, 0.08, 'sine', 0.22);
    this.blip(880, 0.08, 'sine', 0.22, 0.16);
  }
}

export const sfx = new SoundFX();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
