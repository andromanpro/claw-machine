// HUD: счётчики, статус, хват, монетки, настройки, attract-экран
import { settings, setSetting, SETTING_LABELS, RANGE_SETTINGS, SELECT_SETTINGS } from './settings.js';
import { tr, toyName } from './i18n.js';

const el = (id) => document.getElementById(id);
let onboardingStep = 0;
let onboardingBound = false;
let onOnboardingChange = () => {};
let standFeatureEnabled = settings.prizeStand;
const FUGITIVES = settings.gameMode === 'fugitives';

const ONBOARDING_STEPS = [
  {
    kicker: tr('ШАГ 01 · ПИТАНИЕ', 'STEP 01 · POWER'),
    title: tr('ВСТАВЬ ЖЕТОН', 'INSERT A TOKEN'),
    icon: '67',
    desktop: tr('Нажми М или кнопку «Жетон». Один жетон даёт одну попытку.', 'Press M or the Token button. One token gives you one try.'),
    touch: tr('Нажми экранную кнопку «Жетон». Один жетон даёт одну попытку.', 'Tap the Token button. One token gives you one try.'),
  },
  {
    kicker: tr('ШАГ 02 · НАВЕДЕНИЕ', 'STEP 02 · AIM'),
    title: tr('ПОДВЕДИ КЛЕШНЮ', 'POSITION THE CLAW'),
    icon: '✥',
    desktop: FUGITIVES
      ? tr('Стрелками или джойстиком подведи клешню к беглецу. Они замечают движение и пытаются уйти.', 'Use the arrow keys or gamepad to chase a fugitive. They notice movement and try to escape.')
      : tr('Стрелками или джойстиком наведи клешню на верхнюю игрушку.', 'Use the arrow keys or gamepad to position the claw over a toy.'),
    touch: FUGITIVES
      ? tr('Экранным пультом преследуй беглеца. В углу он может замереть и спрятаться.', 'Chase a fugitive with the touch pad. They may freeze and hide in a corner.')
      : tr('Экранным пультом наведи клешню на верхнюю игрушку. Можно жать два направления сразу.', 'Use the touch pad to position the claw. You can press two directions at once.'),
  },
  {
    kicker: tr('ШАГ 03 · ЗАХВАТ', 'STEP 03 · GRAB'),
    title: FUGITIVES ? tr('ЛОВИ БЕГЛЕЦА', 'CATCH A FUGITIVE') : tr('ХВАТАЙ И ЗАБИРАЙ', 'GRAB YOUR PRIZE'),
    icon: '✦',
    desktop: tr('Нажми пробел. Выданный приз можно перетащить мышью на стенд или подождать 10 секунд.', 'Press Space. Drag the prize to the stand or wait 10 seconds.'),
    touch: tr('Нажми «ХВАТ». Перетащи приз пальцем на стенд или подожди 10 секунд.', 'Tap GRAB. Drag the prize to the stand or wait 10 seconds.'),
  },
];

const PHRASES = {
  idle: FUGITIVES
    ? tr(['Выбирай беглеца…', 'Персонал делает вид, что спокоен.', 'Кто сегодня не уйдёт со смены?'], ['Pick a fugitive…', 'The crew is pretending to stay calm.', 'Who is not leaving this shift?'])
    : tr(['Выбирай жертву…', 'Каретка ждёт.', 'Ну, куда едем?'], ['Pick your target…', 'The carriage is ready.', 'Where to?']),
  descend: FUGITIVES
    ? tr(['Клешня пошла вниз — началась паника!', 'Не разбегаться! Хотя уже поздно.'], ['Claw descending — panic!', 'Nobody run! Too late.'])
    : tr(['Опускаемся…', 'Пошла родимая…'], ['Going down…', 'Claw away!']),
  grabEmpty: tr(['Пусто. Автомат ухмыляется.', 'Мимо. Воздух пойман успешно.', 'Схватили ровно ничего.'], ['Empty. The machine smirks.', 'Missed. You caught some air.', 'Absolutely nothing.']),
  slip: tr(['Выскользнула. Классика жанра.', 'Была — и нет. Как зарплата.', 'Хват был так себе, чего ты хотел.'], ['It slipped. A classic.', 'Almost had it.', 'That grip was not quite enough.']),
  win: FUGITIVES
    ? tr(['ПОЙМАН! Забирай внизу!', 'Есть контакт! В лоток его!', 'Цех недосчитался сотрудника.'], ['CAUGHT! Pick them up below!', 'Contact! Into the chute!', 'The factory is one worker short.'])
    : tr(['ПРИЗ! Забирай внизу!', 'ЕСТЬ! В лоток её!', 'ДЖЕКПОТ! Автомат в слезах.'], ['PRIZE! Pick it up below!', 'GOT IT! Into the chute!', 'JACKPOT! The machine gives in.']),
  carry: FUGITIVES
    ? tr(['Поймали! Только не вырони…', 'Несём нарушителя к выдаче…'], ['Caught! Do not drop them…', 'Taking the escapee to the chute…'])
    : tr(['Несём… не дыши…', 'Держим… вроде…'], ['Carrying… do not breathe…', 'Still holding… somehow…']),
  noCredit: tr(['Сначала жетон. Аппарат по плану не благотворительный.', 'Жетонов ноль. Клавиша М — жетон.'], ['Insert a token first.', 'No tokens. Press M for a token.']),
  coin: tr(['Дзынь! +1 жетон принят.', 'Жетон ушёл в приёмник. Автомат доволен.'], ['Clink! +1 token accepted.', 'Token accepted. The machine is pleased.']),
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function setTries(n) { el('tries').textContent = n; }
export function setCredits(n) { el('credits').textContent = n; }
export function setWins(n) {
  el('wins').textContent = n;
  const v = el('wins');
  v.style.transform = 'scale(1.4)';
  setTimeout(() => (v.style.transform = 'scale(1)'), 200);
}

export function setStatus(kind, text) {
  const s = el('status');
  s.className =
    kind === 'win' ? 'win' :
    kind === 'coin' ? 'coin' :
    kind === 'slip' || kind === 'grabEmpty' || kind === 'noCredit' ? 'bad' : '';
  s.textContent = text ?? pick(PHRASES[kind] ?? ['…']);
}

export function showGrip(pct) {
  const wrap = el('gripWrap');
  if (pct == null) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  el('gripFill').style.width = pct + '%';
  el('gripPct').textContent = pct + '%';
}

export function flashCoinBtn() {
  const b = el('coinBtn');
  b.classList.remove('flash');
  void b.offsetWidth; // рестарт CSS-анимации
  b.classList.add('flash');
}

export function hideAttract() {
  el('attract').classList.add('hidden');
  document.body.classList.remove('attract-mode');
}

export function hideLoader() { el('loader').classList.add('hidden'); }

export function isOnboardingOpen() {
  return el('onboarding')?.classList.contains('show') ?? false;
}

function renderOnboardingStep() {
  const step = ONBOARDING_STEPS[onboardingStep];
  const touch = matchMedia('(pointer: coarse)').matches;
  el('onboardingKicker').textContent = step.kicker;
  el('onboardingTitle').textContent = step.title;
  el('onboardingIcon').textContent = step.icon;
  let prizeText = touch ? step.touch : step.desktop;
  if (onboardingStep === 2 && !settings.prizeStand) {
    prizeText = touch
      ? tr('Нажми «ХВАТ». Выданный приз можно взять и двигать пальцем.', 'Tap GRAB. You can pick up and move the dispensed prize with your finger.')
      : tr('Нажми пробел. Выданный приз можно взять и двигать мышью.', 'Press Space. You can pick up and move the dispensed prize with the mouse.');
  }
  el('onboardingText').textContent = prizeText;
  el('onboardingCount').textContent = `${String(onboardingStep + 1).padStart(2, '0')} / ${String(ONBOARDING_STEPS.length).padStart(2, '0')}`;
  el('onboardingNext').textContent = onboardingStep === ONBOARDING_STEPS.length - 1 ? tr('ГОТОВО', 'DONE') : tr('ДАЛЬШЕ', 'NEXT');
  document.querySelectorAll('#onboardingDots i').forEach((dot, index) => dot.classList.toggle('active', index === onboardingStep));
}

function closeOnboarding() {
  const overlay = el('onboarding');
  if (!overlay?.classList.contains('show')) return;
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('onboarding-open');
  onOnboardingChange(false);
}

function nextOnboardingStep() {
  if (onboardingStep >= ONBOARDING_STEPS.length - 1) {
    closeOnboarding();
    return;
  }
  onboardingStep++;
  renderOnboardingStep();
}

export function showOnboarding() {
  onboardingStep = 0;
  renderOnboardingStep();
  const overlay = el('onboarding');
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('onboarding-open');
  onOnboardingChange(true);
  return true;
}

function bindOnboarding() {
  if (onboardingBound) return;
  onboardingBound = true;
  el('onboardingNext').addEventListener('click', nextOnboardingStep);
  el('onboardingSkip').addEventListener('click', closeOnboarding);
  window.addEventListener('keydown', (event) => {
    if (!isOnboardingOpen()) return;
    if (event.code === 'Escape') closeOnboarding();
    else if (event.code === 'Enter' || event.code === 'Space' || event.code === 'ArrowRight') nextOnboardingStep();
    else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });
}

// связка кнопок и панели настроек
export function initControls({ onCoin, onPlay, onCalibrate, onClearCollection, onSettingChange, onOnboardingVisibility }) {
  onOnboardingChange = onOnboardingVisibility ?? (() => {});
  bindOnboarding();
  el('coinBtn').addEventListener('click', onCoin);
  el('playBtn').addEventListener('click', onPlay);
  el('helpBtn').addEventListener('click', showOnboarding);
  el('gearBtn').addEventListener('click', () => togglePanel());
  el('closeSettings').addEventListener('click', () => togglePanel(false));
  el('gpCalBtn').addEventListener('click', onCalibrate);

  const list = el('optList');

  const addSelectRow = (key, def) => {
    const row = document.createElement('label');
    row.className = 'opt select';
    row.dataset.setting = key;
    row.innerHTML = `<span>${tr(...def.label)}</span>
      <select>${def.options.map((o) => `<option value="${o.value}" ${settings[key] === o.value ? 'selected' : ''}>${tr(...o.label)}</option>`).join('')}</select>`;
    row.querySelector('select').addEventListener('change', (e) => {
      setSetting(key, e.target.value);
      onSettingChange?.(key, e.target.value);
      if (def.reload) location.reload();
    });
    list.appendChild(row);
  };

  // Настройки с primary идут первыми: они переключают саму игру, а не её
  // подкрутку, и искать их в конце списка после флажков и слайдеров неудобно.
  for (const [key, def] of Object.entries(SELECT_SETTINGS)) {
    if (def.primary) addSelectRow(key, def);
  }

  for (const [key, label] of Object.entries(SETTING_LABELS)) {
    const row = document.createElement('label');
    row.className = 'opt';
    row.dataset.setting = key;
    row.innerHTML = `<span>${tr(...label)}</span><input type="checkbox" ${settings[key] ? 'checked' : ''}><span class="toggle"></span>`;
    row.querySelector('input').addEventListener('change', (e) => {
      setSetting(key, e.target.checked);
      onSettingChange?.(key, e.target.checked);
    });
    list.appendChild(row);
  }
  for (const [key, def] of Object.entries(RANGE_SETTINGS)) {
    const row = document.createElement('div');
    row.className = 'opt range';
    row.dataset.setting = key;
    row.innerHTML = `<span>${tr(...def.label)}</span>
      <span class="rangeVal" id="rv-${key}">${settings[key]}${def.unit}</span>
      <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${settings[key]}">`;
    row.querySelector('input').addEventListener('input', (e) => {
      const v = Number(e.target.value);
      setSetting(key, v);
      el(`rv-${key}`).textContent = v + def.unit;
      onSettingChange?.(key, v);
    });
    list.appendChild(row);
  }
  for (const [key, def] of Object.entries(SELECT_SETTINGS)) {
    if (!def.primary) addSelectRow(key, def);
  }
  if (onClearCollection) {
    const row = document.createElement('div');
    row.className = 'opt action';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.id = 'clearCollectionBtn';
    button.textContent = tr('Очистить коллекционный стенд', 'Clear prize collection');
    button.addEventListener('click', () => {
      onClearCollection();
      button.textContent = tr('Стенд очищен ✓', 'Collection cleared ✓');
      setTimeout(() => { button.textContent = tr('Очистить коллекционный стенд', 'Clear prize collection'); }, 1300);
    });
    row.appendChild(button);
    list.appendChild(row);
  }
}

export function setPrizeStandEnabled(enabled) {
  standFeatureEnabled = !!enabled;
  document.body.classList.toggle('stand-disabled', !enabled);
  refreshPrizeDragHint();
}

function refreshPrizeDragHint() {
  const hint = el('prizeDragHint');
  if (!hint) return;
  const subjectRu = FUGITIVES ? 'ПОЙМАННЫЙ НА ПОЛУ' : 'ПРИЗ НА ПОЛУ';
  const subjectEn = FUGITIVES ? 'CAPTIVE ON FLOOR' : 'PRIZE ON FLOOR';
  if (standFeatureEnabled) {
    hint.textContent = tr(`${subjectRu} · ПЕРЕТАЩИ НА СТЕНД ИЛИ ПОДОЖДИ 10 С`, `${subjectEn} · DRAG TO STAND OR WAIT 10 S`);
  } else {
    hint.textContent = tr(`${subjectRu} · МОЖНО ВЗЯТЬ МЫШЬЮ ИЛИ ПАЛЬЦЕМ`, `${subjectEn} · PICK UP WITH MOUSE OR TOUCH`);
  }
}

// всплывашка у счётчика призов
export function prizeToast(name, rarity, trick = false) {
  const t = document.createElement('div');
  t.className = trick ? 'prizeToast trick' : rarity ? 'prizeToast rare' : 'prizeToast';
  const displayName = toyName(name) ?? tr('приз', 'prize');
  t.textContent = trick
    ? tr(`ХИТРЮГА! +1 ${displayName}`, `SNEAKY! +1 ${displayName}`)
    : rarity ? `★ ${displayName} ★` : FUGITIVES ? tr(`ПОЙМАН: ${displayName}`, `CAUGHT: ${displayName}`) : `+1 ${displayName}`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1900);
}

// калибровка джойстика
export function calShow(on) { el('calOverlay').classList.toggle('show', !!on); }
export function calText(text) { el('calText').textContent = text; }
export function setGamepadName(name) {
  el('gpName').textContent = name ? tr(`Джойстик: ${name}`, `Gamepad: ${name}`) : tr('Джойстик: не найден', 'Gamepad: not found');
}

export function togglePanel(force) {
  const p = el('settingsPanel');
  const want = force ?? !p.classList.contains('open');
  p.classList.toggle('open', want);
}
