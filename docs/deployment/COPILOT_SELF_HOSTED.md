# GitHub Copilot against a self-hosted instance

How a third party gets GitHub Copilot working the task queue on their **own** deployment,
branded or not. Task [ADEV-101](https://astrid.cc/t/ADEV-101).

The same steps are in the product: **Settings → AI Agents → Copilot** (`/settings/agents`),
`/docs/loops` and `/start` (plain-markdown copy for agents: `/start.md`). Those pages
build their commands from `lib/agent-skill/loop-recipes.ts` for the origin you opened them
on, so prefer copying from there. This page explains what they assume of the deployment.
The fleet docs (`AGENT_FLEET.md`, `FIXALL_WORKFLOW.md`, `.github/workflows/README.md`)
describe Astrid's own agents and repositories. They are not a setup guide for yours.

Running the server itself is [SELF_HOSTING.md](./SELF_HOSTING.md). Branding is
[WHITELABELING.md](../WHITELABELING.md).

Below, **`<origin>`** is your public URL (e.g. `https://tasks.example.com`) and
**`<WORDMARK>`** is your brand's wordmark in secret-name form. See step 3.

---

## Which Copilot setup

| Setup | Signs in | Runs unattended | Notes |
|---|---|---|---|
| **VS Code**, stock, with `.vscode/mcp.json` | Browser OAuth | No | **Recommended.** No token to store or rotate |
| Copilot CLI, local | Browser OAuth (`copilot mcp add`) | With your own cron | A machine has to stay on |
| Copilot CLI in **GitHub Actions** (generated workflow) | Agent-bound token | Event wake, every 30 min, or a manual run | Steps 3–5 |
| Copilot cloud agent on GitHub.com | Agent-bound token | No; assign it work on GitHub | GitHub cannot open browser OAuth |

Every setup connects to the same remote MCP endpoint, `<origin>/mcp`, and registers it
under the lowercased wordmark (`mcpServerName()`).

---

## 1. Enable Copilot and MCP on the deployment

In the brand profile's `env` (or the server environment):

- **`BRAND_ENABLED_AGENTS`** must include `copilot`, or be unset (unset means every agent).
  It is server-only, so it needs `--env`, not only `--build-env` (WHITELABELING §1). Both
  shipped example profiles leave Copilot out (`acme` and `github-projects` set
  `BRAND_ENABLED_AGENTS=claude`). Without it the Copilot routes answer 404, and minting a
  Copilot token is refused with 409 *"The requested AI agent identity is not configured"*.
- **`NEXT_PUBLIC_BRAND_ENABLE_MCP`** must not be `false`. It defaults to on. `acme` turns
  it off. With it off, `/mcp` is gone and the token card is hidden.
- The agent identity is `copilot@<BRAND_AGENT_EMAIL_DOMAIN>`. The domain defaults to the
  brand domain.

Each user also needs MCP access on their account (`User.mcpEnabled`, on by default).
Otherwise minting a token answers 403 *"MCP access is disabled for your account"*.

### `ASTRID_API_BASE_URL`

The `/mcp` endpoint is a proxy. It forwards each call to the API at `ASTRID_API_BASE_URL`,
and **defaults to `https://<NEXT_PUBLIC_BRAND_DOMAIN>`** (`mcpDefaultBaseUrl()`,
`lib/brand/config.ts`). Set it when that default is wrong for the container:

- the brand domain is not this deployment's public name; or
- the app container cannot reach its own public hostname (no hairpin NAT). For the compose
  stack that is `ASTRID_API_BASE_URL=http://app:3000` in `deploy/self-host/.env`.

An exact operator-set value is the only backend allowed to be HTTP or a private address
(`lib/security/mcp-backend.ts`). Any other backend must be public HTTPS.

## 2. Your origin must be publicly reachable

GitHub-hosted runners, and the cloud agent, call your server from GitHub's network: the
queue gate reads the queue, and Copilot calls `<origin>/mcp`. A deployment reachable only
on a VPN or private network does not work with steps 3–5. Use VS Code or the local CLI
there instead, or a self-hosted runner inside your network (not covered here).

**Open Settings → AI Agents from the public URL.** The generated commands and workflow use
the browser's origin (`window.location.origin`). Copied from `http://localhost:3000`,
they point the runner at localhost.

## 3. Mint the Copilot-bound token

In **Settings → AI Agents**, set Copilot to *I run it* → *Native coding harness*. Then click
**Create GitHub setup**. That mints a user-level access token bound to the `copilot`
identity (`POST /api/mcp/user-tokens` with `agent: "copilot"`, read/write, 365 days).
Writes made with it are signed as Copilot, under your permissions. The token is shown
once.

- **Prefix:** `astrid_mcp_` followed by 64 hex characters (`lib/mcp-token-utils.ts`). The
  prefix is a wire format, **not** branded: a partner's tokens start `astrid_mcp_` too.
- **One token serves both jobs:** the REST queue accepts it as a bearer, so the Actions
  workflow needs a single server secret, not a client id and secret pair.

**Secret names.** The wordmark is `NEXT_PUBLIC_BRAND_WORDMARK`, defaulting to the
lowercased `NEXT_PUBLIC_BRAND_NAME`. Every non-alphanumeric character becomes `_`, and the
result is uppercased. So `astrid` gives `ASTRID`, `ACME` gives `ACME`, and `my-tasks`
gives `MY_TASKS`. The token goes under one of two names, depending on where it is used:

| Used by | Where in GitHub | Secret name | Source |
|---|---|---|---|
| The generated Actions workflow | Settings → Secrets and variables → **Actions** | `<WORDMARK>_COPILOT_MCP_TOKEN` | `mcpTokenSecretName('copilot')` |
| The Copilot cloud agent | Settings → Secrets and variables → **Agents** | `COPILOT_MCP_<WORDMARK>_TOKEN` | `components/github-copilot-mcp-setup.tsx` |

GitHub requires the `COPILOT_MCP_` prefix for secrets that the cloud agent's MCP
configuration reads, which is why the two names differ. For the cloud agent, also paste
the generated MCP configuration under the repository's Settings → Copilot → MCP servers.

## 4. `COPILOT_GITHUB_TOKEN`

The Actions workflow bills Copilot CLI to **your** Copilot plan. Create a fine-grained
personal access token on the GitHub account that holds the plan, with the account
permission **"Copilot Requests"**. Save it as the Actions secret `COPILOT_GITHUB_TOKEN`
(`COPILOT_TOKEN_SECRET`). Copilot CLI reads it ahead of `GH_TOKEN`, so `gh` in the same
step keeps using the job's own token.

## 5. Commit the generated workflow, then hand Copilot a task

From the Copilot tab, copy **Run in GitHub Actions** (`actionsCopilotWorkflow()`). Commit
it to the repository as `.github/workflows/<wordmark>-copilot.yml`. It has two jobs:

1. **`queue-gate`**: runs `npx @gracefultools/astrid-sdk@1 astrid-agent queue --agent copilot`
   with `ASTRID_TOKEN` (the step 3 secret) and `ASTRID_API_URL: <origin>`. If nothing is
   queued, the run stops there and uses none of your Copilot plan.
2. **`copilot`**: installs `@github/copilot`, writes an MCP config pointing at
   `<origin>/mcp` with the same token, and runs
   `copilot -p "$PROMPT" --additional-mcp-config … --allow-all-tools --no-ask-user`.

**What starts it:** `schedule` (`*/30 * * * *`), `workflow_dispatch` (a manual run from
the Actions tab), and `repository_dispatch` of type `astrid-wake`, which is the server's
opt-in event wake. A wake runs the workflow only when it is addressed to `copilot` or to
`any`, so a Claude workflow in the same repository is not started by it (ADEV-102). The
wake reaches the repository only when the server has `ASTRID_AGENT_WAKE=on`, the board
is in `ASTRID_AGENT_WAKE_LISTS`, and your instance's GitHub App is installed on the
repository ([AGENT_EVENT_WAKE.md](../architecture/AGENT_EVENT_WAKE.md)). Without those,
expect up to 30 minutes between marking a task Ready and Copilot starting (GitHub also
skips some scheduled runs), or run the workflow by hand. A workflow generated before
this change has no `repository_dispatch` trigger. Regenerate it from Settings to get one.

Then, on a board:

1. Assign the task to **Copilot**.
2. Move it to **Ready**. The queue holds a task only when it is assigned to the agent
   *and* Ready.

Copilot works the task on a branch, opens a pull request with `gh`, and puts the link in
its completion comment. A pull request opened with the job's own `GITHUB_TOKEN` does not
start your other workflows. CI on it needs a re-run, or a PAT in place of the job token.

## 6. The cloud agent's firewall

The Copilot cloud agent runs behind GitHub's agent firewall. According to
[GitHub's documentation](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-firewall),
the firewall covers processes the agent starts through its **Bash tool**. It does not
apply directly to MCP servers other than the built-in Playwright one.

- **MCP calls to `<origin>/mcp` work without an allowlist entry.**
- **A Bash `curl` (or SDK call) to your instance is blocked** until you allowlist it:
  repository Settings → Copilot → Internet access → Custom allowlist, then add your
  domain. Repository rules need the organisation setting "Allow repository custom rules".

The generated Actions workflow in step 5 is an ordinary Actions job, not the cloud agent.
This firewall does not apply to it.

## 7. Server-run Copilot: per-user OAuth (untested here)

Separately from the queue setups above, Settings → AI Agents can run Copilot
**server-side** (*\<Brand\> runs it*), billed to each user's own Copilot subscription. Each user
connects GitHub through an OAuth app (or GitHub App) that you register:

- `GITHUB_COPILOT_CLIENT_ID` and `GITHUB_COPILOT_CLIENT_SECRET` on the server. Unset, the
  authorize route answers 503 *"GitHub Copilot is not configured on this server"*.
- Callback URL registered on the app: `<origin>/api/v1/integrations/copilot/callback`.
  The web flow sends no `redirect_uri`, so GitHub uses the registered one.
- Optional `COPILOT_CLI_URL`: an external headless Copilot runtime
  ([COPILOT_SDK_INTEGRATION_PLAN.md](../COPILOT_SDK_INTEGRATION_PLAN.md)).

**This path has not been tested in the self-host Docker image.** Nobody has registered an
OAuth app against a self-hosted instance, connected an account, and had a server-run
Copilot reply land. Treat it as unverified. Steps 1–5 do not depend on it.

## 8. Not usable yet: the GitHub Projects ("Lanes") brand

Do not plan Copilot on `brands/github-projects.brand.json`. Its profile enables only
Claude (`BRAND_ENABLED_AGENTS=claude`), so Copilot does not exist there. Its GitHub App is
not registered either: the slug `lanes-for-github-projects` is a placeholder
([LANES_GITHUB_MARKETPLACE.md](./LANES_GITHUB_MARKETPLACE.md)). Adding `copilot` to a fork
of that profile is untested.

---

## Checklist

- [ ] `BRAND_ENABLED_AGENTS` includes `copilot` (or is unset); `NEXT_PUBLIC_BRAND_ENABLE_MCP` not `false`
- [ ] `ASTRID_API_BASE_URL` set if the brand domain is not reachable from the container
- [ ] `<origin>` reachable from the public internet (for Actions and the cloud agent)
- [ ] Token minted from Settings → AI Agents → Copilot, opened on the public URL
- [ ] Actions secret `<WORDMARK>_COPILOT_MCP_TOKEN` (and/or Agents secret `COPILOT_MCP_<WORDMARK>_TOKEN`)
- [ ] Actions secret `COPILOT_GITHUB_TOKEN` (fine-grained PAT, "Copilot Requests")
- [ ] `.github/workflows/<wordmark>-copilot.yml` committed; a manual run succeeds
- [ ] A task assigned to Copilot and moved to Ready is picked up
