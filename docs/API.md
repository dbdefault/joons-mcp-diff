# Library API

Node.js 20+ and ESM are required. The package root exports `VERSION`, `main`, `takeSnapshot`, `SnapshotError`, `compareSnapshots`, `validateSnapshot`, `renderJSON` (also `renderJson`), `renderMarkdown`, `renderTerminal`, and `normalizeSnapshot`. `main` is the CLI entry point; its extra arguments are implementation hooks for testing.

## Collection

`await takeSnapshot(target, options = {})` returns a snapshot or throws. Targets are:

```js
{ transport: 'stdio', command: 'node', args: ['server.js'], cwd: undefined,
  env: {}, secretEnv: {} }
{ transport: 'http', url: 'https://example.com/mcp', headers: {} }
```

`args` defaults to `[]`; `cwd` defaults to the current directory. `env` and `secretEnv` map environment names to values, added to the minimal inherited environment; values in `secretEnv` are masked. HTTP `headers` maps header names to values, all treated as secrets. URL userinfo and query values are secret. For library callers, these are values, not environment variable names.

Options: `label` defaults to `null`; `extraSecrets` is an array or object of additional secret values, default `[]`; `secrets` is an alias used when `extraSecrets` is absent. Limits and timeouts must be positive safe integers:

| Option | Default | Unit |
| --- | ---: | --- |
| `maxTools` | 10000 | tools |
| `maxMessageBytes` | 4194304 | bytes |
| `maxTotalBytes` | 33554432 | bytes |
| `maxDepth` | 64 | levels |
| `maxStringLength` | 100000 | characters |
| `maxPages` | 50 | pages |
| `stepTimeoutMs` | 15000 | milliseconds |
| `totalTimeoutMs` | 60000 | milliseconds |
| `closeTimeoutMs` | 3000 | milliseconds |

`SnapshotError` extends `Error`, with `name`, `kind`, and `message`. Kinds are `spawn_failed`, `connection_refused`, `handshake_failed`, `protocol_mismatch`, `invalid_response`, `timeout`, `process_exited`, `auth_failed`, `limit_exceeded`, and `unknown`. Batch refusal also carries `exitCode: 3`. Collection errors are redacted; invalid options or target setup can throw before collection starts.

## Processing and results

`normalizeSnapshot(snapshot)` returns a canonicalized snapshot with sorted tools, deduplicated names and updated statistics. `validateSnapshot(snapshot)` returns `{ok, errors}` where errors contain `path` and `message`. `compareSnapshots(before, after, options)` validates both inputs itself and throws `SnapshotValidationError` (exported, with `side` and `errors`) when either is invalid, including an unsupported future `schemaVersion`. Version 1 snapshots have `format`, `schemaVersion`, `createdAt`, `tool`, `label`, `server`, `tools`, and `stats`; examples are in [before.json](../examples/before.json) and [after.json](../examples/after.json).

`compareSnapshots(before, after, {all = false, renameHints = true} = {})` returns `{format, schemaVersion, before, after, summary, tools, renameHints}`. Summary has `added`, `removed`, `changed`, `unchanged`, `breaking`, `nonBreaking`, `unknown`, and `risk`; severity counts count changes, not tools. Each tool has `name`, `status`, and `changes`; each change has `kind`, `path`, `severity`, `message`, `before`, and `after`. A rename hint has `from`, `to`, `similarity`, and `reason`. Set `all` to include unchanged tools.

`renderJSON(value)` / `renderJson(value)`, `renderMarkdown(result)`, and `renderTerminal(result, {color = false} = {})` return strings. Terminal color is enabled by the option directly; the CLI additionally requires a TTY.

## Runnable examples

From a repository clone after dependencies are installed, run each block with `node --input-type=module`. The fixture paths below exist in the repository, not in the published package.

```js
import { takeSnapshot, validateSnapshot } from './src/index.js';
const snapshot = await takeSnapshot({
  transport: 'stdio', command: process.execPath,
  args: ['test/fixtures/servers/v1-stdio.js']
}, { label: 'before' });
console.log(validateSnapshot(snapshot));
```

```js
import { takeSnapshot, normalizeSnapshot, validateSnapshot } from './src/index.js';
const snapshot = await takeSnapshot({
  transport: 'stdio', command: process.execPath,
  args: ['test/fixtures/servers/v2-stdio.js']
});
console.log(validateSnapshot(normalizeSnapshot(snapshot)));
```

```js
import { takeSnapshot, compareSnapshots, renderJSON, renderMarkdown, renderTerminal } from './src/index.js';
const snapshot = async version => takeSnapshot({
  transport: 'stdio', command: process.execPath,
  args: [`test/fixtures/servers/${version}-stdio.js`]
});
const result = compareSnapshots(await snapshot('v1'), await snapshot('v2'));
console.log(renderTerminal(result));
console.log(renderMarkdown(result));
console.log(renderJSON(result));
```
