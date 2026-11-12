import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {takeSnapshot} from '../src/snapshot/collect.js';
import {assertAllowed,StdioTransport,childEnvironment} from '../src/snapshot/transport.js';
import {limits,sanitize} from '../src/snapshot/bounds.js';
import {createMasker} from '../src/snapshot/secrets.js';
const fixture=fileURLToPath(new URL('./snapshot-fixtures/server.js',import.meta.url));
const target=mode=>({transport:'stdio',command:process.execPath,args:[fixture,mode]});
const gone=pid=>assert.throws(()=>process.kill(pid,0));
test('stdio success and cleanup',async()=>{const s=await takeSnapshot(target('ok'));assert.equal(s.tools[0].name,'echo');gone(Number(s.tools[0].description));assert.equal(s.stats.pages,1);assert.equal('command'in s,false);});
test('spawn failure',async()=>{await assert.rejects(takeSnapshot({transport:'stdio',command:'no-such-snapshot-server',args:[]}),{kind:'spawn_failed'});});
test('early exit',async()=>{await assert.rejects(takeSnapshot(target('exit')),{kind:'process_exited'});});
async function failsAndCleans(mode,options,kind) {
 const original=StdioTransport.prototype.start;let pid;
 StdioTransport.prototype.start=async function(){await original.call(this);pid=this.child?.pid;};
 try{await assert.rejects(takeSnapshot(target(mode),options),{kind});gone(pid);}finally{StdioTransport.prototype.start=original;}
}
test('handshake error and cleanup',async()=>{await failsAndCleans('handshake',{},'handshake_failed');});
test('timeout and cleanup',async()=>{await failsAndCleans('timeout',{stepTimeoutMs:150,totalTimeoutMs:1000},'timeout');});
test('150000 tools bounded',async()=>{await assert.rejects(takeSnapshot(target('huge')),{kind:'limit_exceeded'});});
test('allowlist',()=>{for(const method of ['tools/call','resources/list','notifications/cancelled'])assert.throws(()=>assertAllowed({method}),{kind:'invalid_response'});});
test('mask all forms, structural keys preserved',()=>{const mask=createMasker({secretEnv:{TOKEN:'x'},env:{PLAIN:'plain'}},['private']);assert.equal(mask('x eA== eA private cHJpdmF0ZQ== plain'),'[REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED] plain');assert.equal(sanitize({'x':'x'},mask,limits())['[REDACTED]'],'[REDACTED]');});
test('deep nesting bounded iteratively',()=>{let v={};for(let i=0;i<20000;i++)v={a:v};assert.throws(()=>sanitize(v,x=>x,limits()),{kind:'limit_exceeded'});});
test('safe env excludes ambient secrets',()=>{process.env.SNAPSHOT_TEST_AMBIENT='secret';assert.equal(childEnvironment({}).SNAPSHOT_TEST_AMBIENT,undefined);delete process.env.SNAPSHOT_TEST_AMBIENT;});
for(const mode of ['ok','handshake','timeout'])test(`direct transport cleanup ${mode}`,async()=>{const t=new StdioTransport(target(mode),limits({closeTimeoutMs:1500}));t.onerror=()=>{};await t.start();const pid=t.child.pid;await new Promise(resolve=>t.child.once('spawn',resolve));await t.close();gone(pid);});
for(const status of [200,401,403])test(`HTTP ${status}`,async()=>{
 const server=http.createServer(async(req,res)=>{if(status!==200){res.writeHead(status);res.end();return;}if(req.method==='GET'){res.writeHead(405);res.end();return;}let body='';for await(const chunk of req)body+=chunk;const m=JSON.parse(body);if(!('id'in m)){res.writeHead(202);res.end();return;}const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'http',version:'1'}}:{tools:[]};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{const p=takeSnapshot({transport:'http',url:`http://127.0.0.1:${server.address().port}/mcp`});if(status===200)assert.equal((await p).server.name,'http');else await assert.rejects(p,{kind:'auth_failed'});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('HTTP refused',async()=>{const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));await assert.rejects(takeSnapshot({transport:'http',url:`http://127.0.0.1:${port}/`}),{kind:'connection_refused'});});
