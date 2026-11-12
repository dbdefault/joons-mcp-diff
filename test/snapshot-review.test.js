import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {takeSnapshot,SnapshotError} from '../src/snapshot/collect.js';
import {createMasker} from '../src/snapshot/secrets.js';
import {sanitize,limits} from '../src/snapshot/bounds.js';
import {validateSnapshot} from '../src/model/validate.js';

async function serve(tools, run, error) {
  const server=http.createServer(async(req,res)=>{
    if(req.method!=='POST'){res.writeHead(405).end();return;}
    let body='';for await(const chunk of req)body+=chunk;
    const m=JSON.parse(body);if(m.id===undefined){res.writeHead(202).end();return;}
    const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'review',version:'1'}}:{tools};
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:m.id,...(error?{error:{code:-32603,message:error}}:{result})}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{return await run(`http://127.0.0.1:${server.address().port}/`);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
const tool=inputSchema=>({name:'echo',inputSchema});
test('RR1 finding 1: lowercase query escape survives no longer (HTTP repro)',async()=>{
  await serve([{...tool({type:'object'}),description:'a%2fb'}],async url=>{
    const s=await takeSnapshot({transport:'http',url:url+'?token=a%2fb'});
    assert.equal(s.tools[0].description,'[REDACTED]');assert.equal(validateSnapshot(s).ok,true);
  });
});
test('RR1 finding 1: mixed percent escapes, unreserved encoding, form spaces and case sensitivity',()=>{
  for(const target of [{secretEnv:{KEY:'a/b c'}},{headers:{Authorization:'a/b c'}},{url:'http://a%2fb%20c:pass@127.0.0.1/?token=other'},{url:'http://127.0.0.1/?token=%61%2fb+c'}]) {
    const mask=createMasker(target);
    for(const value of ['a/b c','a%2fb%20c','%61%2Fb+c','%61%2f%62%20%63',Buffer.from('a/b c').toString('base64'),Buffer.from('a/b c').toString('base64url')]) assert.equal(mask(value),'[REDACTED]',value);
    assert.equal(mask('A/B C'),'A/B C');
  }
});
test('RR1 finding 4: schema-key collisions choose canonical original key',async()=>{
  const opts=limits();const mask=createMasker({},['alpha','bravo']);
  assert.equal(JSON.stringify(sanitize({alpha:1,bravo:2},mask,opts)),JSON.stringify(sanitize({bravo:2,alpha:1},mask,opts)));
  const snapshots=[];
  for(const properties of [{alpha:{type:'string'},bravo:{type:'number'}},{bravo:{type:'number'},alpha:{type:'string'}}]) await serve([tool({type:'object',properties})],async url=>{const s=await takeSnapshot({transport:'http',url},{extraSecrets:['alpha','bravo']});delete s.createdAt;snapshots.push(JSON.stringify(s));});
  assert.equal(snapshots[0],snapshots[1]);
});
test('RR1 finding 5: malformed [null, {}, 42] fails invalid_response',async()=>{
  await serve([null,{},42],url=>assert.rejects(takeSnapshot({transport:'http',url}),{kind:'invalid_response'}));
});
test('RR1 finding 5: malformed tool fields fail, including duplicate records',async()=>{
  for(const bad of [{name:'',inputSchema:{}},{name:'echo'},tool(null),tool([]),{...tool({}),title:42},{...tool({}),description:{}},{...tool({}),outputSchema:[]},{...tool({}),annotations:false}]) await serve([tool({}),bad],url=>assert.rejects(takeSnapshot({transport:'http',url}),{kind:'invalid_response'}));
});
test('RR1 finding 5: truncated strings still produce validator-valid snapshots',async()=>{
  await serve([{...tool({}),description:'x'.repeat(100001)}],async url=>{const s=await takeSnapshot({transport:'http',url});assert.equal(s.tools[0].description.length,100000);assert.ok(s.tools[0].description.endsWith('[TRUNCATED]'));assert.equal(validateSnapshot(s).ok,true);});
});
test('RR1 finding 6: 100-character property key with maxStringLength 12 fails',async()=>{
  await serve([tool({properties:{['k'.repeat(100)]:{type:'string'}}})],url=>assert.rejects(takeSnapshot({transport:'http',url},{maxStringLength:12}),{kind:'limit_exceeded'}));
  assert.throws(()=>sanitize({x:1},createMasker({},['x']),limits({maxStringLength:5})),{kind:'limit_exceeded'});
});
test('RR1 finding 7: remote paths, hostnames and secrets never enter typed errors',async()=>{
  await serve([],url=>assert.rejects(takeSnapshot({transport:'http',url},{extraSecrets:['credential']}),error=>{assert.ok(error instanceof SnapshotError);assert.equal(error.kind,'handshake_failed');assert.equal(error.message,'Server initialization failed');return true;}),'failure at C:/private/work/server.js remote.example credential %63redential');
});
