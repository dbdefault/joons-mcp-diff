import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compareSnapshots,SnapshotValidationError} from '../src/diff/compare.js';
import {compareInputSchema as diff} from '../src/diff/schema.js';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/snapshots/rs2-regressions.json',import.meta.url),'utf8'));
for(const row of fixtures)test(`${row.id} ${row.name}`,()=>{
  const a=structuredClone(row.before),b=structuredClone(row.after);
  if(row.reconstruct==='sparseTools')a.tools=new Array(1);
  if(row.reconstruct==='sparseEnum')a.tools[0].inputSchema.enum=new Array(1);
  if(row.expected==='REJECT'){assert.throws(()=>compareSnapshots(a,b),SnapshotValidationError);return;}
  const r=compareSnapshots(a,b,{all:true}),s=r.summary;
  const actual=s.breaking?'BREAKING':s.unknown?'UNKNOWN':s.nonBreaking?'NON_BREAKING':'UNCHANGED';
  assert.equal(actual,row.expected,row.reason+' '+JSON.stringify(r.tools));
  assert.deepEqual(compareSnapshots(a,b,{all:true}),r);
  for(const [key,severity] of [['breaking','BREAKING'],['unknown','UNKNOWN'],['nonBreaking','NON_BREAKING']])assert.equal(s[key],r.tools.flatMap(t=>t.changes).filter(c=>c.severity===severity).length);
});
for(const endpoint of [Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1,-Number.MAX_SAFE_INTEGER,-Number.MAX_SAFE_INTEGER-1]) {
  for(const [closed,open] of [['minimum','exclusiveMinimum'],['maximum','exclusiveMaximum']]) {
    for(const reverse of [false,true])test(`RS2 integer exactness ${endpoint} ${closed} reverse=${reverse}`,()=>{
      let a={type:'integer',[closed]:endpoint},b={type:'integer',[open]:endpoint};if(reverse)[a,b]=[b,a];
      const unsafe=!Number.isSafeInteger(endpoint)||closed==='minimum'&&endpoint===Number.MAX_SAFE_INTEGER||closed==='maximum'&&endpoint===-Number.MAX_SAFE_INTEGER;
      const c=diff(a,b);
      assert.ok(c.some(x=>x.severity===(unsafe?'UNKNOWN':reverse?'NON_BREAKING':'BREAKING')));
      if(unsafe){assert.ok(c.every(x=>x.severity==='UNKNOWN'));assert.ok(diff({...a,title:'a'},{...b,title:'b'}).some(x=>x.severity==='UNKNOWN'));}
    });
  }
}
for(const [name,value,expected] of [
  ['unique integers',[1,2],'UNCHANGED'],['duplicate integers',[1,1],'BREAKING'],
  ['duplicate objects',[{a:1,b:2},{b:2,a:1}],'BREAKING'],
  ['ordered nested arrays',[[1,2],[2,1]],'UNCHANGED'],
  ['duplicate zero',[0,-0],'BREAKING'],['duplicate null',[null,null],'BREAKING'],
  ['nonarray scalar','text','UNCHANGED'],
])test('RS2 uniqueItems finite '+name,()=>{
  const a={const:value},b={const:value,uniqueItems:true};
  const c=diff(a,b);assert.equal(c.length===0?'UNCHANGED':c.some(x=>x.severity==='BREAKING')?'BREAKING':'OTHER',expected);
  if(expected==='BREAKING')assert.ok(diff(b,a).some(x=>x.severity==='NON_BREAKING'));
});
test('RS2 finite uniqueness unsupported context stays unknown',()=>assert.ok(diff({enum:[[1,2]],custom:true},{enum:[[1,2]],custom:true,uniqueItems:true}).some(c=>c.severity==='UNKNOWN')));
test('RS2 asymmetric finite analysis never supplies a safety verdict',()=>{
  const a={enum:[1],minimum:2},b={enum:[1],custom:true};
  assert.ok(diff(a,b).some(c=>c.severity==='UNKNOWN'));
  assert.ok(!diff(a,b).some(c=>c.kind==='enum_values_added'&&c.severity==='NON_BREAKING'));
});
test('RS2 malformed nested property enum cannot crash validated comparison',()=>{
  const a=structuredClone(fixtures[0].before),b=structuredClone(a);
  a.tools[0].inputSchema={properties:{x:{enum:1}},additionalProperties:false};b.tools[0].inputSchema={additionalProperties:false};
  assert.doesNotThrow(()=>compareSnapshots(a,b));assert.equal(compareSnapshots(a,b).summary.risk,'unknown');
});
test('RS2 exact finite comparison supports large numeric values without rounding',()=>{
  const n=Number.MAX_SAFE_INTEGER+1,a={type:'integer',enum:[n],minimum:n},b={type:'integer',enum:[n],exclusiveMinimum:n};
  assert.ok(diff(a,b).some(c=>c.severity==='BREAKING'));assert.ok(diff(b,a).some(c=>c.severity==='NON_BREAKING'));
});
test('RS2 dense structural JSON keyword matrix never crashes comparison',()=>{
  const sample=()=>structuredClone(fixtures[0].before);
  const values=[null,false,true,0,1,'x',[],[null],{}, {type:1},{enum:1},{required:1},{items:false}];
  const keys=['enum','const','required','type','properties','items','additionalProperties','minimum','maximum','exclusiveMinimum','minItems','uniqueItems','$ref','$defs','oneOf','patternProperties'];
  for(const key of keys)for(const value of values)for(const mode of ['root','removed','added','nested']) {
    const a=sample(),b=sample(),s={[key]:value};
    if(mode==='root'){a.tools[0].inputSchema=s;b.tools[0].inputSchema={};}
    if(mode==='removed'){a.tools[0].inputSchema={properties:{x:s},additionalProperties:false};b.tools[0].inputSchema={additionalProperties:false};}
    if(mode==='added'){a.tools[0].inputSchema={};b.tools[0].inputSchema={properties:{x:s}};}
    if(mode==='nested'){a.tools[0].inputSchema={items:s};b.tools[0].inputSchema={items:{type:'string'}};}
    assert.doesNotThrow(()=>compareSnapshots(a,b),`${key} ${mode} ${JSON.stringify(value)}`);
  }
});
