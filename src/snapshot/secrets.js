import {SnapshotError} from './bounds.js';

// URL/form decoding retains source spans for literal matching. No secret is
// ever compiled as a regular expression, including encoded variants.
function decodedView(text) {
  const parts=[], starts=[], ends=[];
  for(let i=0;i<text.length;) {
    const start=i;let char=text[i];let end=i+1;
    if(char==='%') {
      const first=Number.parseInt(text.slice(i+1,i+3),16);
      const bytes=first>=0xf0?4:first>=0xe0?3:first>=0xc0?2:1;
      const candidate=text.slice(i,i+bytes*3);
      if(candidate.length===bytes*3) try {char=decodeURIComponent(candidate);end=i+bytes*3;} catch {}
    } else if(char==='+') char=' ';
    parts.push(char);
    for(let j=0;j<char.length;j++){starts.push(start);ends.push(end);}
    i=end;
  }
  return {text:parts.join(''),starts,ends};
}

export function createMasker(target = {}, extra = []) {
  try {
    const values=[...Object.values(target.secretEnv ?? {}),...Object.values(target.headers ?? {}),...(Array.isArray(extra)?extra:Object.values(extra ?? {}))];
    if(target.url) {
      const url=new URL(target.url);
      values.push(decodeURIComponent(url.username),decodeURIComponent(url.password),...url.searchParams.values());
    }
    const forms=new Set();
    for(const value of values) {
      if(typeof value!=='string' || !value.length)continue;
      forms.add(value);
      for(const source of [value,`Bearer ${value}`,`user:${value}`]) {
        const base64=Buffer.from(source).toString('base64');
        const unpadded=base64.replace(/=+$/,'');
        forms.add(base64);forms.add(unpadded);
        forms.add(base64.replace(/\+/g,'-').replace(/\//g,'_'));
        forms.add(unpadded.replace(/\+/g,'-').replace(/\//g,'_'));
      }
    }
    const literals=[...forms].sort((a,b)=>b.length-a.length);
    return value=>{
      try {
        const text=String(value);if(!literals.length)return text;
        const ranges=[];
        const search=(view,starts,ends)=>{
          for(const literal of literals) {
            for(let at=view.indexOf(literal);at!==-1;at=view.indexOf(literal,at+literal.length))
              ranges.push([starts?starts[at]:at,ends?ends[at+literal.length-1]:at+literal.length]);
          }
        };
        search(text);
        if(text.includes('%') || text.includes('+')){const view=decodedView(text);search(view.text,view.starts,view.ends);}
        ranges.sort((a,b)=>a[0]-b[0] || b[1]-a[1]);
        const result=[];let cursor=0;
        for(let i=0;i<ranges.length;i++) {
          const [start,initialEnd]=ranges[i];let end=initialEnd;
          if(start<cursor)continue;
          while(i+1<ranges.length && ranges[i+1][0]<end){end=Math.max(end,ranges[++i][1]);}
          result.push(text.slice(cursor,start),'[REDACTED]');cursor=end;
        }
        result.push(text.slice(cursor));return result.join('');
      } catch {throw new SnapshotError('invalid_response','Unable to mask text');}
    };
  } catch {throw new SnapshotError('invalid_response','Invalid secret configuration');}
}
