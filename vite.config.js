import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

// метка сборки: короткий git-хеш + время — видна в углу экрана и в консоли,
// чтобы жалобы всегда были с номером версии
let hash = 'nogit';
try { hash = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* нет git */ }
const stamp = new Date().toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

export default defineConfig({
  // Игра публикуется не в корне домена, а в /games/claw/.
  // Относительная база сохраняет рабочими и staging, и локальный preview.
  base: './',
  resolve: {
    // Сборочный entry `three.module.js` монолитен. Исходный ESM-граф даёт
    // Rolldown разнести core по кешируемым чанкам; addons по-прежнему штатные.
    alias: [
      { find: /^three$/, replacement: resolve(import.meta.dirname, 'node_modules/three/src/Three.js') },
    ],
  },
  define: {
    __BUILD_INFO__: JSON.stringify(`${hash} · ${stamp}`),
  },
  build: {
    rolldownOptions: {
      input: {
        game: resolve(import.meta.dirname, 'index.html'),
        toys: resolve(import.meta.dirname, 'toy-viewer.html'),
      },
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          groups: [
            {
              name: 'three-core',
              test: /node_modules[\\/]three[\\/]src[\\/]/,
              maxSize: 1_200_000,
              priority: 30,
            },
            { name: 'three-addons', test: /node_modules[\\/]three[\\/]examples[\\/]jsm[\\/]/, priority: 20 },
            { name: 'physics', test: /node_modules[\\/]cannon-es[\\/]/, priority: 20 },
            { name: 'vendor', test: /node_modules/, priority: 10 },
          ],
        },
      },
    },
  },
});
