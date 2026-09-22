import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

export async function withVite(callback, { port = 5273 } = {}) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  const child = spawn(process.execPath, [vite, '--port', String(port), '--host', '127.0.0.1', '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  try {
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Vite exited before startup: ${output}`);
      // Wait for this process to report readiness, so a busy port cannot
      // silently send the test to an unrelated server.
      if (stripVTControlCharacters(output).includes(url)) {
        try {
          const response = await fetch(url);
          if (response.ok) { ready = true; break; }
        } catch { /* server is still starting */ }
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!ready) throw new Error(`Vite did not start: ${output}`);
    return await callback(url);
  } finally {
    child.kill();
  }
}
