import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {Writable} from 'node:stream';
import {parse} from '../src/args.js';
import {mainInternal as main} from '../src/cli.js';
import {renderMarkdown} from '../src/report/markdown.js';
import {renderTerminal} from '../src/report/terminal.js';
const sink=()=>{let text=''; const stream=new Writable({write(c,e,cb){text+=c;cb();}}); return {stream,get:()=>text};};
test('stdio preserves arguments verbatim',()=>{const p=parse(['snapshot','stdio','--','node','a b','--flag']); assert.deepEqual(p.target.args,['a b','--flag']);});
test('missing secrets fail usage',()=>assert.throws(()=>parse(['snapshot','http','http://localhost','--header','Authorization=MISSING'],{})));
test('real binary usage and version exits',()=>{for(const [args,code] of [[['--bad'],3],[['--version'],0],[['compare','missing-a','missing-b'],2],[['snapshot','stdio','--','nothing'],2]]) {const r=spawnSync(process.execPath,['bin/joons-mcp-diff.js',...args],{encoding:'utf8',windowsHide:true}); assert.equal(r.status,code,r.stderr);}});
test('snapshot secret never escapes output or errors',async()=>{for(const fail of [false,true]) {const o=sink(),e=sink(); const secret='s3cr3t-value'; const code=await main(['snapshot','stdio','--secret-env','TOKEN','--','x'],{stdout:o.stream,stderr:e.stream},{env:{TOKEN:secret},takeSnapshot:async()=>{if(fail)throw Error(secret); return {name:'[REDACTED]'};}}); assert.equal(code,fail?2:0); assert.ok(!o.get().includes(secret)); assert.ok(!e.get().includes(secret));}});
test('output failures return 4',async()=>{const o=sink(),e=sink(); assert.equal(await main(['snapshot','stdio','-o','x','--','x'],{stdout:o.stream,stderr:e.stream},{takeSnapshot:async()=>({}),writeFile:async()=>{throw Error('EACCES');}}),4);});
test('hostile content is inert and breaking first',()=>{const r={summary:{risk:'high'},tools:[{name:'z',status:'changed',changes:[{severity:'UNKNOWN',kind:'u'}]},{name:'a|`<x>\u001b[31m\u202e',status:'changed',changes:[{severity:'BREAKING',kind:'b',message:'bad\ntext'}]}]}; const md=renderMarkdown(r),term=renderTerminal(r); assert.ok(md.indexOf('BREAKING')<md.indexOf('UNKNOWN')); assert.match(md,/\\\|/); assert.match(md,/\\</); assert.ok(!md.includes('\u001b')); assert.ok(!term.includes('\u202e'));});

test('comparison fail thresholds with injected dependencies',async()=>{for(const [failOn,summary,want] of [['breaking',{breaking:1},1],['breaking',{unknown:1},0],['unknown',{unknown:1},1],['any',{nonBreaking:1},1],['none',{breaking:1},0]]) {const o=sink(),e=sink(); const code=await main(['compare','package.json','package.json','--quiet','--fail-on',failOn],{stdout:o.stream,stderr:e.stream},{validateSnapshot:()=>({ok:true}),compareSnapshots:()=>({summary})}); assert.equal(code,want);}});
