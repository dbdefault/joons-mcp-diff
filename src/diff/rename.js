import {canonicalJson} from '../model/normalize.js';
export function nameSimilarity(a,b) {
  if(a===b)return 1;
  if(!a.length||!b.length)return 0;
  if(a.length>b.length)[a,b]=[b,a];
  let row=Array.from({length:a.length+1},(_,i)=>i);
  for(let j=1;j<=b.length;j++){const next=[j];for(let i=1;i<=a.length;i++)next[i]=Math.min(next[i-1]+1,row[i]+1,row[i-1]+(a[i-1]===b[j-1]?0:1));row=next;}
  return 1-row[a.length]/Math.max(a.length,b.length);
}
export function findRenameHints(removed,added) {
  const hints=[];
  const targets=added.map(t=>({tool:t,schema:canonicalJson(t.inputSchema)}));
  for(const old of [...removed].sort((a,b)=>a.name<b.name?-1:1)) {
    let best;const schema=canonicalJson(old.inputSchema);
    for(const {tool:next,schema:ns} of targets) {
      // Length upper bound avoids quadratic edit-distance work for impossible matches.
      const same=schema===ns;
      if(!same)continue; // Name contribution alone cannot reach 0.75.
      if(.6*Math.min(old.name.length,next.name.length)/Math.max(old.name.length,next.name.length)+.4<.75)continue;
      const similarity=.6*nameSimilarity(old.name,next.name)+.4;
      if(similarity>=.75&&(!best||similarity>best.similarity||similarity===best.similarity&&next.name<best.to))best={from:old.name,to:next.name,similarity,reason:'same input schema'};
    }
    if(best)hints.push(best);if(hints.length===50)break;
  }
  return hints;
}
export const renameHints = findRenameHints;
