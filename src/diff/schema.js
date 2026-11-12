import {canonicalJson} from '../model/normalize.js';
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const own = (x,k) => Object.hasOwn(x,k);
const esc = x => x.replace(/~/g,'~0').replace(/\//g,'~1');
const equal = (a,b) => a === undefined || b === undefined ? a === b : canonicalJson(a) === canonicalJson(b);
const complex = new Set(['$ref','$defs','definitions','oneOf','anyOf','allOf','not','if','then','else','dependentRequired','dependentSchemas','patternProperties','prerequisites']);
const docs = new Set(['title','description','examples','deprecated']);
const maps = new Set(['properties','patternProperties','$defs','definitions','dependentSchemas']);
const singles = new Set(['items','additionalProperties','not','if','then','else','contains','propertyNames','unevaluatedProperties','unevaluatedItems']);
const lists = new Set(['oneOf','anyOf','allOf','prefixItems']);
const set = values => [...new Map(values.map(x=>[canonicalJson(x),x])).entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,v])=>v);
// Only schema locations are traversed. Instance-valued annotations/const/enum are opaque.
function semantic(v, stripDocs=false) {
  if(!obj(v)) return v;
  return Object.fromEntries(Object.keys(v).filter(k=>!stripDocs||!docs.has(k)).map(k=>{
    let x=v[k];
    if(maps.has(k)&&obj(x)) x=Object.fromEntries(Object.entries(x).map(([n,s])=>[n,semantic(s,stripDocs)]));
    else if(singles.has(k)) x=Array.isArray(x)?x.map(s=>semantic(s,stripDocs)):semantic(x,stripDocs);
    else if(lists.has(k)&&Array.isArray(x)) x=x.map(s=>semantic(s,stripDocs));
    else if(['type','required','enum'].includes(k)&&Array.isArray(x)) x=set(x);
    return [k,x];
  }));
}
function identity(v,root,stack=new Set(),stripDocs=false) {
  if(Array.isArray(v)) return v.map(x=>identity(x,root,stack,stripDocs));
  if(!obj(v)) return v;
  v=semantic(v,stripDocs);
  if(own(v,'$ref')) {
    const ref=v.$ref;
    if(typeof ref!=='string'||!ref.startsWith('#/')) return semantic(v);
    if(stack.has(ref)) throw new Error('Reference cycle');
    let target=root;
    for(const part of ref.slice(2).split('/')) {const k=part.replace(/~1/g,'/').replace(/~0/g,'~');if(!obj(target)&&!Array.isArray(target)||!own(target,k)) throw new Error('Unresolved reference');target=target[k];}
    const next=new Set(stack);next.add(ref);
    return {resolved:identity(target,root,next,stripDocs),siblings:identity(Object.fromEntries(Object.entries(v).filter(([k])=>k!=='$ref')),root,next,stripDocs)};
  }
  return Object.fromEntries(Object.keys(v).map(k=>{
    const x=v[k];
    if(maps.has(k)&&obj(x)) return [k,Object.fromEntries(Object.entries(x).map(([n,s])=>[n,identity(s,root,stack,stripDocs)]))];
    if(singles.has(k)||lists.has(k))return [k,identity(x,root,stack,stripDocs)];
    return [k,x];
  }));
}
function interval(s, integer) {
  let lo=-Infinity, hi=Infinity, openLo=false, openHi=false;
  for(const k of ['minimum','exclusiveMinimum','maximum','exclusiveMaximum']) {
    const x=s[k];if(x===undefined)continue;
    if(typeof x!=='number'||!Number.isFinite(x))return null;
    if(k==='minimum'||k==='exclusiveMinimum') {if(x>lo){lo=x;openLo=k==='exclusiveMinimum';}else if(x===lo)openLo ||= k==='exclusiveMinimum';}
    else {if(x<hi){hi=x;openHi=k==='exclusiveMaximum';}else if(x===hi)openHi ||= k==='exclusiveMaximum';}
  }
  if(integer){
    if(Number.isFinite(lo)) {
      const rounded=openLo?Math.floor(lo):Math.ceil(lo),next=openLo?rounded+1:rounded;
      if(!Number.isSafeInteger(rounded)||!Number.isSafeInteger(next))return null;
      lo=next;
    }
    if(Number.isFinite(hi)) {
      const rounded=openHi?Math.ceil(hi):Math.floor(hi),next=openHi?rounded-1:rounded;
      if(!Number.isSafeInteger(rounded)||!Number.isSafeInteger(next))return null;
      hi=next;
    }
    openLo=openHi=false;
  }
  return {lo,hi,openLo,openHi,empty:lo>hi||lo===hi&&(openLo||openHi)};
}
const valueType = v => v===null?'null':Array.isArray(v)?'array':typeof v==='number'&&Number.isInteger(v)?'integer':typeof v;
const permits = (s,t) => s.type===undefined || (Array.isArray(s.type)?s.type:[s.type]).some(x=>x===t||x==='number'&&t==='integer');
const numeric = s => permits(s,'number')||permits(s,'integer');
function allowedValues(s) {
  if(own(s,'enum')&&!Array.isArray(s.enum))return undefined;
  let values=own(s,'const')?[s.const]:s.enum;
  if(values===undefined)return undefined;
  if(own(s,'const')&&own(s,'enum'))values=values.filter(x=>s.enum.some(y=>equal(x,y)));
  return set(values);
}
// A deliberately small exact evaluator used only to discharge finite-domain redundancy.
function finiteDomain(s) {
  const values=allowedValues(s);if(values===undefined)return undefined;
  const supported=new Set(['const','enum','type','minimum','maximum','exclusiveMinimum','exclusiveMaximum','minLength','maxLength','minItems','maxItems','uniqueItems',...docs]);
  if(Object.keys(s).some(k=>!supported.has(k)))return undefined;
  if(['minLength','maxLength','minItems','maxItems'].some(k=>own(s,k)&&(!Number.isInteger(s[k])||s[k]<0)))return undefined;
  if(own(s,'uniqueItems')&&typeof s.uniqueItems!=='boolean')return undefined;
  const bounds=interval(s,false);if(!bounds)return undefined;
  return values.filter(v=>{
    if(!permits(s,valueType(v)))return false;
    if(Array.isArray(v)&&s.uniqueItems&&set(v).length!==v.length)return false;
    if(typeof v==='number'&&(v<bounds.lo||v>bounds.hi||v===bounds.lo&&bounds.openLo||v===bounds.hi&&bounds.openHi))return false;
    const len=typeof v==='string'?[...v].length:Array.isArray(v)?v.length:null;
    const min=typeof v==='string'?s.minLength:s.minItems,max=typeof v==='string'?s.maxLength:s.maxItems;
    return len===null || !((min!==undefined&&len<min)||(max!==undefined&&len>max));
  });
}
export function compareInputSchema(before,after) {
  const changes=[];
  const add=(kind,path,severity,a,b,message=kind.replaceAll('_',' '))=>changes.push({kind,path,severity,message,before:a??null,after:b??null});
  function documentChanges(a,b,path) {
    if(!obj(a)||!obj(b))return;
    for(const k of [...new Set([...Object.keys(a),...Object.keys(b)])].sort()) {
      const p=path+'/'+esc(k),x=a[k],y=b[k];
      if(docs.has(k)&&!equal(x,y))add(k+'_changed',p,'NON_BREAKING',x,y);
      else if(maps.has(k)&&obj(x)&&obj(y)) {for(const n of Object.keys(x).sort())if(own(y,n))documentChanges(x[n],y[n],p+'/'+esc(n));}
      else if(singles.has(k)&&obj(x)&&obj(y))documentChanges(x,y,p);
      else if((lists.has(k)||k==='items')&&Array.isArray(x)&&Array.isArray(y))x.forEach((s,i)=>documentChanges(s,y[i],p+'/'+i));
    }
  }
  function visit(a,b,path) {
    if(!obj(a)||!obj(b)) {add('schema_invalid',path,'UNKNOWN',a,b);return;}
    const handled=new Set(['properties','required','type','enum','const','additionalProperties','items']);
    for(const k of complex) {
      handled.add(k);
      if(!own(a,k)&&!own(b,k)) continue;
      let same=false;
      try {
        // Resolve references even when their spelling is unchanged: targets can change.
        const av=identity({[k]:a[k]},before),bv=identity({[k]:b[k]},after);
        same=own(a,k)===own(b,k)&&equal(av,bv);
        if(!same&&own(a,k)&&own(b,k)&&equal(identity({[k]:a[k]},before,new Set(),true),identity({[k]:b[k]},after,new Set(),true))) {
          same=true;documentChanges({[k]:a[k]},{[k]:b[k]},path);
        }
      } catch {same=false;}
      if(!same) add('complex_schema_changed',path+'/'+esc(k),'UNKNOWN',a[k],b[k]);
    }
    for(const s of [a,b]) {
      const validType=t=>typeof t==='string'&&['null','boolean','object','array','number','integer','string'].includes(t);
      if(own(s,'required')&&(!Array.isArray(s.required)||s.required.some(x=>typeof x!=='string')) || own(s,'properties')&&!obj(s.properties) || own(s,'type')&&!(validType(s.type)||Array.isArray(s.type)&&s.type.length&&s.type.every(validType)) || own(s,'enum')&&!Array.isArray(s.enum)) {add('schema_invalid',path,'UNKNOWN',a,b);return;}
    }
    const ar=new Set(a.required??[]), br=new Set(b.required??[]);
    for(const x of [...br].sort()) if(!ar.has(x)) add('required_added',path+'/required/'+esc(x),'BREAKING',null,x);
    for(const x of [...ar].sort()) if(!br.has(x)) add('required_removed',path+'/required/'+esc(x),'NON_BREAKING',x,null);
    const ap=obj(a.properties)?a.properties:{}, bp=obj(b.properties)?b.properties:{};
    for(const k of [...new Set([...Object.keys(ap),...Object.keys(bp)])].sort()) {
      const p=path+'/properties/'+esc(k);
      if(!own(ap,k)) {
        const noPatterns=!own(a,'patternProperties')&&!own(b,'patternProperties');
        if(bp[k]===false&&a.additionalProperties===false&&noPatterns)continue;
        const unconstrained=bp[k]===true||obj(bp[k])&&Object.keys(bp[k]).every(key=>docs.has(key));
        const safe=noPatterns&&(a.additionalProperties===false||unconstrained);
        add('property_added',p,safe?'NON_BREAKING':'UNKNOWN',null,bp[k],safe?'Optional property does not narrow previously allowed values':'New named constraints may reject values previously allowed as additional properties; inclusion is unproved');
      }
      else if(!own(bp,k)) {
        const domain=obj(ap[k])?finiteDomain(ap[k]):undefined;
        const forbidden=ap[k]===false||domain?.length===0||obj(ap[k])&&allowedValues(ap[k])?.length===0;
        if(forbidden&&b.additionalProperties===false&&!own(b,'patternProperties'))continue;
        const simple=ap[k]===true||obj(ap[k])&&Object.keys(ap[k]).every(key=>docs.has(key)||key==='type');
        const knownInhabited=simple||domain?.length>0;
        add('property_removed',p,b.additionalProperties===false&&knownInhabited?'BREAKING':'UNKNOWN',ap[k],null);
      }
      else if(typeof ap[k]==='boolean'&&ap[k]===bp[k])continue;
      else visit(ap[k],bp[k],p);
    }
    function types(x) {if(x===undefined)return null;const s=new Set(Array.isArray(x)?x:[x]);if(s.has('number'))s.add('integer');return s;}
    const at=types(a.type),bt=types(b.type);
    const af=finiteDomain(a),bf=finiteDomain(b),finiteCompared=af!==undefined&&bf!==undefined;
    if(!finiteCompared&&!equal(a.type,b.type)) {
      const subset=(s,t)=>[...s].every(x=>t.has(x));
      let sev=!bt?'NON_BREAKING':!at?'BREAKING':subset(at,bt)?'NON_BREAKING':subset(bt,at)||![...at].some(x=>bt.has(x))?'BREAKING':'UNKNOWN';
      // A local type narrowing is not a witness when other constraints can make
      // its excluded values impossible. Exact finite domains were handled above.
      if(sev==='BREAKING'&&[a,b].some(s=>Object.keys(s).some(k=>!docs.has(k)&&k!=='type')))sev='UNKNOWN';
      if(!at||!bt||!subset(at,bt)||!subset(bt,at)) add('type_changed',path+'/type',sev,a.type,b.type);
    }
    // Never compare an exact filtered set against an unfiltered upper bound.
    const ae=finiteCompared?af:allowedValues(a),be=finiteCompared?bf:allowedValues(b);
    const residual=s=>Object.fromEntries(Object.entries(s).filter(([k])=>k!=='const'&&k!=='enum'&&!docs.has(k)));
    const residualSame=equal(residual(a),residual(b));
    const enumPath=path+'/'+(!equal(a.const,b.const)&& (own(a,'const')||own(b,'const'))?'const':own(a,'enum')||own(b,'enum')?'enum':'const');
    if(!equal(ae,be)) {
      const diff=(x,y)=>x.filter(v=>!y.some(w=>equal(v,w)));
      const removed=ae&&be?diff(ae,be):be;
      const added=ae&&be?diff(be,ae):ae;
      const removedSeverity=finiteCompared||Object.keys(residual(a)).length===0||af!==undefined&&be!==undefined&&af.some(v=>!be.some(w=>equal(v,w)))?'BREAKING':'UNKNOWN';
      const addedSeverity=finiteCompared||residualSame?'NON_BREAKING':'UNKNOWN';
      if(be===undefined) add('enum_values_added',enumPath,addedSeverity,ae,null);
      else if(ae===undefined) add('enum_values_removed',enumPath,removedSeverity,null,be);
      else {if(removed.length)add('enum_values_removed',enumPath,removedSeverity,removed,[]);if(added.length)add('enum_values_added',enumPath,addedSeverity,[],added);}
    }
    const aa=a.additionalProperties??true,ba=b.additionalProperties??true;
    if(!equal(aa,ba)) {
      let docOnly=false;
      try {docOnly=obj(aa)&&obj(ba)&&equal(identity({additionalProperties:aa},before,new Set(),true),identity({additionalProperties:ba},after,new Set(),true));}catch { /* unknown references */ }
      if(docOnly)documentChanges({additionalProperties:aa},{additionalProperties:ba},path);
      else add('additional_properties',path+'/additionalProperties',obj(aa)||obj(ba)?'UNKNOWN':ba===false?'BREAKING':'NON_BREAKING',aa,ba);
    }
    if(own(a,'items')||own(b,'items')) {
      if(!equal(semantic(a.items),semantic(b.items))) {
        let docOnly=false;
        try {docOnly=own(a,'items')&&own(b,'items')&&equal(identity({items:a.items},before,new Set(),true),identity({items:b.items},after,new Set(),true));}catch { /* unresolved references remain conservative */ }
        if(docOnly)documentChanges({items:a.items},{items:b.items},path);
        else visit(a.items??{},b.items??{},path+'/items');
      }
    }
    const numericKeys=['minimum','maximum','exclusiveMinimum','exclusiveMaximum'];
    numericKeys.forEach(k=>handled.add(k));
    if(!finiteCompared&&(numeric(a)||numeric(b))) {
      const integer=!permits(a,'number')&&!permits(b,'number');
      const ai=interval(a,integer),bi=interval(b,integer);
      const changed=numericKeys.filter(k=>!equal(a[k],b[k]));
      if(changed.length) {
        if(!ai||!bi) add('constraint_changed',path+'/'+changed[0],'UNKNOWN',a[changed[0]],b[changed[0]],'Numeric bounds cannot be normalized exactly (unsafe integer arithmetic or unsupported bounds)');
        else if(!(ai.empty&&bi.empty)) {
          for(const side of ['lo','hi']) {
            const open=side==='lo'?'openLo':'openHi';
            if(ai[side]===bi[side]&&ai[open]===bi[open])continue;
            const tightened=bi.empty||!ai.empty&&(side==='lo'?bi.lo>ai.lo||bi.lo===ai.lo&&bi.openLo&&!ai.openLo:bi.hi<ai.hi||bi.hi===ai.hi&&bi.openHi&&!ai.openHi);
            const k=changed.find(k=>side==='lo'?k==='minimum'||k==='exclusiveMinimum':k==='maximum'||k==='exclusiveMaximum');
            const interacting=!equal(a.type,b.type)||[a,b].some(s=>Object.keys(s).some(k=>!docs.has(k)&&k!=='type'&&!numericKeys.includes(k)));
            if(k)add('constraint_changed',path+'/'+k,tightened?(interacting?'UNKNOWN':'BREAKING'):'NON_BREAKING',a[k],b[k],'Combined numeric interval '+(tightened?'tightened':'loosened'));
          }
        }
      }
    }
    for(const [min,max,type] of [['minLength','maxLength','string'],['minItems','maxItems','array']]) {
      handled.add(min);handled.add(max);
      if(finiteCompared||!permits(a,type)&&!permits(b,type))continue;
      const keys=[min,max],changed=keys.filter(k=>!equal(a[k],b[k]));if(!changed.length)continue;
      const valid=[a,b].every(s=>keys.every(k=>!own(s,k)||Number.isInteger(s[k])&&s[k]>=0));
      if(!valid){add('constraint_changed',path+'/'+changed[0],'UNKNOWN',a[changed[0]],b[changed[0]]);continue;}
      const al=a[min]??0,bl=b[min]??0,ah=a[max]??Infinity,bh=b[max]??Infinity;
      if(al>ah&&bl>bh)continue;
      for(const k of changed) {
        const x=k===min?al:ah,y=k===min?bl:bh;if(x===y)continue;
        const tightened=bl>bh||!(al>ah)&&(k===min?y>x:y<x);
        const interacting=!equal(a.type,b.type)||[a,b].some(s=>Object.keys(s).some(key=>!docs.has(key)&&key!=='type'&&!keys.includes(key)));
        add('constraint_changed',path+'/'+k,tightened?(interacting?'UNKNOWN':'BREAKING'):'NON_BREAKING',a[k],b[k]);
      }
    }
    for(const k of ['multipleOf','pattern','format','uniqueItems']) {
      handled.add(k);if(equal(a[k],b[k]))continue;
      if(finiteCompared&&k==='uniqueItems')continue;
      const applies=k.includes('Length')||k==='pattern'||k==='format'?'string':k.includes('Items')?'array':null;
      if(applies&&!permits(a,applies)&&!permits(b,applies))continue;
      let severity;
      if(['multipleOf','pattern','format'].includes(k)) severity='UNKNOWN';
      else if(k==='uniqueItems') {
        if((a[k]??false)===(b[k]??false))continue;
        severity=[a[k],b[k]].some(x=>x!==undefined&&typeof x!=='boolean')?'UNKNOWN':(b[k]??false)?'BREAKING':'NON_BREAKING';
        if(severity==='BREAKING'&&Object.keys(a).some(key=>key!=='type'&&key!=='uniqueItems'&&!docs.has(key)))severity='UNKNOWN';
      }
      else if([a[k],b[k]].some(x=>x!==undefined&&(typeof x!=='number'||!Number.isFinite(x)))) severity='UNKNOWN';
      else severity=b[k]===undefined?'NON_BREAKING':a[k]===undefined?'BREAKING':(k.startsWith('min')||k==='exclusiveMinimum'?b[k]>a[k]:b[k]<a[k])?'BREAKING':'NON_BREAKING';
      add('constraint_changed',path+'/'+k,severity,a[k],b[k]);
    }
    for(const k of [...new Set([...Object.keys(a),...Object.keys(b)])].sort()) if(!handled.has(k)&&!equal(a[k],b[k])) {
      let docOnly=false;
      if((singles.has(k)||lists.has(k)||maps.has(k))&&own(a,k)&&own(b,k)) {
        try {docOnly=equal(identity({[k]:a[k]},before,new Set(),true),identity({[k]:b[k]},after,new Set(),true));}catch { /* unknown */ }
      }
      if(docOnly)documentChanges({[k]:a[k]},{[k]:b[k]},path);
      else add(docs.has(k)?k+'_changed':'keyword_changed',path+'/'+esc(k),docs.has(k)?'NON_BREAKING':'UNKNOWN',a[k],b[k]);
    }
  }
  visit(before,after,'');return changes;
}
