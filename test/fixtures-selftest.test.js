import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { startHttpFixture, getClosedPort } from './fixtures/run-http.js';

const server = name => fileURLToPath(new URL(`./fixtures/servers/${name}.js`, import.meta.url));
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };
function driver(name, args = [], env = {}) {
  const child = spawn(process.execPath, [server(name), ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buffer = ''; const lines = []; const waiters = [];
  child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { buffer += chunk; let n; while ((n = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, n); buffer = buffer.slice(n + 1); const waiter = waiters.shift(); if (waiter) waiter(line); else lines.push(line); } });
  return { child, send: message => child.stdin.write(`${JSON.stringify(message)}\n`), line: () => lines.length ? Promise.resolve(lines.shift()) : new Promise(resolve => waiters.push(resolve)), async close() { if (child.exitCode !== null || child.signalCode !== null) return; const exited = once(child, 'exit'); child.stdin.end(); await exited; } };
}
async function query(d, message) { d.send(message); return JSON.parse(await d.line()); }
async function initialized(name, args, env) { const d = driver(name, args, env); const response = await query(d, init); assert.equal(response.result.serverInfo.name, 'fixture'); d.send({ jsonrpc: '2.0', method: 'notifications/initialized' }); return d; }
async function list(d, cursor) { return (await query(d, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: cursor ? { cursor } : {} })).result; }

for (const [name, count, args] of [['v1-stdio', 4], ['v2-stdio', 4], ['reordered', 4], ['complex', 1], ['duplicate-names', 2], ['empty-tools', 0], ['many-tools', 10000], ['deep-schema', 1, ['8']], ['hostile', 1], ['echo-secret', 1], ['slow-start', 4, ['10']]]) {
  test(`stdio fixture ${name}`, async () => {
    const d = await initialized(name, args, { FIXTURE_SECRET: 'fixture-secret' });
    try {
      const result = await list(d); assert.equal(result.tools.length, count);
      if (name === 'duplicate-names') assert.equal(result.tools[0].name, result.tools[1].name);
      if (name === 'echo-secret') { assert.match(JSON.stringify(result), /fixture-secret/); assert.match(JSON.stringify(result), /Zml4dHVyZS1zZWNyZXQ=/); }
      if (name === 'hostile') { assert.ok(result.tools[0].description.length >= 200000); assert.ok(Object.hasOwn(result.tools[0].inputSchema.properties, '__proto__')); }
      if (name === 'complex') for (const keyword of ['$ref', '$defs', 'oneOf', 'anyOf', 'allOf']) assert.ok(JSON.stringify(result).includes(keyword));
    } finally { await d.close(); }
  });
}
test('reordered has identical tool data', async () => {
  const a = await initialized('v1-stdio'); const b = await initialized('reordered');
  try { const x = (await list(a)).tools; const y = (await list(b)).tools; assert.deepEqual(y, x.reverse()); } finally { await a.close(); await b.close(); }
});
test('three pages and cursor loop', async () => {
  for (const name of ['paginated', 'cursor-loop']) {
    const d = await initialized(name);
    try { const a = await list(d); const b = await list(d, a.nextCursor); assert.ok(a.nextCursor); if (name === 'cursor-loop') assert.equal(b.nextCursor, a.nextCursor); else { const c = await list(d, b.nextCursor); assert.equal(c.nextCursor, undefined); assert.equal(new Set([a.tools[0].name, b.tools[0].name, c.tools[0].name]).size, 3); } } finally { await d.close(); }
  }
});
test('deliberate protocol failures', async () => {
  const early = driver('early-exit'); const [code] = await once(early.child, 'exit'); assert.equal(code, 3);
  const garbage = driver('garbage'); assert.equal(await garbage.line(), 'not-json'); await garbage.close();
  const handshake = driver('handshake-error'); try { const response = await query(handshake, init); assert.equal(response.error.code, -32603); } finally { await handshake.close(); }
});
test('tripwire records unexpected methods only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-fixture-')); const path = join(dir, 'tripwire'); const d = await initialized('tripwire', [path]);
  try { await list(d); assert.equal((await query(d, { jsonrpc: '2.0', id: 3, method: 'tools/call' })).error.code, -32601); assert.equal(await readFile(path, 'utf8'), 'tools/call\n'); } finally { await d.close(); await rm(dir, { recursive: true, force: true }); }
});
test('spawns-child writes a live grandchild PID', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-fixture-')); const path = join(dir, 'pid'); const d = await initialized('spawns-child', [path]); let pid;
  try { pid = Number(await readFile(path, 'utf8')); assert.ok(pid > 0); process.kill(pid, 0); await list(d); } finally { if (pid) { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); else { try { process.kill(pid, 'SIGKILL'); } catch {} } } await d.close(); await rm(dir, { recursive: true, force: true }); }
});
for (const name of ['v1-http', 'v2-http']) test(`HTTP fixture ${name}`, async () => {
  const fixture = await startHttpFixture(name, { FIXTURE_TOKEN: 'fixture-token' });
  try {
    const request = async (message, authorized = true) => fetch(fixture.url, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer fixture-token' } : {}) }, body: JSON.stringify(message) });
    assert.equal((await request(init, false)).status, 401);
    assert.equal((await (await request(init)).json()).result.serverInfo.name, 'fixture');
    assert.equal((await (await request({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()).result.tools.length, 4);
  } finally { await fixture.close(); }
});
test('closed port helper', async () => { const port = await getClosedPort(); await assert.rejects(fetch(`http://127.0.0.1:${port}/`)); });
