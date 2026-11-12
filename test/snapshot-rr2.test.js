import test from 'node:test';
import assert from 'node:assert/strict';
import {createMasker} from '../src/snapshot/secrets.js';
import {takeSnapshot,SnapshotError} from '../src/snapshot/collect.js';
import {validateSnapshot} from '../src/model/validate.js';

test('RR2 N1 repro: 120000-character secret cannot escape through native errors',async()=>{
  const secret='RR2-private-'.repeat(10000);
  await assert.rejects(takeSnapshot({transport:'stdio',command:process.execPath,secretEnv:{S:secret}},{totalTimeoutMs:1,closeTimeoutMs:1}),error=>{
    assert.ok(error instanceof SnapshotError);assert.ok(error.message.length<100);
    assert.equal(error.message.includes(secret),false);
    assert.equal(error.message.includes('RR2-private-'),false);return true;
  });
});

test('RR2 N1: literal 1 MiB secret and metacharacters mask without regex compilation',()=>{
  const secret='a'.repeat(1024*1024-24)+'[](){}.*+?^$|\\-/%'.padEnd(24,'z');
  assert.equal(Buffer.byteLength(secret),1024*1024);
  const mask=createMasker({},[secret]);
  assert.equal(mask('prefix '+secret+' suffix'),'prefix [REDACTED] suffix');
  assert.equal(mask(Buffer.from(secret).toString('base64').replace(/=+$/,'')),'[REDACTED]');
  const special='[](){}.*+?^$|\\-/%';
  const literal=createMasker({secretEnv:{TOKEN:special}});
  assert.equal(literal('before '+special+' after'),'before [REDACTED] after');
  assert.equal(literal(encodeURIComponent(special)),'[REDACTED]');
  assert.equal(literal('ordinary text'),'ordinary text');
});

for(const channel of ['secretEnv','headers','extraSecrets'])test(`RR2 N1: 1 MiB ${channel} preprocessing has safe typed errors and deadline accounting`,async()=>{
  const secret='large-private-value-'.repeat(60000).slice(0,1024*1024);
  const target={transport:'stdio',command:process.execPath};
  const options={totalTimeoutMs:1,closeTimeoutMs:1};
  if(channel==='extraSecrets')options.extraSecrets=[secret];else target[channel]={S:secret};
  await assert.rejects(takeSnapshot(target,options),error=>{
    assert.ok(error instanceof SnapshotError);assert.equal(error.kind,'timeout');
    assert.ok(error.message.length<100);assert.equal(error.message.includes('large-private-value-'),false);return true;
  });
});

test('RR2 N1: construction failures never forward secret-bearing native messages',async()=>{
  const extra={get dangerous(){throw new Error('sensitive-private-material');}};
  assert.throws(()=>createMasker({},extra),error=>error instanceof SnapshotError && error.message==='Invalid secret configuration');
  await assert.rejects(takeSnapshot({transport:'stdio',command:process.execPath},{extraSecrets:extra}),error=>error instanceof SnapshotError && error.message==='Invalid server response');
});

const source=`import readline from 'node:readline';
for await(const line of readline.createInterface({input:process.stdin})){
 const m=JSON.parse(line);if(m.id===undefined)continue;
 const names=JSON.parse(process.env.SNAPSHOT_NAMES);
 const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'r',version:'1'}}:{tools:names.map(name=>({name,inputSchema:{type:'object'}}))};
 console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
}`;
const target=names=>({transport:'stdio',command:process.execPath,args:['--input-type=module','-e',source],env:{SNAPSHOT_NAMES:JSON.stringify(names)}});
test('RR2 N2 repro: duplicateNames obeys configured 12-character limit',async()=>{
  const name='n'.repeat(100);const snapshot=await takeSnapshot(target([name,name]),{maxStringLength:12});
  assert.equal(snapshot.tools[0].name.length,12);
  assert.equal(snapshot.stats.duplicateNames[0],snapshot.tools[0].name);
  assert.equal(validateSnapshot(snapshot).ok,true);
});
test('RR2 N2: statistics strings mask before truncating and lists share maxTools cap',async()=>{
  const names=['private-'+ 'a'.repeat(100),'other-'+ 'b'.repeat(100)];
  const s=await takeSnapshot(target([...names,...names]),{maxStringLength:12,maxTools:4,extraSecrets:['private']});
  assert.ok(s.stats.duplicateNames.length<=4);
  for(const name of s.stats.duplicateNames){assert.ok(name.length<=12);assert.equal(name.includes('private'),false);}
  await assert.rejects(takeSnapshot(target([...names,...names]),{maxTools:3}),{kind:'limit_exceeded'});
});

test('RR2 N3 repro: unpadded standard base64 with slash is masked',()=>{
  const secret='ÿÿ';const encoded=Buffer.from(secret).toString('base64').replace(/=+$/,'');
  assert.equal(encoded,'w7/Dvw');assert.equal(createMasker({secretEnv:{S:secret}})(encoded),'[REDACTED]');
});
test('RR2 N3: padded/unpadded standard and URL base64, Bearer and user wrappers',()=>{
  for(const secret of ['ÿÿ','~~~','첼첼','a','[](){}.*+?^$|\\']){
    const mask=createMasker({},[secret]);
    for(const source of [secret,`Bearer ${secret}`,`user:${secret}`]){
      const standard=Buffer.from(source).toString('base64');
      const url=standard.replace(/\+/g,'-').replace(/\//g,'_');
      for(const encoded of new Set([standard,standard.replace(/=+$/,''),url,url.replace(/=+$/,'')])){
        assert.equal(mask('<'+encoded+'>'),'<[REDACTED]>');
        assert.equal(mask(encodeURIComponent(encoded)),'[REDACTED]');
      }
    }
  }
  assert.equal(createMasker({},['CaseSensitive'])('casesensitive'),'casesensitive');
});
