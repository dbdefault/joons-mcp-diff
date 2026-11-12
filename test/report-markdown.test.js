import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown,clean,escapeMarkdown} from '../src/report/markdown.js';
const change=(severity,path='/x')=>({kind:'kind',path,severity,message:'message',before:'old',after:'new'});
const base={format:'joons-mcp-diff/result',schemaVersion:1,before:{label:null,server:{},toolCount:2},after:{label:null,server:{},toolCount:3},summary:{added:1,removed:1,changed:1,unchanged:0,breaking:1,nonBreaking:1,unknown:1,risk:'high'},tools:[{name:'z',status:'added',changes:[change('NON_BREAKING')]},{name:'b',status:'changed',changes:[change('UNKNOWN')]},{name:'a',status:'removed',changes:[change('BREAKING')]}],renameHints:[{from:'old',to:'new',similarity:.92,reason:'same input schema'}]};
test('breaking section first',()=>{const s=renderMarkdown(base);assert.ok(s.indexOf('## a')<s.indexOf('## b'));assert.ok(s.indexOf('## b')<s.indexOf('## z'));});
test('same severity sorted by tool name',()=>{const r={...base,tools:[{name:'z',changes:[change('BREAKING')]},{name:'a',changes:[change('BREAKING')]}]};assert.ok(renderMarkdown(r).indexOf('## a')<renderMarkdown(r).indexOf('## z'));});
test('summary and risk',()=>{const s=renderMarkdown(base);assert.match(s,/Risk: high/);assert.match(s,/\| 1 \| 1 \| 1 \| 0 \| 1 \| 1 \| 1 \|/);});
test('rename hints rendered',()=>assert.match(renderMarkdown(base),/old.*new.*same input schema/));
test('empty diff',()=>assert.match(renderMarkdown({...base,summary:{risk:'none'},tools:[],renameHints:[]}),/No changes/));
for(const c of ['|','`','<','>','\\']) test(`escapes ${c}`,()=>assert.equal(escapeMarkdown(c),'\\'+c));
test('newlines neutralised',()=>assert.ok(!escapeMarkdown('a\nb\rc').includes('\n')));
for(const c of ['\x00','\x1f','\x7f','\x85','\u202e','\u2066','\u200e','\u061c','\x1b[31m']) test(`removes control ${JSON.stringify(c)}`,()=>assert.equal(clean('a'+c+'b'),'ab'));
test('long string truncated',()=>assert.equal(clean('x'.repeat(500)).length,300));
test('long tool name truncated',()=>{const s=renderMarkdown({...base,tools:[{name:'x'.repeat(500),changes:[]}],renameHints:[]});assert.ok(!s.includes('x'.repeat(301)));});

test('rename hint uses an ASCII arrow',()=>assert.match(renderMarkdown(base),/old -> new/));
