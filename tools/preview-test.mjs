// Smoke-тест именно production dist: временно поднимает Vite preview и гасит его.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

import { findBrowser } from './browser.mjs';

const CHROME = findBrowser();
const HOST = '127.0.0.1';
const PORT = 5274;
const BASE = `http://${HOST}:${PORT}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverLog = [];

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', HOST, '--port', String(PORT), '--strictPort'],
  { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
);
server.stdout.on('data', (data) => serverLog.push(data.toString()));
server.stderr.on('data', (data) => serverLog.push(data.toString()));

let browser;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(`Preview exited early (${server.exitCode}): ${serverLog.join('')}`);
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) { ready = true; break; }
    } catch { /* сервер ещё стартует */ }
    await wait(100);
  }
  if (!ready) throw new Error(`Preview did not start: ${serverLog.join('')}`);

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', ...(process.env.CI ? ['--use-angle=swiftshader', '--disable-dev-shm-usage'] : []), '--window-position=-32000,-32000', '--start-minimized'],
    defaultViewport: { width: 1100, height: 760 },
  });
  const failures = [];

  async function inspect(path, readyExpression) {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });
    page.on('requestfailed', (request) => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
    });
    const response = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(readyExpression, { timeout: process.env.CI ? 90000 : 40000 });
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        href: location.href,
        clawReady: window.__clawReady,
        viewerReady: window.__toyViewerReady,
        loader: document.getElementById('loader')?.textContent,
        body: document.body.innerText.slice(0, 500),
      }));
      throw new Error(`${path} did not become ready: ${JSON.stringify({ diagnostics, pageErrors, failures, cause: error.message })}`);
    }
    const result = {
      path,
      status: response?.status(),
      title: await page.title(),
      scripts: await page.$$eval('script[src]', (nodes) => nodes.map((node) => node.src)),
      canvas: await page.$$eval('canvas', (nodes) => nodes.length),
      pageErrors,
    };
    await page.close();
    return result;
  }

  const game = await inspect('/', 'window.__clawReady === true');
  const viewer = await inspect('/toy-viewer.html', 'window.__toyViewerReady === true');
  const report = { base: BASE, game, viewer, failures };
  console.log(JSON.stringify(report, null, 2));
  if (game.status !== 200 || viewer.status !== 200) throw new Error('Production pages did not return HTTP 200');
  if (game.pageErrors.length || viewer.pageErrors.length || failures.length) {
    throw new Error(`Production preview errors: ${JSON.stringify(report)}`);
  }
  if (game.canvas < 1 || viewer.canvas < 1) throw new Error('Production WebGL canvas is missing');
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      wait(2000),
    ]);
  }
}
