# JOONS MCP Diff

Detect MCP tool and schema changes before they break your AI agents.

![Preview](https://img.shields.io/badge/status-Preview-orange) [![CI](https://github.com/dbdefault/joons-mcp-diff/actions/workflows/ci.yml/badge.svg)](https://github.com/dbdefault/joons-mcp-diff/actions/workflows/ci.yml) ![License](https://img.shields.io/badge/license-Apache--2.0-blue)

Part of the [JOONS ecosystem](https://github.com/dbdefault/joons-ecosystem). [JOONS MCP Probe](https://github.com/dbdefault/joons-mcp-probe) inspects the current state of one MCP server; Diff compares its contract at two points in time. Diff is independent and does not need Probe.

Agents depend on tool names and input schemas. A server update can invalidate calls that worked before; comparing snapshots exposes compatibility risks before those calls fail.

## Compatibility examples

| Severity | Example |
| --- | --- |
| BREAKING | A tool is removed. |
| BREAKING | An input property becomes required. |
| NON_BREAKING | A tool is added. |
| NON_BREAKING | An optional input property is added. |
| UNKNOWN | An output schema changes. |
| UNKNOWN | A changed `oneOf` cannot be classified safely. |

BREAKING means a previously valid call may now be rejected. UNKNOWN means the change cannot be classified safely; it does not mean safe. Rename hints are suggestions, never automatic renames.

## Install

Requires Node.js 20 or later.

```sh
npm install -g github:dbdefault/joons-mcp-diff#v0.1.0
```

From a clone:

```sh
git clone https://github.com/dbdefault/joons-mcp-diff.git
cd joons-mcp-diff
npm ci
node bin/joons-mcp-diff.js --help
```

## Quick start

From a clone, the included fixture servers make this example reproducible:

```sh
node bin/joons-mcp-diff.js snapshot stdio --label before -o before.json -- node test/fixtures/servers/v1-stdio.js
node bin/joons-mcp-diff.js snapshot stdio --label after -o after.json -- node test/fixtures/servers/v2-stdio.js
node bin/joons-mcp-diff.js compare before.json after.json --format terminal --fail-on none
node bin/joons-mcp-diff.js compare before.json after.json --format markdown --fail-on none
node bin/joons-mcp-diff.js compare before.json after.json --format json --fail-on none
node bin/joons-mcp-diff.js compare before.json after.json --fail-on breaking
```

The last command exits 1. Terminal excerpt:

```text
Risk: high | added 1, removed 1, changed 3, unchanged 0 | breaking 4, non-breaking 3, unknown 1
BREAKING create_item /properties/kind/enum: enum values removed
```

Markdown and JSON excerpts, respectively:

```text
# MCP Diff

Risk: high
```

```text
{
  "after": {
    "label": "after"
```

For an HTTP server, substitute its URL and set `TOKEN_ENV` to the complete header value:

```sh
joons-mcp-diff snapshot http https://example.com/mcp --header Authorization=TOKEN_ENV --label after -o after.json
```

The header value is read from the named environment variable. For stdio, pass additional non-secret environment variables with `--env NAME` and secrets with `--secret-env NAME`. Direct `.cmd` and `.bat` execution is refused; on Windows, `cmd.exe /d /s /c` is an explicit opt-in when a shell wrapper is required. Only use a command and arguments you trust.

`--fail-on` defaults to `breaking`; `unknown` fails for BREAKING or UNKNOWN, `any` for any change, and `none` never fails on changes. See the [CI example](examples/github-actions.md).

## CLI reference

`snapshot stdio [--env NAME] [--secret-env NAME] [--cwd DIR] [--label TEXT] [-o FILE] -- COMMAND [ARGS...]` and `snapshot http URL [--header NAME=ENVVAR] [--label TEXT] [-o FILE]` accept the limit and timeout flags named in the [API defaults](docs/API.md), in kebab case (for example `--max-tools 10000`). Repeated env and header flags are supported. Output defaults to stdout.

`compare BEFORE AFTER` accepts `--format terminal|markdown|json`, `--json-out FILE`, `--md-out FILE`, `--fail-on breaking|unknown|any|none`, `--all`, `--no-rename-hints`, `--quiet`, and `--color`. Color requires a TTY. `--help` and `--version` work on their own.

Observed threshold exit codes (columns in `--fail-on` order):

| Changes | breaking | unknown | any | none |
| --- | ---: | ---: | ---: | ---: |
| None | 0 | 0 | 0 | 0 |
| NON_BREAKING | 0 | 0 | 1 | 0 |
| UNKNOWN | 0 | 1 | 1 | 0 |
| BREAKING | 1 | 1 | 1 | 0 |

Observed error excerpts: missing input: `missing.json: cannot read snapshot` (2); batch refusal: `snapshot failed: spawn_failed (batch commands require explicit shell opt-in)` (3); invalid flag: `Invalid arguments. Use --help for usage.` (3); writing to a directory: `Output error` (4).

## Snapshot format

Version 1 is JSON with `format: "joons-mcp-diff/snapshot"`, `schemaVersion`, `createdAt`, `tool`, `label`, `server`, `tools`, and `stats`. Tools are sorted by name; schema object keys are recursively sorted. Identical server responses produce identical bytes apart from `createdAt`. Duplicate server tool names keep the first and are recorded in `stats.duplicateNames`; validation rejects duplicate names in an input snapshot. See [examples](examples/before.json).

Never stored: command, arguments, working directory, environment names or values, URL, headers, tokens, stderr, timings, or host names. A label is user-supplied text, so do not put secrets in it. Secret values and their URL-encoded and base64 forms are masked in untrusted text; `--env` values are not treated as secrets.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success or changes below the selected threshold |
| 1 | Changes at or above the threshold |
| 2 | Operational failure, unreadable or invalid snapshot |
| 3 | Usage error |
| 4 | Output error |

## Limits and safety

Snapshot defaults: 10,000 tools, 4 MiB per message, 32 MiB total, depth 64, 100,000 characters per string and 50 pages. Long string values are truncated with a marker; overlong object keys and other exceeded limits fail without a partial snapshot. Input snapshot files are limited to 64 MiB. Default step, total and close timeouts are 15, 60 and 3 seconds respectively.

Collection is read-only at the MCP protocol level: an allowlist permits only `initialize`, `notifications/initialized`, `tools/list`, and `ping`; it never invokes tools. Starting a server is still execution of the command you supply. Complex schemas and output schema changes can be UNKNOWN; Diff is a compatibility aid, not a guarantee of server behavior.

See [architecture](docs/ARCHITECTURE.md), [API](docs/API.md), [contributing](CONTRIBUTING.md), [security](SECURITY.md), [changelog](CHANGELOG.md), and [Korean README](README.ko.md).
