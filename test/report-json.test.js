import test from 'node:test';
import assert from 'node:assert/strict';
import {renderJSON} from '../src/report/json.js';
const result={format:'joons-mcp-diff/result',schemaVersion:1,before:{label:null,server:{name:'s'},toolCount:1},after:{label:null,server:{name:'s'},toolCount:2},summary:{added:1,removed:0,changed:0,unchanged:1,breaking:0,nonBreaking:1,unknown:0,risk:'low'},tools:[{name:'new',status:'added',changes:[{kind:'tool_added',path:'',severity:'NON_BREAKING',message:'Added',before:null,after:{z:1,a:2}}]}],renameHints:[{from:'old',to:'new',similarity:.9,reason:'schema'}]};
test('result round trips exactly',()=>assert.deepEqual(JSON.parse(renderJSON(result)),result));
test('stable ordering recursively',()=>assert.ok(renderJSON(result).indexOf('"a": 2')<renderJSON(result).indexOf('"z": 1')));
test('pretty with trailing newline',()=>assert.match(renderJSON(result),/^\{\n  "after"[\s\S]*\n\}\n$/));
test('deterministic',()=>assert.equal(renderJSON(result),renderJSON(result)));
