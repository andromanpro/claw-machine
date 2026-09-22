// Проверяет production-граф: вьювер без физики, каждый JS-чанк < 500 КБ.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = 'dist';
const ASSETS = join(DIST, 'assets');
const files = readdirSync(ASSETS).filter((name) => name.endsWith('.js'));
const sizes = Object.fromEntries(files.map((name) => [name, statSync(join(ASSETS, name)).size]));
const source = Object.fromEntries(files.map((name) => [name, readFileSync(join(ASSETS, name), 'utf8')]));

function entryFromHtml(file) {
  const html = readFileSync(join(DIST, file), 'utf8');
  const match = html.match(/<script[^>]+src="[^"]*\/assets\/([^"?]+\.js)"/);
  if (!match) throw new Error(`No module entry found in ${file}`);
  return match[1];
}

function importsOf(name) {
  const found = new Set();
  const pattern = /(?:from\s*|import\s*\(|import\s*)["']\.\/([^"']+\.js)["']/g;
  for (const match of source[name].matchAll(pattern)) found.add(basename(match[1]));
  return [...found];
}

function graph(entry) {
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    if (!source[name]) throw new Error(`Missing chunk ${name}, imported by ${entry}`);
    seen.add(name);
    importsOf(name).forEach(visit);
  };
  visit(entry);
  return [...seen].sort();
}

const game = graph(entryFromHtml('index.html'));
const viewer = graph(entryFromHtml('toy-viewer.html'));
const physics = files.filter((name) => name.startsWith('physics-'));
const overLimit = files.filter((name) => sizes[name] >= 500_000);
const viewerPhysics = viewer.filter((name) => physics.includes(name));
const gamePhysics = game.filter((name) => physics.includes(name));

const report = {
  chunks: files.map((name) => ({
    name,
    kb: Number((sizes[name] / 1000).toFixed(2)),
    gzipKb: Number((gzipSync(source[name]).length / 1000).toFixed(2)),
  })).sort((a, b) => b.kb - a.kb),
  game,
  viewer,
  viewerPhysics,
};
console.log(JSON.stringify(report, null, 2));

if (!physics.length) throw new Error('Dedicated physics chunk was not generated');
if (!gamePhysics.length) throw new Error('Game bundle lost its physics dependency');
if (viewerPhysics.length) throw new Error(`Toy viewer still downloads physics: ${viewerPhysics.join(', ')}`);
if (overLimit.length) throw new Error(`Chunks exceed 500 KB: ${overLimit.join(', ')}`);
