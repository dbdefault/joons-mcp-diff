import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const mode = basename(process.argv[1], '.js');
const args = process.argv.slice(2);
const tool = (name, inputSchema, description) => ({ name, inputSchema, ...(description === undefined ? {} : { description }) });
const object = (properties = {}, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });
const idSchema = object({ id: { type: 'string' } }, ['id']);

function versionTools(v2 = false) {
  return [
    tool('search', object({ query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: v2 ? 50 : 100 }, ...(v2 ? { locale: { type: 'string' } } : {}) }, v2 ? ['query', 'locale'] : ['query'])),
    tool('create_item', object({ name: { type: 'string' }, kind: { enum: v2 ? ['a', 'b', 'd'] : ['a', 'b', 'c'] } }, ['name'])),
    tool(v2 ? 'remove_item' : 'delete_item', idSchema),
    tool('ping_tool', object(), v2 ? 'Check service availability.' : 'Check service status.')
  ];
}
function shuffle(value) {
  if (Array.isArray(value)) return value.map(shuffle);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, shuffle(v)]));
}
function toolsForMode() {
  switch (mode) {
    case 'v1-stdio': case 'v1-http': case 'tripwire': case 'spawns-child': case 'slow-start': return versionTools();
    case 'v2-stdio': case 'v2-http': return versionTools(true);
    case 'reordered': return versionTools().reverse().map(shuffle);
    case 'empty-tools': return [];
    case 'duplicate-names': return [tool('duplicate', object()), tool('duplicate', object({ second: { type: 'string' } }))];
    case 'many-tools': return Array.from({ length: Math.max(0, Number(args[0] ?? 10000)) }, (_, i) => tool(`tool_${String(i).padStart(5, '0')}`, object()));
    case 'deep-schema': {
      let schema = { type: 'string' };
      for (let i = 0; i < Number(args[0] ?? 80); i++) schema = object({ nested: schema });
      return [tool('deep', schema)];
    }
    case 'complex': return [tool('complex', { type: 'object', $defs: { entry: { type: 'string' } }, properties: { ref: { $ref: '#/$defs/entry' }, choice: { oneOf: [{ type: 'string' }, { type: 'number' }] }, either: { anyOf: [{ type: 'string' }, { type: 'boolean' }] }, combined: { allOf: [{ type: 'object' }, { required: ['x'] }] }, nested: object({ list: { type: 'array', items: object({ value: { type: 'string' } }) } }) } })];
    case 'hostile': return [tool('bad\u001b[31m|<name>\u202e', JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'), `line|<tag>\u001b[31m\u2066\n${'x'.repeat(200000)}`)];
    case 'echo-secret': {
      const secret = process.env.FIXTURE_SECRET ?? '';
      return [tool('secret_echo', object({ [`key_${secret}`]: { type: 'string' } }), `value ${secret} encoded ${Buffer.from(secret).toString('base64')}`)];
    }
    case 'paginated': case 'cursor-loop': return [tool('page_one', object()), tool('page_two', object()), tool('page_three', object())];
    default: return versionTools();
  }
}

if (mode === 'early-exit') { console.error('fixture exited early'); process.exit(3); }
if (mode === 'garbage') { process.stdout.write('not-json\n'); }
if (mode === 'slow-start' && args[1]) writeFileSync(args[1], String(process.pid));
if (mode === 'spawns-child') {
  if (!args[0]) throw new Error('A PID output file is required');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  writeFileSync(args[0], String(child.pid));
  if (args[1]) writeFileSync(args[1], String(process.pid));
}

async function handle(message) {
  const { method, id, params = {} } = message;
  if (mode === 'tripwire' && !['initialize', 'notifications/initialized', 'tools/list', 'ping'].includes(method)) appendFileSync(args[0], `${method}\n`);
  if (id === undefined) return null;
  if (method === 'initialize') {
    if (mode === 'slow-start') await new Promise(resolve => setTimeout(resolve, Number(args[0] ?? 1000)));
    if (mode === 'handshake-error') return { jsonrpc: '2.0', id, error: { code: -32603, message: 'fixture initialization error' } };
    return { jsonrpc: '2.0', id, result: { protocolVersion: params.protocolVersion || '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } } };
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') {
    const tools = toolsForMode();
    if (mode === 'paginated') {
      const index = params.cursor === 'second' ? 1 : params.cursor === 'third' ? 2 : 0;
      return { jsonrpc: '2.0', id, result: { tools: [tools[index]], ...(index < 2 ? { nextCursor: index === 0 ? 'second' : 'third' } : {}) } };
    }
    if (mode === 'cursor-loop') return { jsonrpc: '2.0', id, result: { tools: [tools[0]], nextCursor: 'loop' } };
    return { jsonrpc: '2.0', id, result: { tools } };
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
}

if (mode.endsWith('-http')) {
  const server = createServer(async (req, res) => {
    if (process.env.FIXTURE_TOKEN && req.headers.authorization !== `Bearer ${process.env.FIXTURE_TOKEN}`) { res.writeHead(401).end(); return; }
    if (req.method === 'DELETE') { res.writeHead(204).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const response = await handle(JSON.parse(body));
      if (!response) { res.writeHead(202).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(response));
    } catch { res.writeHead(400).end(); }
  });
  server.listen(0, '127.0.0.1', () => process.stdout.write(`LISTENING ${server.address().port}\n`));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
} else {
  let pending = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    pending += chunk;
    let end;
    while ((end = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      try { Promise.resolve(handle(JSON.parse(line))).then(response => { if (response) process.stdout.write(`${JSON.stringify(response)}\n`); }); } catch { /* malformed input */ }
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}
