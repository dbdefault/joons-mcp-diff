# MCP test fixtures

Each server is a standalone Node script under `servers/`. The stdio fixtures accept newline-delimited JSON-RPC on standard input. The HTTP fixtures announce their ephemeral loopback port with `LISTENING <port>` and accept Streamable HTTP JSON responses. Set `FIXTURE_TOKEN` to require a bearer token.

`many-tools` accepts a count, `deep-schema` a depth, and `slow-start` a delay in milliseconds. `spawns-child` accepts an output file for the grandchild PID; `tripwire` accepts an output file for unexpected methods. `echo-secret` reads `FIXTURE_SECRET`. `paginated` has three pages and `cursor-loop` repeats its cursor. `early-exit`, `garbage`, and `handshake-error` deliberately fail.

`run-http.js` exports `startHttpFixture(script, env)` and `getClosedPort()`. Tests must close the server returned by the helper and clean up their own files and processes.
