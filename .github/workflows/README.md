# GitHub Actions workflows

## `/fixall`

`fixall.yml` runs every 30 minutes on the dedicated organization runner selected
by `[self-hosted, astrid-web]`. Manual dispatches may explicitly choose the
GitHub-hosted `cloud` backup; queued self-hosted jobs do not fail over
automatically.

The queue sweep and trigger require repository secrets
`ASTRID_OAUTH_CLIENT_ID` and `ASTRID_OAUTH_CLIENT_SECRET`. The workflow uses the
same external OAuth client throughout; Astrid derives `copilot@astrid.cc`
server-side after the atomic claim instead of requiring a legacy agent MCP
token. Secrets are passed only through step environments and request headers
and are never printed.

Dry runs pass `--dry-run` to `scripts/ready-tasks.ts`, so they neither mutate
queue lanes nor trigger coding-agent workflows. Scheduled runs always use the
default local runner and `github-copilot` harness. The workflow intentionally
does not offer other harnesses. Before triggering each task, it uses the OAuth
API to assign the task to `copilot@astrid.cc`, which also makes previously
unassigned Ready tasks acceptable to the authenticated trigger endpoint. The
endpoint only derives that fixed identity from an active AI-agent assignment;
the OAuth caller cannot choose an arbitrary comment author. Assignment resolves
the agent through the Astrid Web To-do board ID already used by the shared
`/fixall` documentation.

Automation reads the queue through the script's JSON mode, never its
human-readable titles:

```bash
npx tsx scripts/ready-tasks.ts web --json --harness github-copilot [--dry-run]
```

Standard output is one versioned envelope; diagnostics stay on standard error:

```json
{
  "version": 1,
  "tasks": [
    { "id": "<uuid>", "action": "ready" },
    {
      "id": "<uuid>",
      "action": "recheck|review",
      "commentWatermark": "<ISO timestamp|null>"
    }
  ]
}
```

Only IDs classified in memory by `ready-tasks.ts` are serialized. Titles and
other presentation fields are deliberately absent, so multiline task content
cannot add executable queue entries. Before execution, `claim-fixall-task.ts`
posts each structured claim to the authenticated atomic claim endpoint. One
conditional update verifies the task is still incomplete, on the web board, in
the expected status/due state, unchanged since the waiting-task comment
watermark, and either unassigned or already assigned to Copilot. A conflict
prints `CLAIM_CONFLICT` and exits 2 without changing the task; success prints
`CLAIMED` and exits 0.

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
Concurrent rotations are serialized by a PostgreSQL session advisory lock held
across durable activation, both GitHub writes, and retirement. If propagation,
retirement, or the lock-holding transaction fails, a fresh transaction ensures
the staged token remains active before the command exits.

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
