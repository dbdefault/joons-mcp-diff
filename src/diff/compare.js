import {normalizeTool,canonicalJson} from '../model/normalize.js';
import {compareInputSchema} from './schema.js';
import {findRenameHints} from './rename.js';
import {validateSnapshot} from '../model/validate.js';
export class SnapshotValidationError extends TypeError {
  constructor(side, errors) {
    super(`Invalid ${side} snapshot: ${errors.map(e => `${e.path || '/'}: ${e.message}`).join('; ')}`);
    this.name = 'SnapshotValidationError';
    this.code = 'INVALID_SNAPSHOT';
    this.side = side;
    this.errors = errors;
  }
}
export function compareSnapshots(before,after,{all=false,renameHints=true}={}) {
  for (const [side, value] of [['before', before], ['after', after]]) {
    const result = validateSnapshot(value);
    if (!result.ok) throw new SnapshotValidationError(side, result.errors);
  }
  const a=new Map(before.tools.map(t=>[t.name,normalizeTool(t)])),b=new Map(after.tools.map(t=>[t.name,normalizeTool(t)]));
  const summary={added:0,removed:0,changed:0,unchanged:0,breaking:0,nonBreaking:0,unknown:0,risk:'none'};
  const tools=[],removed=[],added=[];
  for(const name of [...new Set([...a.keys(),...b.keys()])].sort()) {
    const x=a.get(name),y=b.get(name);let status,changes=[];
    const change=(kind,severity,before,after,path='')=>({kind,path,severity,message:kind==='annotations_changed'?'Annotations changed; advisory hints do not change input compatibility in v0.1':kind.replaceAll('_',' '),before:before??null,after:after??null});
    if(!x){status='added';added.push(y);changes=[change('tool_added','NON_BREAKING',null,y)];}
    else if(!y){status='removed';removed.push(x);changes=[change('tool_removed','BREAKING',x,null)];}
    else {
      changes=compareInputSchema(x.inputSchema,y.inputSchema);
      for(const k of ['title','description','annotations','outputSchema']) if(canonicalJson(x[k])!==canonicalJson(y[k])) changes.push(change({title:'title_changed',description:'description_changed',annotations:'annotations_changed',outputSchema:'output_schema_changed'}[k],k==='outputSchema'?'UNKNOWN':'NON_BREAKING',x[k],y[k],'/'+k));
      status=changes.length?'changed':'unchanged';
    }
    summary[status]++;
    for(const c of changes)summary[{BREAKING:'breaking',NON_BREAKING:'nonBreaking',UNKNOWN:'unknown'}[c.severity]]++;
    if(status!=='unchanged'||all)tools.push({name,status,changes});
  }
  summary.risk=summary.breaking?'high':summary.unknown?'unknown':summary.nonBreaking?'low':'none';
  const meta=s=>({label:s.label??null,server:{name:s.server.name,version:s.server.version,protocolVersion:s.server.protocolVersion},toolCount:s.tools.length});
  return {format:'joons-mcp-diff/result',schemaVersion:1,before:meta(before),after:meta(after),summary,tools,renameHints:renameHints?findRenameHints(removed,added):[]};
}
