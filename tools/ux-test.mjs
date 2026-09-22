// On-demand help, persistent volume and coarse-pointer landscape layout.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

import { findBrowser } from './browser.mjs';

const CHROME = findBrowser();
const BASE = 'http://127.0.0.1:5273/';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
mkdirSync('shots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-position=-32000,-32000', '--start-minimized'],
  defaultViewport: { width: 1100, height: 760 },
});

try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__clawReady === true', { timeout: 40000 });
  const attractHelp = await page.evaluate(() => ({
    visible: document.getElementById('onboarding').classList.contains('show'),
    helpVisible: getComputedStyle(document.getElementById('helpBtn')).opacity !== '0',
  }));
  await page.click('#playBtn');
  await wait(1650);

  const automatic = await page.evaluate(() => ({
    visible: document.getElementById('onboarding').classList.contains('show'),
    controls: window.__clawView.controls.enabled,
    claw: window.__claw.enabled,
  }));
  await page.click('#helpBtn');
  await wait(80);

  const opened = await page.evaluate(() => ({
    visible: document.getElementById('onboarding').classList.contains('show'),
    hidden: document.getElementById('onboarding').getAttribute('aria-hidden'),
    step: document.getElementById('onboardingCount').textContent.trim(),
    title: document.getElementById('onboardingTitle').textContent.trim(),
    controls: window.__clawView.controls.enabled,
    claw: window.__claw.enabled,
  }));
  await page.screenshot({ path: 'shots/onboarding-help.png' });

  await page.click('#onboardingNext');
  await page.click('#onboardingNext');
  const finalStep = await page.evaluate(() => ({
    step: document.getElementById('onboardingCount').textContent.trim(),
    title: document.getElementById('onboardingTitle').textContent.trim(),
    button: document.getElementById('onboardingNext').textContent.trim(),
  }));
  await page.click('#onboardingNext');
  await wait(1500);
  const completed = await page.evaluate(() => ({
    visible: document.getElementById('onboarding').classList.contains('show'),
    controls: window.__clawView.controls.enabled,
    claw: window.__claw.enabled,
  }));

  await page.click('#helpBtn');
  await wait(80);
  const repeated = await page.evaluate(() => ({
    visible: document.getElementById('onboarding').classList.contains('show'),
    step: document.getElementById('onboardingCount').textContent.trim(),
  }));
  await page.click('#onboardingSkip');

  await page.click('#gearBtn');
  const settingsLabels = await page.$$eval('#optList .opt', (rows) => rows.map((row) => row.textContent.trim()));
  await page.evaluate(() => {
    const row = document.getElementById('rv-volume').parentElement;
    const input = row.querySelector('input[type=range]');
    input.value = '25';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(260);
  const volume = await page.evaluate(() => ({
    label: document.getElementById('rv-volume').textContent.trim(),
    stored: JSON.parse(localStorage.getItem('claw-settings-v1')).volume,
    master: window.__clawView.sfx.master.gain.value,
    target: window.__clawView.sfx.masterLevel,
  }));

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.select('[data-setting="language"] select', 'en'),
  ]);
  await page.waitForFunction('window.__clawReady === true', { timeout: 40000 });
  await page.click('#gearBtn');
  const english = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    title: document.title,
    settingsTitle: document.querySelector('#settingsPanel h2').textContent.trim(),
    play: document.getElementById('playBtn').textContent.trim(),
    language: document.querySelector('[data-setting="language"] select').value,
    standLabel: document.querySelector('[data-setting="prizeStand"] > span').textContent.trim(),
    basketSettingExists: !!document.querySelector('[data-setting="basketHoop"]'),
    modeLabel: document.querySelector('[data-setting="gameMode"] > span').textContent.trim(),
    panicOption: [...document.querySelectorAll('[data-setting="gameMode"] option')].find((option) => option.value === 'fugitives')?.textContent.trim(),
    focusButtonExists: !!document.getElementById('standFocusBtn'),
  }));
  const viewer = await browser.newPage();
  await viewer.goto(`${BASE}toy-viewer.html`, { waitUntil: 'domcontentloaded' });
  await viewer.waitForFunction('window.__toyViewerReady === true', { timeout: 40000 });
  const englishViewer = await viewer.evaluate(() => ({
    lang: document.documentElement.lang,
    name: document.getElementById('toyTitle').textContent.trim(),
    meta: document.getElementById('toyMeta').textContent.trim(),
    catalog: document.querySelector('.catalogHead strong').textContent.trim(),
  }));
  await viewer.close();

  const landscape = await browser.newPage();
  landscape.on('pageerror', (error) => console.log('LANDSCAPE PAGE ERROR:', error.message));
  await landscape.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await landscape.goto(BASE, { waitUntil: 'domcontentloaded' });
  await landscape.waitForFunction('window.__clawReady === true', { timeout: 40000 });
  await landscape.click('#playBtn');
  await wait(1800);
  const layout = await landscape.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const overlap = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const score = rect('#score');
    const gear = rect('#gearBtn');
    const help = rect('#helpBtn');
    const standToggle = document.querySelector('[data-setting="prizeStand"] input[type="checkbox"]');
    const pad = rect('.touchPad');
    const grab = rect('#touchGrab');
    const bottom = rect('#bottom');
    const coin = rect('#coinBar');
    return {
      viewport: [innerWidth, innerHeight],
      coarse: matchMedia('(pointer: coarse)').matches,
      touchDisplay: getComputedStyle(document.getElementById('touchControls')).display,
      scoreGearOverlap: overlap(score, gear),
      scoreHelpOverlap: overlap(score, help),
      gearHelpOverlap: overlap(gear, help),
      standInSettings: standToggle?.closest('#settingsPanel')?.id === 'settingsPanel',
      standIsFlag: standToggle?.type === 'checkbox',
      focusButtonExists: !!document.getElementById('standFocusBtn'),
      padBottomOverlap: overlap(pad, bottom),
      grabBottomOverlap: overlap(grab, bottom),
      scoreCoinOverlap: overlap(score, coin),
      inside: [pad, grab, bottom, score, gear, help, coin].every((r) => r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight),
      rects: { score, gear, help, pad, grab, bottom, coin },
    };
  });
  await landscape.screenshot({ path: 'shots/landscape-tablet.png' });

  const result = { attractHelp, automatic, opened, finalStep, completed, repeated, settingsLabels, volume, english, englishViewer, layout };
  console.log(JSON.stringify(result, null, 2));

  if (attractHelp.visible || !attractHelp.helpVisible) throw new Error('Help should be available without opening automatically');
  if (automatic.visible || !automatic.controls || !automatic.claw) throw new Error('Help opened automatically or blocked normal play');
  if (!opened.visible || opened.hidden !== 'false' || opened.step !== '01 / 03' || opened.controls || opened.claw) {
    throw new Error('Help button did not lock the game correctly');
  }
  if (finalStep.step !== '03 / 03' || finalStep.button !== 'ГОТОВО') throw new Error('Onboarding steps are incomplete');
  if (completed.visible || !completed.controls || !completed.claw) throw new Error('Help overlay did not release controls');
  if (!repeated.visible || repeated.step !== '01 / 03') throw new Error('Help button did not reopen the instructions');
  if (volume.label !== '25%' || volume.stored !== 25 || Math.abs(volume.master - volume.target) > 0.006 || Math.abs(volume.target - 0.08) > 0.001) {
    throw new Error('Master volume was not applied');
  }
  if (english.lang !== 'en' || english.settingsTitle !== 'SETTINGS' || english.play !== '▶ START' || english.language !== 'en' || !english.standLabel.includes('collection stand') || english.basketSettingExists || english.modeLabel !== 'Game mode' || english.panicOption !== 'Factory Panic' || english.focusButtonExists) throw new Error('English UI locale was not applied');
  if (englishViewer.lang !== 'en' || englishViewer.name !== 'Teddy Bear' || !englishViewer.meta.startsWith('PRIZE') || englishViewer.catalog !== 'CATALOG') throw new Error('English toy viewer locale was not applied');
  if (settingsLabels.some((label) => label.includes('Белый фон'))) throw new Error('White inspection background is still exposed in settings');
  if (!layout.coarse || layout.touchDisplay !== 'flex' || !layout.standInSettings || !layout.standIsFlag || layout.focusButtonExists || !layout.inside || layout.scoreGearOverlap || layout.scoreHelpOverlap || layout.gearHelpOverlap || layout.padBottomOverlap || layout.grabBottomOverlap || layout.scoreCoinOverlap) {
    throw new Error('Landscape tablet controls overlap');
  }
} finally {
  await browser.close();
}
