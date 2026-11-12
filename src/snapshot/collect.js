import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {z} from 'zod';
import {createTransport} from './transport.js';
import {createMasker} from './secrets.js';
import {SnapshotError,limits,sanitize} from './bounds.js';
import {validateSnapshot} from '../model/validate.js';
const publicMessages = {spawn_failed:'Unable to start server',connection_refused:'Connection refused',handshake_failed:'Server initialization failed',protocol_mismatch:'Unsupported protocol version',invalid_response:'Invalid server response',timeout:'Snapshot deadline exceeded',process_exited:'Server exited',auth_failed:'Authentication failed',limit_exceeded:'Snapshot limit exceeded',unknown:'Snapshot failed'};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export {SnapshotError} from './bounds.js';
export async function takeSnapshot(target,options={}) {
  const opts=limits(options); const started=Date.now();let mask=value=>String(value);
  const client=new Client({name:'joons-mcp-diff',version:'0.1.0'},{capabilities:{}});
  let rejectFatal;const fatal=new Promise((_,reject)=>{rejectFatal=reject;});fatal.catch(()=>{});
  let transport;let stage='initialize';let protocolVersion=null;let timer;let stepTimer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new SnapshotError('timeout','Total deadline exceeded')),opts.totalTimeoutMs);});
  const step=async operation=>{try{return await Promise.race([operation,fatal,deadline,new Promise((_,reject)=>{stepTimer=setTimeout(()=>reject(new SnapshotError('timeout',`${stage} deadline exceeded`)),opts.stepTimeoutMs);})]);}finally{clearTimeout(stepTimer);}};
  const interrupt=()=>rejectFatal(new SnapshotError('timeout','Snapshot interrupted'));process.once('SIGINT',interrupt);
  try {
    mask=createMasker(target,options.extraSecrets ?? options.secrets ?? []);
    if(Date.now()-started>=opts.totalTimeoutMs)throw new SnapshotError('timeout','Snapshot deadline exceeded');
    transport=createTransport(target,opts,rejectFatal);
    const originalSend=transport.send.bind(transport);transport.send=(message,...rest)=>{if(message.method==='initialize') protocolVersion=message.params.protocolVersion;return originalSend(message,...rest);};
    // Capture the negotiated version without retaining the untrusted initialize payload.
    const start=transport.start.bind(transport);transport.start=async()=>{const receive=transport.onmessage;transport.onmessage=message=>{if(message.result?.protocolVersion)protocolVersion=message.result.protocolVersion;receive?.(message);};const error=transport.onerror;transport.onerror=e=>{rejectFatal(e);error?.(e);};await start();};
    await step(client.connect(transport,{timeout:opts.stepTimeoutMs}));
    stage='tools/list';const tools=[];const originals=new Set();const masked=new Set();const duplicateNames=new Set();let collisions=0;let pages=0;let cursor;const cursors=new Set();let count=0;
    do {
      if(pages>=opts.maxPages)throw new SnapshotError('limit_exceeded','Maximum pages exceeded');
      const result=await step(client.request({method:'tools/list',params:cursor===undefined?{}:{cursor}},z.object({tools:z.array(z.unknown()),nextCursor:z.string().optional()}).passthrough(),{timeout:opts.stepTimeoutMs}));pages++;
      count+=result.tools.length;if(count>opts.maxTools)throw new SnapshotError('limit_exceeded','Maximum tools exceeded');
      for(const raw of result.tools) {
        // Malformed tools fail the whole collection with invalid_response. Never
        // silently repair/drop them, including malformed duplicate-name records.
        if(!object(raw) || typeof raw.name!=='string' || !raw.name.length || !object(raw.inputSchema)
          || ['title','description'].some(key=>raw[key]!=null && typeof raw[key]!=='string')
          || ['outputSchema','annotations'].some(key=>raw[key]!=null && !object(raw[key]))) throw new SnapshotError('invalid_response','Invalid tool record');
        const record=raw;const rawName=record.name;
        if(originals.has(rawName)){
          duplicateNames.add(sanitize(rawName,mask,opts));
          // Statistics lists share the configured tool-count ceiling.
          if(duplicateNames.size>opts.maxTools)throw new SnapshotError('limit_exceeded','Maximum duplicate names exceeded');
          continue;
        }originals.add(rawName);
        const name=sanitize(rawName,mask,opts);if(masked.has(name)){collisions++;continue;}masked.add(name);
        const tool={name};for(const key of ['title','description','inputSchema','outputSchema','annotations'])tool[key]=sanitize(record[key] ?? null,mask,opts);tools.push(tool);
      }
      cursor=result.nextCursor;if(cursor!==undefined){if(cursors.has(cursor))throw new SnapshotError('invalid_response','Cursor loop detected');cursors.add(cursor);}
    }while(cursor!==undefined);
    tools.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    const info=client.getServerVersion();const stats={toolCount:tools.length,pages};if(duplicateNames.size)stats.duplicateNames=[...duplicateNames].sort();if(collisions)stats.maskedNameCollisions=collisions;
    const snapshot={format:'joons-mcp-diff/snapshot',schemaVersion:1,createdAt:new Date().toISOString(),tool:{name:'joons-mcp-diff',version:'0.1.0'},label:options.label==null?null:sanitize(options.label,mask,opts),server:{name:sanitize(info?.name ?? '',mask,opts),version:sanitize(info?.version ?? '',mask,opts),protocolVersion:sanitize(protocolVersion,mask,opts)},tools,stats};
    // Include envelope depth and truncation markers in the final validity check.
    const validation=validateSnapshot(snapshot);
    if(!validation.ok) throw new SnapshotError(validation.errors.some(e=>e.message.startsWith('Maximum'))?'limit_exceeded':'invalid_response','Invalid collected snapshot');
    return snapshot;
  } catch(error) {
    let kind=error instanceof SnapshotError && Object.hasOwn(publicMessages,error.kind)?error.kind:undefined;
    if(!kind){const text=String(error.message);kind=error.code===401||error.code===403?'auth_failed':error.cause?.code==='ECONNREFUSED'||error.code==='ECONNREFUSED'?'connection_refused':/timed out|timeout/i.test(text)?'timeout':/protocol version.*not supported/i.test(text)?'protocol_mismatch':stage==='initialize'?'handshake_failed':'invalid_response';}
    const out=new SnapshotError(kind,mask(publicMessages[kind] ?? publicMessages.unknown));if(error.exitCode===3)out.exitCode=3;throw out;
  } finally {
    clearTimeout(timer);clearTimeout(stepTimer);process.removeListener('SIGINT',interrupt);
    let closeTimer;try{await Promise.race([Promise.resolve(transport?.close()).catch(()=>{}),new Promise(resolve=>{closeTimer=setTimeout(resolve,opts.closeTimeoutMs);})]);}catch{}finally{clearTimeout(closeTimer);}
  }
}
