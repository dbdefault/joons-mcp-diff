import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {SnapshotError} from './bounds.js';
const allowed = new Set(['initialize','notifications/initialized','tools/list','ping']);
export function assertAllowed(message) {
  if (message.method && !allowed.has(message.method)) throw new SnapshotError('invalid_response','Method is not allowed');
}
export function childEnvironment(target) {
  const env = {};
  for (const name of ['PATH','SystemRoot','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','LANG']) if(process.env[name] !== undefined) env[name] = process.env[name];
  return {...env,...target.env,...target.secretEnv};
}
function refuseBatch(command, env, cwd) {
  if (/\.(cmd|bat)$/i.test(command)) throw Object.assign(new SnapshotError('spawn_failed','Batch commands require explicit cmd.exe /d /s /c opt-in'),{exitCode:3});
  if(process.platform !== 'win32' || path.extname(command)) return;
  const dirs = /[\\/]/.test(command) ? [''] : [cwd ?? process.cwd(),...(env.PATH ?? '').split(path.delimiter)];
  for(const dir of dirs) for(const ext of (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')) {
    if(existsSync(path.resolve(dir,command+ext))) { if(/\.(cmd|bat)$/i.test(ext)) refuseBatch(command+ext,env,cwd); return; }
  }
}
export class StdioTransport {
  constructor(target, opts) { this.target=target; this.opts=opts; this.bytes=0; this.buffer=Buffer.alloc(0); }
  async start() {
    const env=childEnvironment(this.target); refuseBatch(this.target.command,env,this.target.cwd);
    const child=this.child=spawn(this.target.command,this.target.args ?? [],{cwd:this.target.cwd,env,shell:false,windowsHide:true,detached:process.platform !== 'win32',stdio:['pipe','pipe','pipe']});
    child.stderr.resume(); child.stdin.on('error',()=>{});
    child.on('error',()=>this.onerror?.(new SnapshotError('spawn_failed','Unable to spawn server')));
    child.on('exit',()=>{this.exited=true; if(!this.closing) this.onerror?.(new SnapshotError('process_exited','Server exited')); this.onclose?.();});
    child.stdout.on('data',chunk=>{
      try {
        this.bytes+=chunk.length;
        if(this.bytes>this.opts.maxTotalBytes) throw new SnapshotError('limit_exceeded','Maximum total bytes exceeded');
        this.buffer=Buffer.concat([this.buffer,chunk]);
        let end;
        while((end=this.buffer.indexOf(10))>=0) {
          if(end>this.opts.maxMessageBytes) throw new SnapshotError('limit_exceeded','Maximum message bytes exceeded');
          const line=this.buffer.subarray(0,end); this.buffer=this.buffer.subarray(end+1);
          if(line.toString().trim()) this.onmessage?.(JSON.parse(line.toString()));
        }
        if(this.buffer.length>this.opts.maxMessageBytes) throw new SnapshotError('limit_exceeded','Maximum message bytes exceeded');
      } catch(error) { this.onerror?.(error instanceof SnapshotError ? error : new SnapshotError('invalid_response','Invalid JSON-RPC message')); }
    });
  }
  async send(message) { assertAllowed(message); await new Promise((resolve,reject)=>this.child.stdin.write(JSON.stringify(message)+'\n',error=>error?reject(error):resolve())); }
  close() { return this.closePromise ??= this.cleanup(); }
  async cleanup() {
    this.closing=true; const child=this.child; if(!child?.pid) return;
    const wait=ms=>new Promise(resolve=>{if(this.exited)return resolve(); const timer=setTimeout(done,ms); function done(){clearTimeout(timer);child.removeListener('exit',done);resolve();} child.once('exit',done);});
    try {
      if(process.platform==='win32') {
        await new Promise(resolve=>{const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,shell:false,stdio:'ignore'}); const timer=setTimeout(()=>{killer.kill();this.taskkillFailed=true;resolve();},Math.min(500,this.opts.closeTimeoutMs/3)); killer.once('error',()=>{this.taskkillFailed=true;clearTimeout(timer);resolve();}); killer.once('exit',code=>{this.taskkillFailed=code!==0;clearTimeout(timer);resolve();});});
      } else { try {process.kill(-child.pid,'SIGKILL');} catch {} }
      if(!this.exited) {this.fallbackUsed=true;try{child.kill('SIGKILL');}catch{}}
      await wait(Math.max(1,this.opts.closeTimeoutMs-600));
    } finally { child.stdin.destroy();child.stdout.destroy();child.stderr.destroy(); }
  }
}
export function createTransport(target,opts,onFatal) {
  if(target.transport==='stdio') return new StdioTransport(target,opts);
  if(target.transport!=='http') throw new SnapshotError('invalid_response','Unsupported transport');
  let total=0;
  const transport=new StreamableHTTPClientTransport(new URL(target.url),{requestInit:{headers:target.headers},fetch:async(input,init)=>{
    const response=await fetch(input,init);
    if(response.status===401 || response.status===403) { const error=new SnapshotError('auth_failed','HTTP authentication failed');onFatal(error);throw error; }
    if(!response.body)return response;
    let count=0;
    const body=response.body.pipeThrough(new TransformStream({transform(chunk,controller){count+=chunk.length;total+=chunk.length;if(count>opts.maxMessageBytes || total>opts.maxTotalBytes){const error=new SnapshotError('limit_exceeded','Maximum response bytes exceeded');onFatal(error);throw error;}controller.enqueue(chunk);}}));
    return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  }});
  const send=transport.send.bind(transport);transport.send=(message,...rest)=>{assertAllowed(message);return send(message,...rest);};return transport;
}
