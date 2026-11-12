# Security

Report vulnerabilities privately using GitHub's private vulnerability reporting on this repository's Security tab. Do not disclose exploit details in a public issue. Include reproduction steps, affected versions, and impact when possible.

## Threat model

MCP servers and their descriptions, schemas, names, errors, and output are untrusted. A server can return hostile text, oversized or deeply nested data, or echo secrets. Diff bounds collection, masks supplied secrets and encoded forms, neutralizes report text, and limits protocol methods to initialization, listing and ping. Stdio starts the command supplied by the user; the server process itself can have side effects and must be trusted appropriately. `--env` values are not secrets; labels are user supplied. These protections do not guarantee that an arbitrary server or its surrounding environment is safe.
