import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compareSnapshots,SnapshotValidationError} from '../src/diff/compare.js';
import {compareInputSchema as diff} from '../src/diff/schema.js';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/snapshots/rs1-regressions.json',import.meta.url),'utf8'));
for(const row of fixtures) test(`${row.id} ${row.name}`,()=>{
  if(row.expected==='REJECT'){assert.throws(()=>compareSnapshots(row.before,row.after),SnapshotValidationError);return;}
  const result=compareSnapshots(row.before,row.after,{all:true});
  const s=result.summary,actual=s.breaking?'BREAKING':s.unknown?'UNKNOWN':s.nonBreaking?'NON_BREAKING':'UNCHANGED';
  assert.equal(actual,row.expected,row.reason+' '+JSON.stringify(result.tools));
  assert.deepEqual(compareSnapshots(row.before,row.after,{all:true}),result);
  for(const [key,severity] of [['breaking','BREAKING'],['unknown','UNKNOWN'],['nonBreaking','NON_BREAKING']])assert.equal(s[key],result.tools.flatMap(t=>t.changes).filter(c=>c.severity===severity).length);
});
test('RS1 required affected name is stable and escaped',()=>{
  const a=diff({},{required:['locale','a~/b']});
  const b=diff({},{required:['a~/b','locale']});
  assert.deepEqual(a,b);assert.deepEqual(a.map(c=>c.path),['/required/a~0~1b','/required/locale']);
});
test('RS1 const source path',()=>assert.ok(diff({const:1},{const:2}).every(c=>c.path==='/const')));
for(const key of ['title','description','examples','deprecated']) {
  for(const container of ['oneOf','allOf','anyOf','$defs','properties','items','not','if','then','else','dependentSchemas','patternProperties','additionalProperties','contains','propertyNames','unevaluatedProperties','unevaluatedItems','prefixItems']) {
    test(`RS1 exact documentation path ${container}/${key}`,()=>{
      const sequence=['oneOf','allOf','anyOf','prefixItems'].includes(container),map=['$defs','properties','dependentSchemas','patternProperties'].includes(container);
      const wrap=s=>sequence?{[container]:[s]}:map?{[container]:{x:s}}:{[container]:s};
      const x=diff(wrap({type:'string',[key]:key==='deprecated'?false:key==='examples'?['a']:'a'}),wrap({type:'string',[key]:key==='deprecated'?true:key==='examples'?['b']:'b'}));
      assert.equal(x.length,1);assert.equal(x[0].severity,'NON_BREAKING');assert.equal(x[0].path,'/'+container+(sequence?'/0':map?'/x':'')+'/'+key);assert.equal(x[0].kind,key+'_changed');
    });
  }
}
test('RS1 literal docs are data, not annotations',()=>assert.ok(diff({oneOf:[{const:{description:'a'}}]},{oneOf:[{const:{description:'b'}}]}).some(c=>c.severity==='UNKNOWN')));
test('RS1 literal ref is data, never dereferenced',()=>assert.deepEqual(diff({const:{$ref:'#/missing'}},{const:{$ref:'#/missing'}}),[]));
for(const [a,b] of [
  [{exclusiveMinimum:1},{minimum:0,exclusiveMinimum:1}],
  [{type:'integer',maximum:3},{type:'integer',exclusiveMaximum:4}],
  [{type:'integer',minimum:1.2},{type:'integer',minimum:2}],
  [{type:'number',minimum:1,maximum:0},{type:'number',minimum:9,maximum:0}],
  [{enum:[1,2],minimum:2},{const:2}],
  [{enum:[1],type:'string'},{enum:[2],type:'string'}],
]) test('RS1 combined domain '+JSON.stringify(a),()=>assert.deepEqual(diff(a,b),[]));
test('RS1 patterns block safe property addition inference',()=>assert.equal(diff({additionalProperties:false,patternProperties:{x:{type:'number'}}},{additionalProperties:false,patternProperties:{x:{type:'number'}},properties:{x:{type:'string'}}})[0].severity,'UNKNOWN'));
for(const [a,b] of [
  [{const:1,enum:[1,2]},{const:1,enum:[2]}],
  [{enum:[{enum:[1,2]}]},{enum:[{enum:[2,1]}]}],
  [{const:{required:['a','b']}},{const:{required:['b','a']}}],
])test('RS1 finite restrictions both directions '+JSON.stringify(a),()=>{
  assert.ok(diff(a,b).some(c=>c.severity==='BREAKING'));
  assert.ok(diff(b,a).some(c=>c.severity==='NON_BREAKING'));
});
test('RS1 removing provably empty property is unchanged',()=>assert.deepEqual(diff({properties:{x:{const:1,enum:[2]}},additionalProperties:false},{additionalProperties:false}),[]));
test('RS1 unproved property satisfiability is unknown',()=>assert.equal(diff({properties:{x:{not:{}}},additionalProperties:false},{additionalProperties:false})[0].severity,'UNKNOWN'));
test('RS1 false properties identical',()=>assert.deepEqual(diff({properties:{x:false}},{properties:{x:false}}),[]));
test('RS1 unresolved type interactions never claim breaking',()=>assert.ok(diff({enum:[1]},{type:'number'}).every(c=>c.severity!=='BREAKING')));
test('RS1 scalar numeric interval redundant lower and upper',()=>assert.deepEqual(diff({minimum:2,exclusiveMinimum:1,maximum:4,exclusiveMaximum:5},{minimum:2,maximum:4}),[]));
test('RS1 numeric applicability both directions',()=>assert.deepEqual(diff({type:'string',minimum:1},{type:'string'}),[]));
test('RS1 complex change plus docs stays unknown',()=>{const c=diff({oneOf:[{type:'string',description:'a'}]},{oneOf:[{type:'number',description:'b'}]});assert.equal(c.length,1);assert.equal(c[0].severity,'UNKNOWN');});
for(const [a,b] of [
  [{type:'string'},{type:'string',minLength:0}],
  [{type:'array'},{type:'array',minItems:0}],
  [{minLength:3,maxLength:1},{minLength:4,maxLength:1}],
  [{minItems:3,maxItems:1},{minItems:4,maxItems:1}],
])test('RS1 combined nonnumeric domain '+JSON.stringify(a),()=>{assert.deepEqual(diff(a,b),[]);assert.deepEqual(diff(b,a),[]);});
test('RS1 changed unresolved additional schema does not throw',()=>assert.equal(diff({additionalProperties:{$ref:'#/missing',title:'a'}},{additionalProperties:{$ref:'#/missing',title:'b'}})[0].severity,'UNKNOWN'));
