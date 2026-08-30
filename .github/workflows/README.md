# GitHub Actions workflows

## `/fixall`

`fixall.yml` runs every 30 minutes on the dedicated organization runner selected
by `[self-hosted, astrid-web]`. Manual dispatches may explicitly choose the
GitHub-hosted `cloud` backup; queued self-hosted jobs do not fail over
automatically.

The queue sweep requires repository secrets `ASTRID_OAUTH_CLIENT_ID` and
`ASTRID_OAUTH_CLIENT_SECRET`. Triggering each returned task through Astrid's
existing coding-agent endpoint additionally requires `ASTRID_MCP_TOKEN`. Secrets
are passed only through step environments and request headers and are never
printed.

Dry runs pass `--dry-run` to `scripts/ready-tasks.ts`, so they neither mutate
queue lanes nor trigger coding-agent workflows. Scheduled runs always use the
default local runner and `github-copilot` harness.
