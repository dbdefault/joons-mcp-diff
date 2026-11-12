import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSnapshot} from '../src/model/validate.js';
import {compareSnapshots,SnapshotValidationError} from '../src/diff/compare.js';
const sample=()=>JSON.parse(readFileSync(new URL('./fixtures/snapshots/before.json',import.meta.url),'utf8'));
for(const version of [0,2,999,'1',null,undefined])test('unknown snapshot version '+version,()=>{
  const s=sample();if(version===undefined)delete s.schemaVersion;else s.schemaVersion=version;
  const v=validateSnapshot(s);assert.equal(v.ok,false);assert.ok(v.errors.some(e=>e.path==='/schemaVersion'&&e.message.includes('only version 1')));
  for(const side of ['before','after'])assert.throws(()=>compareSnapshots(side==='before'?s:sample(),side==='after'?s:sample()),e=>e instanceof SnapshotValidationError&&e.code==='INVALID_SNAPSHOT'&&e.side===side&&e.errors.some(x=>x.path==='/schemaVersion'));
});
test('comparison rejects duplicate names',()=>{const s=sample();s.tools.push(s.tools[0]);s.stats.toolCount++;assert.throws(()=>compareSnapshots(s,s),e=>e instanceof SnapshotValidationError&&e.errors.some(x=>x.path==='/tools/1/name'));});
test('additive unknown metadata accepted but not copied into result',()=>{const s=sample();s.future='value';s.server.future='value';const r=compareSnapshots(s,s);assert.equal(r.schemaVersion,1);assert.equal(r.before.server.future,undefined);assert.equal(r.future,undefined);});
