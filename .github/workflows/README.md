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
default local runner and `github-copilot` harness. The workflow intentionally
does not offer other harnesses: its single MCP secret belongs to
`copilot@astrid.cc`. Before triggering each task, it uses the OAuth API to assign
the task to that agent, which also makes previously unassigned Ready tasks
acceptable to the authenticated trigger endpoint. Assignment resolves the agent
through the Astrid Web To-do board ID already used by the shared `/fixall`
documentation; it does not require another secret.

### Credential rotation

Create or rotate the OAuth application through **Settings → API Access** while
signed in as the owner of the Astrid Web To-do. Use the `client_credentials`
grant and scopes `tasks:read`, `tasks:write`, `lists:read`, `comments:read`, and
`comments:write`. A newly created application keeps the old credentials valid
while both repositories are updated. Capture the one-time values without shell
history or plaintext files:

```bash
read -r -p "Client ID: " ASTRID_OAUTH_CLIENT_ID
read -r -s -p "Client secret: " ASTRID_OAUTH_CLIENT_SECRET
echo
for repo in Graceful-Tools/astrid-web Graceful-Tools/astrid-ios; do
  printf %s "$ASTRID_OAUTH_CLIENT_ID" |
    gh secret set ASTRID_OAUTH_CLIENT_ID --repo "$repo"
  printf %s "$ASTRID_OAUTH_CLIENT_SECRET" |
    gh secret set ASTRID_OAUTH_CLIENT_SECRET --repo "$repo"
done
unset ASTRID_OAUTH_CLIENT_ID ASTRID_OAUTH_CLIENT_SECRET
```

Rotate the MCP token only from `astrid-web`, where the schema and encryption
helpers live. The command never loads `.env.local`; name the already-exported
database variable explicitly. It validates the active `copilot@astrid.cc` user,
stores the new token hashed plus AES-256-GCM encrypted, streams it directly to
both repositories, and deactivates the agent's old tokens only after both writes
succeed. This is a full identity-token rotation: any other external consumer of
an old `copilot@astrid.cc` token must move to the new managed secret.

```bash
npm run credentials:rotate-fixall-mcp -- \
  --dry-run --database-url-env DATABASE_URL_DIRECT

npm run credentials:rotate-fixall-mcp -- \
  --apply --production --database-url-env DATABASE_URL_DIRECT
```

`DATABASE_URL_DIRECT` and, for `--apply`, `ENCRYPTION_KEY` must already be
exported in the invoking shell. Do not put either value on the command line.
The caller's `gh` session must be allowed to manage Actions secrets in both
repositories.
