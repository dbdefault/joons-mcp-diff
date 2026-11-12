import readline from 'node:readline';
const mode=process.argv[2];
if(mode==='exit')process.exit(1);
setInterval(()=>{},1000);
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(!('id'in m))return;if(mode==='timeout')return;
 if(mode==='handshake'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32603,message:'failed'}})+'\n');return;}
 const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}}:{tools:mode==='huge'?Array.from({length:150000},()=>({name:'x'})):[{name:'echo',description:String(process.pid),inputSchema:{type:'object'}}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');
});
