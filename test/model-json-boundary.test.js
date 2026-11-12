import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSnapshot} from '../src/model/validate.js';
import {compareSnapshots,SnapshotValidationError} from '../src/diff/compare.js';
const sample=()=>JSON.parse(readFileSync(new URL('./fixtures/snapshots/before.json',import.meta.url),'utf8'));
for(const [name,path,mutate] of [
  ['tools','/tools/0',s=>{s.tools=new Array(1);}],
  ['required','/tools/0/inputSchema/required/0',s=>{s.tools[0].inputSchema.required=new Array(1);}],
  ['enum','/tools/0/inputSchema/enum/0',s=>{s.tools[0].inputSchema.enum=new Array(1);}],
  ['instance','/tools/0/inputSchema/const/0',s=>{s.tools[0].inputSchema.const=new Array(1);}],
  ['nested instance','/tools/0/inputSchema/enum/0/x/0',s=>{s.tools[0].inputSchema.enum=[{x:new Array(1)}];}],
  ['duplicates statistic','/stats/duplicateNames/0',s=>{s.stats.duplicateNames=new Array(1);}],
  ['huge sparse','/extra',s=>{s.extra=new Array(2**32-1);}],
])test('RS2 sparse JSON boundary '+name,()=>{
  const s=sample();mutate(s);const v=validateSnapshot(s);assert.equal(v.ok,false);assert.ok(v.errors.some(e=>e.path===path));
  for(const side of ['before','after'])assert.throws(()=>compareSnapshots(side==='before'?s:sample(),side==='after'?s:sample()),e=>e instanceof SnapshotValidationError&&e.side===side&&e.errors.some(x=>x.path===path));
});
class Custom {constructor(){this.x=1;}}
for(const [name,make] of [
  ['date',()=>new Date()],['map',()=>new Map()],['set',()=>new Set()],['regexp',()=>/x/],
  ['boxed string',()=>new String('x')],['boxed number',()=>new Number(1)],['typed array',()=>new Uint8Array([1])],
  ['class instance',()=>new Custom()],['custom prototype',()=>Object.create({x:1})],
  ['array subclass',()=>new (class extends Array {})(1)],['proxy',()=>new Proxy({},{})],
])for(const place of ['metadata','literal'])test(`RS2 plain JSON boundary ${name} ${place}`,()=>{
  const s=sample();if(place==='metadata')s.extra=make();else s.tools[0].inputSchema.const=make();
  assert.equal(validateSnapshot(s).ok,false);assert.throws(()=>compareSnapshots(s,s),SnapshotValidationError);
});
test('RS2 accessors rejected without running them',()=>{const s=sample();let reads=0;Object.defineProperty(s,'label',{enumerable:true,get(){reads++;throw Error('getter');}});assert.equal(validateSnapshot(s).ok,false);assert.throws(()=>compareSnapshots(s,s),SnapshotValidationError);assert.equal(reads,0);});
test('RS2 symbol and extra array properties rejected',()=>{for(const key of ['extra',Symbol('extra')]){const s=sample();s.extra=[];s.extra[key]=1;assert.equal(validateSnapshot(s).ok,false);}});
test('RS2 null prototype JSON objects remain supported',()=>{const s=sample();s.extra=Object.assign(Object.create(null),{x:[null,1]});assert.equal(validateSnapshot(s).ok,true);assert.doesNotThrow(()=>compareSnapshots(s,s));});
test('RS2 explicit null in literal arrays stays dense valid JSON',()=>{const s=sample();s.tools[0].inputSchema={enum:[[null]]};assert.equal(validateSnapshot(s).ok,true);assert.equal(compareSnapshots(s,s).summary.risk,'none');});
test('RS2 traversal budget rejects dense work safely',()=>{const s=sample();s.extra=Array(50).fill(null);assert.equal(validateSnapshot(s,{maxNodes:20}).ok,false);});
