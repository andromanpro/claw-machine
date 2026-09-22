// Настройки игры, живут в localStorage
const KEY = 'claw-settings-v1';

const DEFAULTS = {
  gameMode: 'toys',  // toys | fugitives; меняет наполнение автомата после reload
  freePlay: false,   // игра без монеток
  refill: true,      // подсыпать новые игрушки после выигрыша
  autoCenter: true,  // центрировать камеру при старте попытки
  meanClaw: true,    // клешня может сама ослабить хват
  prizeStand: true,  // коллекционный стенд, ручная установка и автоперенос призов
  sound: true,       // WebAudio-синтез
  language: 'ru',    // ru | en; применяется после reload
  volume: 65,        // общая громкость WebAudio, %
  graphics: 'balanced', // fast | balanced | quality
  generosity: 50,    // щедрость автомата, %: сдвиг распределения силы хвата
  jackpotN: 5,       // джекпот: после N слабых хватов — гарантированно сильный (0 = выкл)
  gpMap: null,       // маппинг джойстика из калибровки: {ax, ix, az, iz, btn}
};

let stored = {};
try { stored = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* мусор в сторе */ }
if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {};
// Баскетбольная мини-игра удалена целиком. Заодно очищаем старый флаг и счёт,
// чтобы они не оставались скрытым мусором в профилях прежних сборок.
if ('basketHoop' in stored) {
  delete stored.basketHoop;
  try { localStorage.setItem(KEY, JSON.stringify(stored)); } catch { /* storage недоступен */ }
}
try { localStorage.removeItem('claw-basket-score-v1'); } catch { /* storage недоступен */ }

export const settings = { ...DEFAULTS, ...stored };

export function setSetting(key, value) {
  settings[key] = value;
  localStorage.setItem(KEY, JSON.stringify(settings));
}

export const SETTING_LABELS = {
  freePlay: ['Бесплатная игра (без жетонов)', 'Free play (no tokens)'],
  refill: ['Подсыпать новые игрушки', 'Refill toys after a win'],
  autoCenter: ['Центровка камеры при попытке', 'Center camera for each try'],
  meanClaw: ['Клешня может сама отпустить', 'Claw may loosen its grip'],
  prizeStand: ['Показать стенд с игрушками', 'Show the prize collection stand'],
  sound: ['Звук', 'Sound'],
};

export const RANGE_SETTINGS = {
  volume: { label: ['Громкость', 'Volume'], min: 0, max: 100, step: 5, unit: '%' },
  generosity: { label: ['Щедрость автомата', 'Machine generosity'], min: 0, max: 100, step: 5, unit: '%' },
  jackpotN: { label: ['Джекпот после N слабых хватов (0 — выкл)', 'Jackpot after N weak grabs (0 — off)'], min: 0, max: 10, step: 1, unit: '' },
};

export const SELECT_SETTINGS = {
  gameMode: {
    label: ['Режим игры', 'Game mode'],
    options: [
      { value: 'toys', label: ['Игрушки', 'Toys'] },
      { value: 'fugitives', label: ['Паника в цехе', 'Factory Panic'] },
    ],
    reload: true,
    // Единственная настройка, меняющая саму игру, а не её подкрутку, — поэтому
    // рисуется первой строкой панели, до флажков и слайдеров.
    primary: true,
  },
  language: {
    label: ['Язык', 'Language'],
    options: [
      { value: 'ru', label: ['Русский', 'Russian'] },
      { value: 'en', label: ['English', 'English'] },
    ],
    reload: true,
  },
  graphics: {
    label: ['Графика', 'Graphics'],
    options: [
      { value: 'quality', label: ['Красивая', 'Quality'] },
      { value: 'balanced', label: ['Баланс', 'Balanced'] },
      { value: 'fast', label: ['Быстрая', 'Fast'] },
    ],
    reload: true,
  },
};
