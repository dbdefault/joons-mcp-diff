export class SnapshotError extends Error {
  constructor(kind, message) { super(message); this.name = 'SnapshotError'; this.kind = kind; }
}
export const defaults = {maxTools:10000,maxMessageBytes:4194304,maxTotalBytes:33554432,maxDepth:64,maxStringLength:100000,maxPages:50,stepTimeoutMs:15000,totalTimeoutMs:60000,closeTimeoutMs:3000};
export function limits(options = {}) {
  const result = {...defaults};
  for (const key of Object.keys(result)) if (options[key] !== undefined) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 1) throw new SnapshotError('invalid_response', `Invalid ${key}`);
    result[key] = options[key];
  }
  return result;
}
export function sanitize(value, mask, opts) {
  const box = {}; const stack = [{value, parent:box,key:'root',depth:0}];
  while (stack.length) {
    const item = stack.pop(); const v = item.value;
    if (item.depth > opts.maxDepth) throw new SnapshotError('limit_exceeded','Maximum depth exceeded');
    if (typeof v === 'string') { const s = mask(v); const marker='[TRUNCATED]'.slice(0,opts.maxStringLength); item.parent[item.key] = s.length > opts.maxStringLength ? s.slice(0,opts.maxStringLength-marker.length)+marker : s; }
    else if (v && typeof v === 'object') {
      const out = Array.isArray(v) ? [] : Object.create(null); item.parent[item.key] = out;
      const entries = []; const seen = new Set();
      // Original code-unit order decides collisions independently of wire order.
      // Reject long keys rather than truncating schema property identities.
      for (const key of Object.keys(v).sort()) {
        const next = Array.isArray(v) ? key : mask(key);
        if (!Array.isArray(v) && (key.length > opts.maxStringLength || next.length > opts.maxStringLength)) throw new SnapshotError('limit_exceeded','Maximum key length exceeded');
        if(seen.has(next)) continue; seen.add(next); entries.push([next,v[key]]);
      }
      if (!Array.isArray(v)) entries.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
      for (const [key] of entries) out[key]=null;
      for (const [key,value] of entries) stack.push({value,parent:out,key,depth:item.depth+1});
    } else item.parent[item.key] = v;
  }
  return box.root;
}
