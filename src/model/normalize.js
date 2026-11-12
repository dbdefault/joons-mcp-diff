import {createHash} from 'node:crypto';
export function stableHash(value) { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
// Canonical JSON uses code-unit key ordering, including integer-looking keys.
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  const text = JSON.stringify(value);
  if (text === undefined) throw new TypeError('Expected a JSON value');
  return text;
}
export const canonicalJSON = canonicalJson;
export const canonicalStringify = canonicalJson;
export const stableStringify = canonicalJson;
export function canonicalize(value) { return JSON.parse(canonicalJson(value)); }
export function normalizeTool(tool) {
  return canonicalize({name: tool.name, title: tool.title ?? null, description: tool.description ?? null,
    inputSchema: Object.hasOwn(tool,'inputSchema') ? tool.inputSchema : {}, outputSchema: tool.outputSchema ?? null, annotations: tool.annotations ?? null});
}
export function normalizeSnapshot(snapshot) {
  const seen = new Set(), duplicates = new Set(), tools = [];
  for (const tool of snapshot.tools ?? []) {
    if (seen.has(tool.name)) { duplicates.add(tool.name); continue; }
    seen.add(tool.name); tools.push(normalizeTool(tool));
  }
  tools.sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const stats = {...snapshot.stats, toolCount: tools.length};
  const names = [...new Set([...(stats.duplicateNames ?? []), ...duplicates])].sort();
  if (names.length) stats.duplicateNames = names;
  return canonicalize({format: snapshot.format ?? 'joons-mcp-diff/snapshot', schemaVersion: snapshot.schemaVersion ?? 1,
    createdAt: snapshot.createdAt, tool: snapshot.tool ?? {name:'joons-mcp-diff',version:'0.1.0'},
    label: snapshot.label ?? null, server: snapshot.server, tools, stats});
}
