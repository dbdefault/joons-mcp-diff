import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const files = readdirSync('test').filter(x => x.endsWith('.test.js')).sort().map(x => join('test',x));
const result = spawnSync(process.execPath, ['--test', ...files], {stdio:'inherit', windowsHide:true});
if (result.error) { console.error('Unable to start tests'); process.exitCode=1; } else process.exitCode = result.status ?? 1;
