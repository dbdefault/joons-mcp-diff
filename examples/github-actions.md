# Compare a baseline in GitHub Actions

Capture and review a snapshot from a trusted server, then commit it as `baseline.json`. Capture a candidate snapshot from the server version under test in CI and compare it against the committed baseline. Update the baseline deliberately after reviewing intended changes; do not put credentials in labels or files.

This complete example runs in a clone of this repository. It compares the committed example baseline with the v1 fixture; replace the fixture with your server and the baseline with your reviewed snapshot.

```yaml
name: Compare MCP contract
on: pull_request
permissions:
  contents: read
jobs:
  compare:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - name: Capture candidate
        run: node bin/joons-mcp-diff.js snapshot stdio -o candidate.json -- node test/fixtures/servers/v1-stdio.js
      - name: Reject breaking changes
        run: node bin/joons-mcp-diff.js compare examples/before.json candidate.json --format markdown --fail-on breaking
```

Replace the fixture command with your server's trusted startup command. A breaking change exits 1; operational, usage and output errors exit 2, 3 and 4. Use `--fail-on unknown` to reject UNKNOWN changes as well.
