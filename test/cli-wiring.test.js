import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {Writable} from 'node:stream';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {mainInternal as main} from '../src/cli.js';
import * as api from '../src/index.js';
const own=fileURLToPath(import.meta.url);
if(process.argv.includes('--fixture')) {
  const lines=createInterface({input:process.stdin});
  lines.on('line', line => {const req=JSON.parse(line); if(req.id===undefined)return; let result;
    if(req.method==='initialize') result={protocolVersion:req.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
    else if(req.method==='tools/list') result={tools:[{name:'echo',description:`A=${process.env.A}; S=${process.env.S}`,inputSchema:{type:'object'}}]};
    else result={}; process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\n');});
} else {
const sink=()=>{let value='';return {stream:new Writable({write(c,e,cb){value+=c;cb();}}),get value(){return value;}}};
async function invoke(args,deps={}) {const o=sink(),e=sink(); const code=await main(args,{stdout:o.stream,stderr:e.stream},deps);return {code,out:o.value,err:e.value};}
const snapshot={format:'joons-mcp-diff/snapshot',schemaVersion:1,createdAt:'2026-01-01T00:00:00.000Z',tool:{name:'joons-mcp-diff',version:'0.1.0'},label:null,server:{name:'fixture',version:'1',protocolVersion:'1'},tools:[],stats:{toolCount:0,pages:1}};
test('real CLI passes both environment variables to child and masks secret',()=>{const secret='very-private-4672';const r=spawnSync(process.execPath,['bin/joons-mcp-diff.js','snapshot','stdio','--env','A','--secret-env','S','--',process.execPath,own,'--fixture'],{env:{...process.env,A:'public-expected',S:secret},encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(r.status,0,r.stderr);const snap=JSON.parse(r.stdout);assert.match(snap.tools[0].description,/A=public-expected/);assert.match(snap.tools[0].description,/S=\[REDACTED\]/);assert.ok(!(r.stdout+r.stderr).includes(secret));assert.equal(api.validateSnapshot(snap).ok,true);});
test('one character secret does not alter envelope',async()=>{const r=await invoke(['snapshot','stdio','--secret-env','S','--','x'],{env:{S:'o'},takeSnapshot:async()=>snapshot});assert.equal(r.code,0);assert.deepEqual(JSON.parse(r.out),snapshot);});
test('stdio target carries cwd and env values',async()=>{let target,options;await invoke(['snapshot','stdio','--cwd','work','--env','A','--secret-env','S','--','x','one two'],{env:{A:'visible',S:'secret'},takeSnapshot:async(t,o)=>(target=t,options=o,snapshot)});assert.deepEqual(target,{transport:'stdio',command:'x',args:['one two'],cwd:'work',env:{A:'visible'},secretEnv:{S:'secret'}});assert.deepEqual(options.secrets,['secret']);});
test('http target carries header and secrets option',async()=>{let target,options;await invoke(['snapshot','http','https://example.test','--header','Auth=S'],{env:{S:'secret'},takeSnapshot:async(t,o)=>(target=t,options=o,snapshot)});assert.deepEqual(target,{transport:'http',url:'https://example.test',headers:{Auth:'secret'}});assert.deepEqual(options.secrets,['secret']);});
test('public main ignores injected third argument',async()=>{const o=sink(),e=sink();let called=false;const code=await api.main(['snapshot','stdio','--','missing.cmd'],{stdout:o.stream,stderr:e.stream},{takeSnapshot:async()=>{called=true;return snapshot;}});assert.equal(code,3);assert.equal(called,false);assert.equal('mainInternal' in api,false);});
test('public API exports documented names and error',()=>{for(const name of ['normalizeSnapshot','renderJson','renderJSON','renderMarkdown','renderTerminal','SnapshotError'])assert.equal(typeof api[name],'function');assert.equal(api.renderJson,api.renderJSON);});
test('real batch refusal is usage error',()=>{const r=spawnSync(process.execPath,['bin/joons-mcp-diff.js','snapshot','stdio','--','missing.cmd'],{encoding:'utf8',windowsHide:true});assert.equal(r.status,3);assert.match(r.stderr,/spawn_failed/);});
test('snapshot errors show safe kind and hide path and secret',async()=>{const r=await invoke(['snapshot','stdio','--secret-env','S','--','x'],{env:{S:'danger-secret'},takeSnapshot:async()=>{throw Object.assign(Error('danger-secret C:/private/file'),{kind:'handshake_failed'});}});assert.equal(r.code,2);assert.match(r.err,/handshake_failed/);assert.ok(!r.err.includes('danger-secret'));assert.ok(!r.err.includes('private'));});
test('timeout error includes safe stage',async()=>{const r=await invoke(['snapshot','stdio','--','x'],{takeSnapshot:async()=>{throw Object.assign(Error('initialize deadline exceeded'),{kind:'timeout'});}});assert.equal(r.code,2);assert.match(r.err,/timeout \(initialize deadline exceeded\)/);});
test('invalid JSON line and column and schema pointer',async()=>{const dir=await mkdtemp(path.join(process.cwd(),'w3c-'));try{const bad=path.join(dir,'bad.json');await writeFile(bad,'{\n "x": }');let r=await invoke(['compare',bad,'package.json']);assert.equal(r.code,2);assert.match(r.err,/bad\.json: invalid JSON at line 2, column \d+/);assert.ok(!r.err.includes(dir));await writeFile(bad,'{}');r=await invoke(['compare',bad,'package.json']);assert.equal(r.code,2);assert.match(r.err,/invalid snapshot at \/format/);assert.ok(!r.err.includes(dir));}finally{await rm(dir,{recursive:true,force:true});}});
}
