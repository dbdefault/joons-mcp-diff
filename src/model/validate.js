import {isProxy} from 'node:util/types';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const esc = s => s.replace(/~/g,'~0').replace(/\//g,'~1');
export function validateSnapshot(value, options = {}) {
  const errors = [], limits = {maxDepth:64,maxTools:10000,maxStringLength:100000,maxArrayLength:1000000,maxNodes:1000000,...options};
  const error = (path,message) => errors.push({path,message});
  const ancestors = new Set();
  let nodes = 0;
  function walk(v,path,depth) {
    if (++nodes > limits.maxNodes) {if(nodes===limits.maxNodes+1)error(path,'Maximum JSON node count exceeded');return;}
    if (depth > limits.maxDepth) { error(path,'Maximum depth exceeded'); return; }
    if (typeof v === 'string' && v.length > limits.maxStringLength) error(path,'Maximum string length exceeded');
    if (typeof v === 'number' && !Number.isFinite(v) || ['undefined','function','symbol','bigint'].includes(typeof v)) error(path,'Expected JSON value');
    if (v && typeof v === 'object') {
      if(isProxy(v)) {error(path,'Expected plain JSON data, not a Proxy');return;}
      const array=Array.isArray(v),proto=Object.getPrototypeOf(v);
      if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null) {error(path,'Expected plain JSON object or array');return;}
      if (ancestors.has(v)) {error(path,'Cyclic value');return;}
      if(array) {
        if(v.length>limits.maxArrayLength) {error(path,'Maximum array length exceeded');return;}
        // Inspect own indices, not iteration methods that silently skip holes.
        for(let i=0;i<v.length;i++)if(!Object.hasOwn(v,i)){error(path+'/'+i,'Sparse array: missing own element');return;}
      }
      ancestors.add(v);
      for (const k of Reflect.ownKeys(v)) {
        if(array&&k==='length')continue;
        if(typeof k!=='string'){error(path,'Symbol keys are not JSON data');continue;}
        const p=path+'/'+esc(k),descriptor=Object.getOwnPropertyDescriptor(v,k);
        if(array&&(!/^(0|[1-9]\d*)$/.test(k)||Number(k)>=v.length)){error(p,'Non-index array property is not JSON data');continue;}
        if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value')){error(p,'Expected enumerable JSON data property, not an accessor');continue;}
        if(k.length>limits.maxStringLength) error(p,'Maximum key length exceeded');
        walk(descriptor.value,p,depth+1);
        if(nodes>limits.maxNodes)break;
      }
      ancestors.delete(v);
    }
  }
  walk(value,'',0);
  // Do not read fields/accessors after the structural boundary has failed.
  if(errors.length)return {ok:false,errors};
  if (!object(value)) return {ok:false,errors:[...errors,{path:'',message:'Expected snapshot object'}]};
  if(value.format !== 'joons-mcp-diff/snapshot') error('/format','Expected joons-mcp-diff/snapshot');
  if(value.schemaVersion !== 1) error('/schemaVersion','Unsupported snapshot schemaVersion; only version 1 is supported (no automatic migration)');
  if(typeof value.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) error('/createdAt','Expected ISO-8601 timestamp');
  if(value.label !== null && typeof value.label !== 'string') error('/label','Expected string or null');
  for (const field of ['tool','server','stats']) if(!object(value[field])) error('/'+field,'Expected object');
  for (const [field,keys] of [['tool',['name','version']],['server',['name','version','protocolVersion']]]) if(object(value[field])) for(const k of keys) if(typeof value[field][k] !== 'string') error('/'+field+'/'+k,'Expected string');
  if(!Array.isArray(value.tools)) error('/tools','Expected array');
  else {
    if(value.tools.length>limits.maxTools) error('/tools','Maximum tool count exceeded');
    const names = new Set();
    value.tools.forEach((t,i)=>{
      const p='/tools/'+i;
      if(!object(t)) {error(p,'Expected tool object');return;}
      if(typeof t.name !== 'string' || !t.name.length) error(p+'/name','Expected nonempty string');
      else if(names.has(t.name)) error(p+'/name','Duplicate tool name'); else names.add(t.name);
      for(const k of ['title','description']) if(t[k] !== null && typeof t[k] !== 'string') error(p+'/'+k,'Expected string or null');
      if(!object(t.inputSchema)) error(p+'/inputSchema','Expected schema object');
      for(const k of ['outputSchema','annotations']) if(t[k] !== null && !object(t[k])) error(p+'/'+k,'Expected object or null');
    });
  }
  if(object(value.stats)) {
    for(const k of ['toolCount','pages']) if(!Number.isInteger(value.stats[k]) || value.stats[k]<0) error('/stats/'+k,'Expected nonnegative integer');
    if(Array.isArray(value.tools) && value.stats.toolCount !== value.tools.length) error('/stats/toolCount','Must equal tools length');
    if(value.stats.duplicateNames !== undefined && (!Array.isArray(value.stats.duplicateNames)||value.stats.duplicateNames.some(x=>typeof x!=='string'))) error('/stats/duplicateNames','Expected string array');
  }
  return {ok:errors.length===0,errors};
}
