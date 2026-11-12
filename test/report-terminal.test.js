import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTerminal} from '../src/report/terminal.js';
const c=(severity,message='message')=>({kind:'kind',path:'/x',severity,message,before:null,after:null});
const result={format:'joons-mcp-diff/result',schemaVersion:1,before:{label:null,server:{},toolCount:2},after:{label:null,server:{},toolCount:3},summary:{added:1,removed:1,changed:1,unchanged:0,breaking:1,nonBreaking:1,unknown:1,risk:'high'},tools:[{name:'unknown',status:'changed',changes:[c('UNKNOWN')]},{name:'breaking',status:'removed',changes:[c('BREAKING')]},{name:'added',status:'added',changes:[c('NON_BREAKING')]}],renameHints:[]};
test('summary counts and risk',()=>assert.match(renderTerminal(result),/Risk: high.*added 1, removed 1, changed 1, unchanged 0.*breaking 1, non-breaking 1, unknown 1/));
test('breaking first and non-breaking omitted',()=>{const s=renderTerminal(result);assert.ok(s.indexOf('BREAKING')<s.indexOf('UNKNOWN'));assert.ok(!s.includes('added /x'));});
test('empty diff',()=>assert.match(renderTerminal({...result,summary:{risk:'none'},tools:[]}),/No changes/));
test('no ANSI by default',()=>assert.ok(!renderTerminal(result).includes('\x1b')));
test('color enabled explicitly',()=>assert.ok(renderTerminal(result,{color:true}).includes('\x1b[')));
test('hostile controls removed',()=>{const r={...result,tools:[{name:'bad\x1b[31m\u202e',changes:[c('BREAKING','hello\x00\x85world')]}]};assert.ok(!/[\x00\x1b\x85\u202e]/.test(renderTerminal(r)));});
test('long names truncated',()=>{const r={...result,tools:[{name:'x'.repeat(400),changes:[c('BREAKING')]}]};assert.ok(!renderTerminal(r).includes('x'.repeat(301)));});

test('rename hint uses an ASCII arrow and sanitizes text',()=>{const text=renderTerminal({...result,renameHints:[{from:'old\x1b[31m',to:'new',similarity:.9,reason:'same'}]});assert.match(text,/old -> new/);assert.ok(!text.includes('\x1b'));});
