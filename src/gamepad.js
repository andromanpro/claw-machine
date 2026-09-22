// Джойстик: маппинг осей (настраивается калибровкой), опрос, вибрация.
// Дефолт — стандартный геймпад: axes[0]=X, axes[1]=Z, кнопка 0 или 7 = хват.
import { settings, setSetting } from './settings.js';
import { tr } from './i18n.js';

const DEFAULT_MAP = { ax: 0, ix: 1, az: 1, iz: 1, btn: 0 };
const DEAD = 0.22;

function raw() {
  const pads = navigator.getGamepads?.() ?? [];
  for (const p of pads) if (p && p.connected) return p;
  return null;
}

export function gamepadName() {
  return raw()?.id ?? null;
}

let prevBtn = false;

// → { x, z, grabPressed (фронт нажатия), connected }
export function pollGamepad() {
  const gp = raw();
  if (!gp) { prevBtn = false; return null; }
  const m = settings.gpMap ?? DEFAULT_MAP;
  const dead = (v) => (Math.abs(v) > DEAD ? v : 0);
  const x = dead((gp.axes[m.ax] ?? 0) * m.ix);
  const z = dead((gp.axes[m.az] ?? 0) * m.iz);
  const btn = !!(gp.buttons?.[m.btn]?.pressed || (settings.gpMap ? false : gp.buttons?.[7]?.pressed));
  const grabPressed = btn && !prevBtn;
  prevBtn = btn;
  return { x, z, grabPressed };
}

// вибрация: Gamepad haptics, фолбэк — Vibration API (телефоны)
export function vibrate(kind) {
  const gp = raw();
  const act = gp?.vibrationActuator;
  const fx = {
    grab: { duration: 80, strongMagnitude: 0.55, weakMagnitude: 0.3 },
    slip: { duration: 160, strongMagnitude: 0.35, weakMagnitude: 0.6 },
    win: { duration: 320, strongMagnitude: 0.85, weakMagnitude: 0.5 },
    coin: { duration: 35, strongMagnitude: 0.15, weakMagnitude: 0.4 },
    jackpot: { duration: 220, strongMagnitude: 0.6, weakMagnitude: 0.8 },
  }[kind];
  if (!fx) return;
  if (act?.playEffect) {
    act.playEffect('dual-rumble', fx).catch(() => {});
  } else if (navigator.vibrate) {
    navigator.vibrate(fx.duration);
  }
}

// Калибровка: «вправо» → «на себя» → «кнопка хвата».
// Ось фиксируется, когда |значение| > 0.6 держится 0.4с.
export class Calibration {
  constructor(onStep, onDone, onFail) {
    this.onStep = onStep;
    this.onDone = onDone;
    this.onFail = onFail;
    this.map = { ...DEFAULT_MAP };
    this.stage = 0;
    this.holdT = 0;
    this.candidate = null;
    this.baseline = raw()?.axes?.map((v) => v) ?? [];
    this.steps = [
      tr('Наклони стик ВПРАВО и держи…', 'Push the stick RIGHT and hold…'),
      tr('Теперь НА СЕБЯ (вниз) и держи…', 'Now pull it DOWN and hold…'),
      tr('Нажми кнопку ХВАТА', 'Press the GRAB button'),
    ];
    onStep(this.steps[0]);
  }

  update(dt) {
    const gp = raw();
    if (!gp) { this.onFail(tr('Джойстик пропал', 'Gamepad disconnected')); return true; }

    if (this.stage < 2) {
      // ищем ось с максимальным отклонением от базовой линии
      let best = -1, bestVal = 0;
      for (let i = 0; i < gp.axes.length; i++) {
        if (this.stage === 1 && i === this.map.ax) continue; // ось X уже занята
        const d = gp.axes[i] - (this.baseline[i] ?? 0);
        if (Math.abs(d) > Math.abs(bestVal)) { best = i; bestVal = d; }
      }
      if (best >= 0 && Math.abs(bestVal) > 0.6) {
        if (this.candidate === best) {
          this.holdT += dt;
          if (this.holdT > 0.4) {
            const sign = Math.sign(bestVal);
            if (this.stage === 0) { this.map.ax = best; this.map.ix = sign; }
            else { this.map.az = best; this.map.iz = sign; }
            this.stage++;
            this.holdT = 0;
            this.candidate = null;
            if (this.stage < 2) { this.onStep(this.steps[this.stage]); return false; }
            // подождём отпускания стика перед кнопкой
            this.onStep(this.steps[2]);
            return false;
          }
        } else {
          this.candidate = best;
          this.holdT = 0;
        }
      } else {
        this.candidate = null;
        this.holdT = 0;
      }
      return false;
    }

    // stage 2: любая нажатая кнопка
    for (let i = 0; i < gp.buttons.length; i++) {
      if (gp.buttons[i].pressed) {
        this.map.btn = i;
        setSetting('gpMap', this.map);
        this.onDone(this.map);
        return true;
      }
    }
    return false;
  }
}
