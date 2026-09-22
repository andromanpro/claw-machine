import puppeteer from 'puppeteer-core';

import { findBrowser } from './browser.mjs';

const CHROME = findBrowser();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-position=-32000,-32000', '--start-minimized'],
  defaultViewport: { width: 1100, height: 760 },
});

try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));
  await page.goto('http://127.0.0.1:5273/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__clawReady === true', { timeout: 40000 });
  await page.click('#playBtn');
  await wait(1600);

  const before = await page.evaluate(() => {
    const view = window.__clawView;
    const claw = window.__claw;
    const dims = view.toys.dims;
    const tpl = view.toys.templates.find((item) => item.name === 'Мягкий мячик');
    const x = (dims.HOLE_MIN_X + dims.INNER_X) * 0.5;
    const z = (dims.HOLE_MIN_Z + dims.INNER_Z) * 0.5;
    const toy = view.toys.spawnTemplate(tpl, x, -0.58, z, { color: 0xe8a07a, yaw: 0 });
    toy.prizeEligible = false;
    toy.scored = false;
    claw.tries = Math.max(1, claw.tries);
    toy.body.position.set(x, -0.58, z);
    toy.body.velocity.set(0, 0, 0);
    toy.body.angularVelocity.set(0, 0, 0);
    toy.body.wakeUp();
    return { wins: claw.wins, toyIndex: view.toys.toys.indexOf(toy) };
  });

  await wait(320);
  const scored = await page.evaluate((toyIndex) => {
    const view = window.__clawView;
    const toy = view.toys.toys[toyIndex];
    return {
      wins: window.__claw.wins,
      status: document.getElementById('status').textContent.trim(),
      scored: toy?.scored,
      eligible: toy?.prizeEligible,
      delivery: toy?.deliver?.phase ?? null,
      moment: window.__prizeMoment.active,
    };
  }, before.toyIndex);
  await wait(420);
  const winsAfter = await page.evaluate(() => window.__claw.wins);

  const result = { before, scored, winsAfter };
  console.log(JSON.stringify(result, null, 2));
  if (scored.wins !== before.wins + 1 || winsAfter !== scored.wins) throw new Error('Trick prize was not counted exactly once');
  if (!scored.scored || scored.eligible || !scored.delivery || !scored.moment) throw new Error('Trick prize did not enter the normal delivery path');
  if (!scored.status.includes('ХИТРЮГА')) throw new Error('Trick prize was not labelled as a sneaky win');
} finally {
  await browser.close();
}
