import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHttpFixture, getClosedPort } from './fixtures/run-http.js';

let api;
try { api = await import('../src/index.js'); } catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && String(error.message).includes('src/index.js')) throw new Error('Integration tests require src/index.js; the product implementation is missing.', { cause: error });
  throw error;
}
const { takeSnapshot, compareSnapshots } = api;
assert.equal(typeof takeSnapshot, 'function', 'src/index.js must export takeSnapshot');
assert.equal(typeof compareSnapshots, 'function', 'src/index.js must export compareSnapshots');
const server = name => fileURLToPath(new URL(`./fixtures/servers/${name}.js`, import.meta.url));
const bin = fileURLToPath(new URL('../bin/joons-mcp-diff.js', import.meta.url));
const stdio = (name, args = [], extra = {}) => ({ transport: 'stdio', command: process.execPath, args: [server(name), ...args], ...extra });
const http = (url, extra = {}) => ({ transport: 'http', url, ...extra });
const withoutTime = snapshot => { const copy = structuredClone(snapshot); delete copy.createdAt; return copy; };
const changes = result => result.tools.flatMap(t => t.changes.map(c => ({ tool: t.name, ...c })));
function checkDiff(result) {
  const all = changes(result);
  for (const [kind, severity] of [['tool_removed', 'BREAKING'], ['tool_added', 'NON_BREAKING'], ['required_added', 'BREAKING'], ['enum_values_removed', 'BREAKING'], ['enum_values_added', 'NON_BREAKING'], ['description_changed', 'NON_BREAKING']]) assert.ok(all.some(c => c.kind === kind && c.severity === severity), `missing ${kind}/${severity}`);
  assert.ok(all.some(c => c.severity === 'BREAKING' && c.path.includes('/properties/limit')));
  assert.ok(result.renameHints.some(h => h.from === 'delete_item' && h.to === 'remove_item'));
  assert.equal(result.summary.risk, 'high');
}
async function run(args, env = {}) {
  const child = spawn(process.execPath, [bin, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = ''; child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; });
  return await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve({ code, stdout, stderr })); });
}
async function gone(pid) {
  for (let i = 0; i < 30; i++) { try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') return true; throw e; } await new Promise(r => setTimeout(r, 100)); }
  return false;
}
async function cleanPidFile(file) {
  const pid = Number(await readFile(file, 'utf8').catch(() => '0'));
  if (!pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else { try { process.kill(pid, 'SIGKILL'); } catch {} }
}

test('stdio versions, canonical ordering and metadata privacy', async () => {
  const before = await takeSnapshot(stdio('v1-stdio')); const after = await takeSnapshot(stdio('v2-stdio'));
  checkDiff(compareSnapshots(before, after));
  assert.deepEqual(withoutTime(before), withoutTime(await takeSnapshot(stdio('reordered'))));
  const text = JSON.stringify(before); assert.ok(!text.includes(process.execPath)); assert.ok(!text.includes(server('v1-stdio'))); assert.ok(!text.includes('FIXTURE_SECRET'));
});
test('HTTP versions and authorization', async () => {
  const a = await startHttpFixture('v1-http', { FIXTURE_TOKEN: 'integration-token' }); const b = await startHttpFixture('v2-http');
  try {
    const before = await takeSnapshot(http(a.url, { headers: { Authorization: 'Bearer integration-token' } }));
    const after = await takeSnapshot(http(b.url)); checkDiff(compareSnapshots(before, after));
    assert.ok(!JSON.stringify(before).includes(a.url)); assert.ok(!JSON.stringify(before).includes('integration-token'));
    await assert.rejects(takeSnapshot(http(a.url)), e => e.kind === 'auth_failed');
  } finally { await a.close(); await b.close(); }
});
test('snapshot redacts secrets and CLI output', async () => {
  const secret = 'sensitive-integration-value'; const encoded = Buffer.from(secret).toString('base64');
  const saved = process.env.FIXTURE_SECRET; process.env.FIXTURE_SECRET = secret;
  try {
    const snapshot = await takeSnapshot(stdio('echo-secret', [], { secretEnv: ['FIXTURE_SECRET'] }));
    const text = JSON.stringify(snapshot); for (const value of [secret, encoded]) assert.ok(!text.includes(value));
    const result = await run(['snapshot', 'stdio', '--secret-env', 'FIXTURE_SECRET', '--', process.execPath, server('echo-secret')], { FIXTURE_SECRET: secret });
    assert.equal(result.code, 0, result.stderr); for (const value of [secret, encoded]) assert.ok(!(result.stdout + result.stderr).includes(value));
  } finally { if (saved === undefined) delete process.env.FIXTURE_SECRET; else process.env.FIXTURE_SECRET = saved; }
});
test('transport only sends allowed methods', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-integration-')); const file = join(dir, 'tripwire');
  try { await takeSnapshot(stdio('tripwire', [file])); const text = await readFile(file, 'utf8').catch(e => e.code === 'ENOENT' ? '' : Promise.reject(e)); assert.equal(text, ''); } finally { await rm(dir, { recursive: true, force: true }); }
});
test('process tree is gone after snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-integration-')); const grandchild = join(dir, 'grandchild'); const child = join(dir, 'child');
  try { await takeSnapshot(stdio('spawns-child', [grandchild, child])); for (const file of [grandchild, child]) assert.ok(await gone(Number(await readFile(file, 'utf8'))), 'fixture process still running'); } finally { await cleanPidFile(child); await cleanPidFile(grandchild); await rm(dir, { recursive: true, force: true }); }
});
test('typed snapshot failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-integration-')); const pidFile = join(dir, 'slow-pid');
  try {
    await assert.rejects(takeSnapshot(stdio('slow-start', ['2000', pidFile]), { stepTimeoutMs: 500, totalTimeoutMs: 3000 }), e => e.kind === 'timeout');
    assert.ok(await gone(Number(await readFile(pidFile, 'utf8'))), 'timed out fixture still running');
    for (const [name, kind] of [['early-exit', 'process_exited'], ['garbage', 'invalid_response'], ['handshake-error', 'handshake_failed']]) await assert.rejects(takeSnapshot(stdio(name), {}), e => e.kind === kind, name);
  } finally { await cleanPidFile(pidFile); await rm(dir, { recursive: true, force: true }); }
  const port = await getClosedPort(); await assert.rejects(takeSnapshot(http(`http://127.0.0.1:${port}/mcp`)), e => e.kind === 'connection_refused');
});
test('CLI failure thresholds and operational/usage exits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-integration-'));
  try {
    const before = await takeSnapshot(stdio('v1-stdio')); const after = await takeSnapshot(stdio('v2-stdio'));
    const a = join(dir, 'before.json'), b = join(dir, 'after.json'), same = join(dir, 'same.json'), unknown = join(dir, 'unknown.json'), nonbreaking = join(dir, 'nonbreaking.json');
    await writeFile(a, JSON.stringify(before)); await writeFile(b, JSON.stringify(after)); await writeFile(same, JSON.stringify(before));
    const u = structuredClone(before); u.tools[0].outputSchema = { type: 'string' }; await writeFile(unknown, JSON.stringify(u));
    const n = structuredClone(before); n.tools[0].description = 'changed description'; await writeFile(nonbreaking, JSON.stringify(n));
    for (const [file, threshold, code] of [[b, 'breaking', 1], [b, 'unknown', 1], [b, 'any', 1], [b, 'none', 0], [unknown, 'breaking', 0], [unknown, 'unknown', 1], [nonbreaking, 'unknown', 0], [nonbreaking, 'any', 1], [same, 'any', 0]]) assert.equal((await run(['compare', a, file, '--fail-on', threshold])).code, code, `${file} ${threshold}`);
    assert.equal((await run(['compare', a, join(dir, 'missing.json')])).code, 2);
    assert.equal((await run(['compare'])).code, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
