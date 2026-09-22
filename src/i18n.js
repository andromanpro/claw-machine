import { settings } from './settings.js';

export function tr(ru, en) {
  return settings.language === 'en' ? en : ru;
}

const TOY_NAMES_EN = {
  'Мишка': 'Teddy Bear',
  'Кролик': 'Bunny',
  'Котик': 'Kitten',
  'Щенок': 'Puppy',
  'Панда': 'Panda',
  'Коала': 'Koala',
  'Слонёнок': 'Baby Elephant',
  'Лисёнок': 'Fox Cub',
  'Утёнок': 'Duckling',
  'Динозаврик': 'Little Dinosaur',
  'Пингвин': 'Penguin',
  'Китёнок': 'Baby Whale',
  'Осьминожка': 'Little Octopus',
  'Мягкий мячик': 'Soft Ball',
  'Звёздочка': 'Plush Star',
  'Сердце-подушка': 'Heart Pillow',
  'Золотой мишка': 'Golden Bear',
  'Гигантский мишка': 'Giant Bear',
  'Стажёр': 'Trainee',
  'Инженер': 'Engineer',
  'Лаборант': 'Lab Technician',
  'Курьер': 'Courier',
  'Бригадир': 'Foreman',
};

export function toyName(name) {
  return settings.language === 'en' ? TOY_NAMES_EN[name] ?? name : name;
}

function setText(selector, ru, en) {
  const node = document.querySelector(selector);
  if (node) node.textContent = tr(ru, en);
}

function setHtml(selector, ru, en) {
  const node = document.querySelector(selector);
  if (node) node.innerHTML = tr(ru, en);
}

function setTitle(selector, ru, en) {
  const node = document.querySelector(selector);
  if (!node) return;
  const value = tr(ru, en);
  node.title = value;
  if (node.hasAttribute('aria-label')) node.setAttribute('aria-label', value);
}

export function applyDocumentLanguage() {
  const fugitives = settings.gameMode === 'fugitives';
  document.documentElement.lang = settings.language;
  document.title = fugitives
    ? tr('Автомат 7-67 — Паника в цехе', 'Claw Machine 7-67 — Factory Panic')
    : tr('Автомат 7-67 — Хватайка', 'Claw Machine 7-67');
  setText('#loader', fugitives ? 'СБОР ПЕРСОНАЛА ЦЕХА…' : 'ЗАГРУЗКА ЖЕТОННОГО БЛОКА…', fugitives ? 'ASSEMBLING FACTORY CREW…' : 'LOADING TOKEN SYSTEM…');
  setText('#onboardingSkip', 'ПРОПУСТИТЬ', 'SKIP');
  setText('#prizeMomentTitle', fugitives ? 'ПОЙМАННЫЙ В ПУТИ' : 'ПРИЗ В ПУТИ', fugitives ? 'CAPTIVE IN TRANSIT' : 'PRIZE IN TRANSIT');
  setText('#prizeMomentHint', 'НАЖМИ, ЧТОБЫ ПРОПУСТИТЬ', 'CLICK TO SKIP');
  setText('#attract .tagline', fugitives ? 'ПАНИКА В ЦЕХЕ · ПЕРСОНАЛ РАЗБЕГАЕТСЯ · ЛОВИ' : 'СОВКИБЕР-АВТОМАТ · ЦЕХ 04 · СХВАТИ ЕСЛИ СМОЖЕШЬ', fugitives ? 'FACTORY PANIC · THE CREW IS ESCAPING · CATCH THEM' : 'SOVCYBER MACHINE · SHOP 04 · CATCH IT IF YOU CAN');
  setText('#playBtn', '▶ ПУСК', '▶ START');
  setText('#attract .hint', 'ENTER / ПРОБЕЛ — ПУСК · ЖЕТОНЫ В ПРИЁМНИКЕ · БЛОК ЗАХВАТА ГОТОВ', 'ENTER / SPACE — START · TOKEN UNIT READY · CLAW ONLINE');
  setText('#score .credits .label', 'ЖЕТОНЫ', 'TOKENS');
  setText('#score .tries .label', 'ПОПЫТКИ', 'TRIES');
  setText('#score .wins .label', fugitives ? 'ПОЙМАНО' : 'ПРИЗЫ', fugitives ? 'CAUGHT' : 'PRIZES');
  setTitle('#gearBtn', 'Настройки', 'Settings');
  setTitle('#helpBtn', 'Как играть', 'How to play');
  setHtml('#coinBtn', '🪙 Жетон <small>[М]</small>', '🪙 Token <small>[M]</small>');
  setText('#gripWrap .label', 'ХВАТ', 'GRIP');
  setHtml('#keys', '<b>← ↑ ↓ →</b> каретка &nbsp;·&nbsp; <b>ПРОБЕЛ</b> хватать &nbsp;·&nbsp; <b>М</b> жетон &nbsp;·&nbsp; <b>мышь</b> камера', '<b>← ↑ ↓ →</b> carriage &nbsp;·&nbsp; <b>SPACE</b> grab &nbsp;·&nbsp; <b>M</b> token &nbsp;·&nbsp; <b>mouse</b> camera');
  setText('#touchGrab', 'ХВАТ', 'GRAB');
  setTitle('#touchGrab', 'Опустить клешню и схватить', 'Lower the claw and grab');
  setTitle('.touchBtn.up', 'Каретка вперёд', 'Move carriage forward');
  setTitle('.touchBtn.left', 'Каретка влево', 'Move carriage left');
  setTitle('.touchBtn.right', 'Каретка вправо', 'Move carriage right');
  setTitle('.touchBtn.down', 'Каретка назад', 'Move carriage back');
  setText('#settingsPanel h2', 'НАСТРОЙКИ', 'SETTINGS');
  setText('#gpName', 'Джойстик: не найден', 'Gamepad: not found');
  setText('#gpCalBtn', '🎮 Калибровка джойстика', '🎮 Calibrate gamepad');
  setText('#closeSettings', 'Закрыть', 'Close');
  setText('#calBox small', 'Esc — отмена', 'Esc — cancel');
}
