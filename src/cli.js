import { readFile, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import { parse } from './args.js';
import { VERSION } from './version.js';
import { takeSnapshot } from './snapshot/collect.js';
import { compareSnapshots } from './diff/compare.js';
import { validateSnapshot } from './model/validate.js';
import { renderJSON } from './report/json.js';
import { renderMarkdown } from './report/markdown.js';
import { renderTerminal } from './report/terminal.js';
const HELP = 'Usage: joons-mcp-diff snapshot stdio [options] -- command [args...] | snapshot http URL [options] | compare BEFORE AFTER [options]\n';
async function emit(stream, text) { await new Promise((resolve,reject) => { let done=false; const finish=e=>{if(done)return;done=true;stream.removeListener?.('error',onError); e?reject(e):resolve();}; const onError=e=>finish(e); stream.once?.('error',onError); try {stream.write(text, e=>finish(e));} catch(e){finish(e);} }); }
function safeBase(file) { return path.basename(file).replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/g, '').slice(0, 120); }
class InputError extends Error {}
async function load(file, validate) {
  let handle;
  const fail = message => { throw new InputError(`${safeBase(file)}: ${message}`); };
  try {
    try { handle = await open(file, 'r'); } catch { fail('cannot read snapshot'); }
    let data;
    try { const stat = await handle.stat(); if (stat.size > 64*1024*1024) fail('file too large'); data = await handle.readFile(); } catch (e) { if (e instanceof InputError) throw e; fail('cannot read snapshot'); }
    if (data.length > 64*1024*1024) fail('file too large');
    const text = data.toString('utf8'); let obj;
    try { obj = JSON.parse(text); } catch (e) {
      const located = /position (\d+)/i.exec(e.message); const lineCol = /line (\d+) column (\d+)/i.exec(e.message);
      const position = Math.min(text.length, located ? Number(located[1]) : text.length);
      const prefix = text.slice(0, position); const line = lineCol ? Number(lineCol[1]) : prefix.split('\n').length;
      const column = lineCol ? Number(lineCol[2]) : position - prefix.lastIndexOf('\n');
      fail(`invalid JSON at line ${line}, column ${column}`);
    }
    const result = validate(obj);
    if (!result.ok) { const pointer = typeof result.errors?.[0]?.path === 'string' ? result.errors[0].path : ''; const safe = /^\/(?:[A-Za-z0-9_~.-]+\/?)*$/.test(pointer) && pointer.length <= 200 ? pointer : '/'; fail(`invalid snapshot at ${safe}`); }
    return obj;
  } finally { try { await handle?.close(); } catch {} }
}
const reasons = {spawn_failed:'unable to start server',connection_refused:'connection refused',handshake_failed:'initialization failed',protocol_mismatch:'unsupported protocol version',invalid_response:'invalid server response',timeout:'deadline exceeded',process_exited:'server exited',auth_failed:'authentication failed',limit_exceeded:'configured limit exceeded',unknown:'operation failed'};
function snapshotFailure(error) {
  const kind = Object.hasOwn(reasons,error?.kind) ? error.kind : 'unknown';
  let reason = reasons[kind];
  if (error?.exitCode === 3 && kind === 'spawn_failed') reason = 'batch commands require explicit shell opt-in';
  else if (kind === 'timeout' && /^(initialize|tools\/list|Total) deadline exceeded$/i.test(error?.message ?? '')) reason = error.message;
  return `snapshot failed: ${kind} (${reason})`;
}
function mask(text,secrets) { let s=String(text); const variants=new Set(); for(const v of secrets) if(v) {for(const x of [v,encodeURIComponent(v),Buffer.from(v).toString('base64'),Buffer.from(v).toString('base64url')]) if(x) variants.add(x);} for(const v of [...variants].sort((a,b)=>b.length-a.length)) s=s.split(v).join('[REDACTED]'); return s; }
export async function mainInternal(argv=process.argv.slice(2), io={stdout:process.stdout,stderr:process.stderr}, deps={}) { let args; let secrets=[]; const err=async m=>{try {await emit(io.stderr,mask(m,secrets)+'\n');} catch {}}; try { args=parse(argv,deps.env ?? process.env); secrets=args.secrets ?? []; } catch {await err('Invalid arguments. Use --help for usage.'); return 3;} const write=async(file,text)=>{if(file) await (deps.writeFile ?? writeFile)(file,text,'utf8'); else await emit(io.stdout,text);}; try { if(args.command==='--help') {await write(null,HELP); return 0;} if(args.command==='--version') {await write(null,VERSION+'\n'); return 0;} if(args.command==='snapshot') { let snapshot; try {snapshot=await (deps.takeSnapshot ?? takeSnapshot)(args.target,args.options);} catch(e) {await err(snapshotFailure(e)); return e?.exitCode === 3 ? 3 : 2;} await write(args.output,renderJSON(snapshot)); return 0; } let before,after,result; try { before=await load(args.files[0],deps.validateSnapshot ?? validateSnapshot); after=await load(args.files[1],deps.validateSnapshot ?? validateSnapshot); result=await (deps.compareSnapshots ?? compareSnapshots)(before,after,{all:args.all,renameHints:args.renameHints}); } catch(e) {await err(e instanceof InputError ? e.message : 'Comparison failed'); return 2;} if(args.jsonOut) await write(args.jsonOut,renderJSON(result)); if(args.mdOut) await write(args.mdOut,renderMarkdown(result)); if(!args.quiet) await write(null,args.format==='json' ? renderJSON(result) : args.format==='markdown' ? renderMarkdown(result) : renderTerminal(result,{color:args.color && !!io.stdout.isTTY})); const s=result.summary; return args.failOn==='none' ? 0 : args.failOn==='breaking' ? Number(s.breaking>0) : args.failOn==='unknown' ? Number(s.breaking>0 || s.unknown>0) : Number(s.breaking>0 || s.unknown>0 || s.nonBreaking>0); } catch {await err('Output error'); return 4;} }

export function main(argv, io) { return mainInternal(argv, io); }
