import { parseArgs } from 'node:util';
const common = Object.fromEntries(['label','cwd','max-tools','max-message-bytes','max-total-bytes','max-depth','max-string-length','max-pages','step-timeout-ms','total-timeout-ms','close-timeout-ms'].map(x => [x,{type:'string'}]));
const camel = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
export function parse(argv, env = process.env) {
  if (argv.length === 1 && ['--help','--version'].includes(argv[0])) return {command:argv[0]};
  const command = argv[0], mode = argv[1];
  if (command === 'snapshot') {
    if (!['stdio','http'].includes(mode)) throw Error('Invalid snapshot transport');
    let args = argv.slice(2), child = [];
    if (mode === 'stdio') { const i = args.indexOf('--'); if (i < 0) throw Error('Missing command'); child = args.slice(i+1); args = args.slice(0,i); if (!child.length || !child[0]) throw Error('Missing command'); }
    const options = {...common, env:{type:'string',multiple:true}, 'secret-env':{type:'string',multiple:true}, header:{type:'string',multiple:true}, output:{type:'string',short:'o'}};
    const {values,positionals} = parseArgs({args,options,allowPositionals:true,strict:true});
    if (mode === 'http' ? positionals.length !== 1 : positionals.length !== 0) throw Error('Invalid target');
    if (mode === 'http' && (values.env || values['secret-env'] || values.cwd) || mode === 'stdio' && values.header) throw Error('Invalid transport option');
    const envValues = {}, secretEnv = {}, headers = {}, secrets = [];
    const namePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
    for (const [names, dest, secret] of [[values.env,envValues,false],[values['secret-env'],secretEnv,true]]) for (const n of names || []) { if (!namePattern.test(n) || !Object.hasOwn(env,n)) throw Error('Missing or invalid environment variable'); dest[n]=env[n]; if(secret && env[n]) secrets.push(env[n]); }
    for (const h of values.header || []) { const i=h.indexOf('='); const name=h.slice(0,i), key=h.slice(i+1); if(i<1 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || !namePattern.test(key) || !Object.hasOwn(env,key)) throw Error('Missing or invalid header environment variable'); headers[name]=env[key]; if(env[key]) secrets.push(env[key]); }
    if (mode === 'http') { let u; try {u=new URL(positionals[0]);} catch {throw Error('Invalid URL');} if (!['http:','https:'].includes(u.protocol)) throw Error('Invalid URL'); for(const x of [u.username,u.password,...u.searchParams.values()]) if(x) {secrets.push(x); try {secrets.push(decodeURIComponent(x));} catch {}} }
    const opts = {label:values.label ?? null, secrets};
    for(const [key,value] of Object.entries(values)) if (key in common && key !== 'label') { const k=camel(key); if(key === 'cwd') continue; else {const n=Number(value); if(!Number.isSafeInteger(n)||n<1) throw Error('Invalid limit'); opts[k]=n;} }
    return {command, target:mode === 'stdio' ? {transport:'stdio',command:child[0],args:child.slice(1),cwd:values.cwd,env:envValues,secretEnv} : {transport:'http',url:positionals[0],headers}, options:opts, output:values.output, secrets};
  }
  if (command === 'compare') { const {values,positionals}=parseArgs({args:argv.slice(1),allowPositionals:true,strict:true,options:{format:{type:'string'},'json-out':{type:'string'},'md-out':{type:'string'},'fail-on':{type:'string'},all:{type:'boolean'},'no-rename-hints':{type:'boolean'},quiet:{type:'boolean'},color:{type:'boolean'}}}); if(positionals.length!==2 || !['terminal','markdown','json'].includes(values.format ?? 'terminal') || !['breaking','unknown','any','none'].includes(values['fail-on'] ?? 'breaking')) throw Error('Invalid compare arguments'); return {command,files:positionals,format:values.format ?? 'terminal',jsonOut:values['json-out'],mdOut:values['md-out'],failOn:values['fail-on'] ?? 'breaking',all:!!values.all,renameHints:!values['no-rename-hints'],quiet:!!values.quiet,color:!!values.color}; }
  throw Error('Invalid command');
}
