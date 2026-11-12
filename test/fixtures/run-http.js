import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

export async function startHttpFixture(script, env = {}) {
  const path = script.includes('/') || script.includes('\\') ? script : fileURLToPath(new URL(`./servers/${script.endsWith('.js') ? script : `${script}.js`}`, import.meta.url));
  const child = spawn(process.execPath, [path], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  let timer;
  const port = await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('HTTP fixture did not start')), 5000);
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`HTTP fixture exited (${code})`)));
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/LISTENING (\d+)\n/); if (match) resolve(Number(match[1])); });
  }).catch(error => { child.kill(); throw error; }).finally(() => clearTimeout(timer));
  return { url: `http://127.0.0.1:${port}/mcp`, async close() { if (child.exitCode !== null || child.signalCode !== null) return; const done = once(child, 'exit'); child.kill(); await done; } };
}

export async function getClosedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
