/**
 * The loop recipes as plain strings — the commands a harness runs to connect
 * to the queue, and the line that runs it on a schedule.
 *
 * These used to be built inline inside `AgentLoopRecipes` (JSX), which meant
 * only a React tree could read them. /starthere also serves a plain-markdown
 * copy for agents to follow (`/starthere.md`), and that copy must be the SAME
 * commands, not a retyped second set — a guide an agent follows literally is
 * exactly where a drifted flag turns into a setup that silently never works.
 * So both surfaces build from here, alongside the canonical queue skill.
 */

import { BRAND } from '@/lib/brand/config'
import { queueContractLine } from '@/lib/agent-skill/astrid-queue-skill'

/** Harnesses that connect over MCP and poll the queue on a schedule. */
export type LoopHarness = 'claude-code' | 'copilot' | 'codex' | 'muse'

export interface LoopRecipeOptions {
  /** Agent mailbox the loop polls, e.g. "claude". */
  mailbox: string
  /** Absolute origin, e.g. https://www.astrid.cc */
  origin: string
  /** Scope the loop to one list. */
  listId?: string | null
}

/** MCP server name every recipe registers, so one harness ends up with one entry. */
export function mcpServerName(): string {
  return BRAND.wordmark.toLowerCase()
}

export function mcpUrlFor(origin: string): string {
  return `${origin}/mcp`
}

/** Step 1: the command that registers the remote MCP server and starts its OAuth. */
export function loopConnectCommand(harness: LoopHarness, origin: string): string {
  const name = mcpServerName()
  const url = mcpUrlFor(origin)
  switch (harness) {
    case 'claude-code':
      return `claude mcp add --transport http ${name} ${url}`
    case 'copilot':
      return `copilot mcp add --transport http ${name} ${url}`
    case 'codex':
      return `codex mcp add ${name} --url ${url}
codex mcp login ${name}`
    case 'muse':
      return `muse mcp add ${name} --url ${url}
muse mcp login ${name}`
  }
}

/** Step 3: the unattended schedule line (cron every 30 minutes). */
export function loopScheduleCommand(harness: LoopHarness, options: LoopRecipeOptions): string {
  const name = mcpServerName()
  const line = queueContractLine({ mailbox: options.mailbox, listId: options.listId })
  const log = `>> ~/${name}-loop.log 2>&1`
  switch (harness) {
    case 'claude-code':
      return `*/30 * * * * cd ~/code/your-project && claude -p "/${name}-queue" ${log}`
    case 'copilot':
      return `*/30 * * * * cd ~/code/your-project && copilot -p "${line}" --allow-all-tools ${log}`
    case 'codex':
      return `*/30 * * * * cd ~/code/your-project && codex exec --sandbox workspace-write "${line}" ${log}`
    case 'muse':
      // Muse parses options on the SUBCOMMAND, not the root, so the flags
      // follow `exec` and its prompt. --disable-approval is what makes an
      // unattended run possible while keeping the CLI's own sandbox; --yolo
      // would drop the sandbox too and is not appropriate on a laptop.
      return `*/30 * * * * cd ~/code/your-project && muse exec "${line}" --disable-approval ${log}`
  }
}

/** Claude Code's in-session alternative to cron. */
export function claudeCodeLoopCommand(): string {
  return `/loop 30m /${mcpServerName()}-queue`
}

/** Repository Actions secret names the queue gate reads. */
export const ACTIONS_SECRET_NAMES = {
  clientId: 'ASTRID_CLIENT_ID',
  clientSecret: 'ASTRID_CLIENT_SECRET',
} as const

/**
 * Scopes the Actions gate requests: a queue read plus task/comment writes —
 * never the wildcard an MCP setup token maps to.
 */
export const ACTIONS_QUEUE_SCOPES =
  'tasks:read tasks:write lists:read comments:read comments:write user:read'

/** The GitHub Actions queue-gate workflow file (path + YAML). */
export function actionsQueueGateWorkflow(options: LoopRecipeOptions): { path: string; content: string } {
  const name = mcpServerName()
  const { origin, mailbox, listId } = options
  const clientId = `\${{ secrets.${ACTIONS_SECRET_NAMES.clientId} }}`
  const clientSecret = `\${{ secrets.${ACTIONS_SECRET_NAMES.clientSecret} }}`
  const token = '${{ steps.token.outputs.access-token }}'
  const path = `.github/workflows/${name}-queue.yml`
  return {
    path,
    content: `name: ${BRAND.appName} queue gate
on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch:

jobs:
  queue-gate:
    runs-on: ubuntu-latest
    outputs:
      has-work: \${{ steps.queue.outputs.has-work }}
    steps:
      - name: Exchange client credentials for a one-hour token
        id: token
        run: |
          ACCESS_TOKEN=$(curl -fsS -X POST "${origin}/api/v1/oauth/token" \\
            -d grant_type=client_credentials \\
            -d client_id="${clientId}" \\
            -d client_secret="${clientSecret}" \\
            -d "scope=${ACTIONS_QUEUE_SCOPES}" | jq -r .access_token)
          echo "::add-mask::$ACCESS_TOKEN"
          echo "access-token=$ACCESS_TOKEN" >> "$GITHUB_OUTPUT"
      - name: Read the queue
        id: queue
        run: |
          curl -fsS "${origin}/api/v1/agent-queue?agent=${mailbox}${listId ? `&listId=${listId}` : ''}" \\
            -H "X-OAuth-Token: ${token}" > queue.json
          echo "has-work=$(jq -r 'if .runnable? then (.runnable.hasWork or .runnable.incomplete) else (.empty | not) end' queue.json)" >> "$GITHUB_OUTPUT"

  run-your-agent:
    needs: queue-gate
    if: needs.queue-gate.outputs.has-work == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Replace this step with your existing supported agent job — the gate
      # only decides whether that job starts.
      - run: echo "Queue has assigned Ready tasks - start your agent job"`,
  }
}

/**
 * The secret holding one agent's bound access token, e.g. ASTRID_CLAUDE_MCP_TOKEN.
 * Per mailbox, because the token decides who the writes are signed as: two
 * workers in one repository sharing a name would overwrite each other's
 * credential and post under the wrong agent (AWTD-1502).
 */
export function mcpTokenSecretName(mailbox: string): string {
  const part = (value: string) => value.replace(/[^a-z0-9]/gi, '_').toUpperCase()
  return `${part(BRAND.wordmark)}_${part(mailbox)}_MCP_TOKEN`
}

/** The secret `claude setup-token` produces for the official Claude action. */
export const CLAUDE_OAUTH_SECRET = 'CLAUDE_CODE_OAUTH_TOKEN'

/** What a hosted agent job is told: the queue contract plus the PR hand-off. */
function actionsAgentPrompt({ mailbox, listId }: LoopRecipeOptions): string {
  return `${queueContractLine({ mailbox, listId })} For a task that changes code: work on a new branch named after its identifier, commit, push, open a pull request with gh, and put the PR link in your completion comment. For a review task, post your findings on the existing pull request and on the task instead; there is nothing to commit. Never merge or deploy.`
}

/**
 * The gate job both hosted workflows share: one queue request with the
 * agent-bound token, and `has-work` for the agent job to wait on. A quiet half
 * hour costs one HTTP call and none of the user's plan.
 */
function bearerQueueGateJob({ origin, mailbox, listId }: LoopRecipeOptions): string {
  const tokenSecret = `\${{ secrets.${mcpTokenSecretName(mailbox)} }}`
  const queueUrl = `${origin}/api/v1/agent-queue?agent=${mailbox}${listId ? `&listId=${listId}` : ''}`
  return `  queue-gate:
    runs-on: ubuntu-latest
    outputs:
      has-work: \${{ steps.queue.outputs.has-work }}
    steps:
      - name: Is anything queued for ${mailbox}?
        id: queue
        run: |
          curl -fsS "${queueUrl}" \\
            -H "Authorization: Bearer ${tokenSecret}" > queue.json
          echo "has-work=$(jq -r 'if .runnable? then (.runnable.hasWork or .runnable.incomplete) else (.empty | not) end' queue.json)" >> "$GITHUB_OUTPUT"`
}

/**
 * A complete GitHub Actions workflow that runs Claude Code on the user's own
 * Claude plan, with no machine left on (AWTD-1494).
 *
 * Two jobs. The gate asks the queue with one HTTP request and stops when it is
 * empty, so a quiet half hour costs no Claude usage. The worker runs the
 * official `anthropics/claude-code-action@v1` (inputs verified against its
 * action.yml: claude_code_oauth_token, prompt, claude_args) connected to this
 * server's MCP with an agent-bound access token. The same token reads the
 * queue: REST accepts an `astrid_mcp_` bearer, so it is ONE secret, not two.
 *
 * GitHub does not start other workflows for a PR opened with the job's own
 * GITHUB_TOKEN, so CI on those PRs needs a re-run or a PAT — said in the
 * guide rather than hidden here.
 */
export function actionsClaudeCodeWorkflow(options: LoopRecipeOptions): { path: string; content: string } {
  const name = mcpServerName()
  const { origin } = options
  const tokenSecret = `\${{ secrets.${mcpTokenSecretName(options.mailbox)} }}`
  const claudeSecret = `\${{ secrets.${CLAUDE_OAUTH_SECRET} }}`
  const prompt = actionsAgentPrompt(options)
  return {
    path: `.github/workflows/${name}-claude.yml`,
    content: `name: ${BRAND.appName} queue — Claude Code
on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch:

concurrency:
  group: ${name}-claude
  cancel-in-progress: false

jobs:
${bearerQueueGateJob(options)}

  claude:
    needs: queue-gate
    if: needs.queue-gate.outputs.has-work == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 60
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Connect Claude Code to ${BRAND.appName}
        env:
          TOKEN: ${tokenSecret}
        run: |
          jq -n --arg url "${origin}/mcp" --arg auth "Bearer $TOKEN" \\
            '{mcpServers: {${name}: {type: "http", url: $url, headers: {Authorization: $auth}}}}' \\
            > "$RUNNER_TEMP/${name}-mcp.json"
      - uses: anthropics/claude-code-action@v1
        env:
          GH_TOKEN: \${{ github.token }}
        with:
          claude_code_oauth_token: ${claudeSecret}
          prompt: "${prompt.replace(/"/g, '\\"')}"
          claude_args: >-
            --mcp-config \${{ runner.temp }}/${name}-mcp.json
            --allowedTools "mcp__${name},Bash,Edit,Write,Read,Glob,Grep"
            --max-turns 120`,
  }
}

/**
 * Copilot CLI reads its plan credential from this: a fine-grained personal
 * access token with the account permission "Copilot Requests". It outranks
 * GH_TOKEN, so `gh` in the same step keeps the job's own token.
 */
export const COPILOT_TOKEN_SECRET = 'COPILOT_GITHUB_TOKEN'

/**
 * The Copilot CLI counterpart of `actionsClaudeCodeWorkflow` (AWTD-1502):
 * same gate, same single agent-bound token, billed to the user's Copilot plan.
 *
 * Flags verified against Copilot CLI 1.0.99 `--help` (2026-11-02): `-p` is
 * non-interactive; `--additional-mcp-config @file` adds a server for this run
 * in the JSON shape `copilot mcp add --transport http --header` writes;
 * `--allow-all-tools` and `--no-ask-user` keep it from stopping for a person.
 */
export function actionsCopilotWorkflow(options: LoopRecipeOptions): { path: string; content: string } {
  const name = mcpServerName()
  const { origin } = options
  const tokenSecret = `\${{ secrets.${mcpTokenSecretName(options.mailbox)} }}`
  const copilotSecret = `\${{ secrets.${COPILOT_TOKEN_SECRET} }}`
  const prompt = actionsAgentPrompt(options)
  return {
    path: `.github/workflows/${name}-copilot.yml`,
    content: `name: ${BRAND.appName} queue — Copilot CLI
on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch:

concurrency:
  group: ${name}-copilot
  cancel-in-progress: false

jobs:
${bearerQueueGateJob(options)}

  copilot:
    needs: queue-gate
    if: needs.queue-gate.outputs.has-work == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 60
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install Copilot CLI
        run: npm install -g @github/copilot
      - name: Connect Copilot CLI to ${BRAND.appName}
        env:
          TOKEN: ${tokenSecret}
        run: |
          jq -n --arg url "${origin}/mcp" --arg auth "Bearer $TOKEN" \\
            '{mcpServers: {${name}: {type: "http", url: $url, headers: {Authorization: $auth}, tools: ["*"]}}}' \\
            > "$RUNNER_TEMP/${name}-mcp.json"
      - name: Work the queue
        env:
          ${COPILOT_TOKEN_SECRET}: ${copilotSecret}
          GH_TOKEN: \${{ github.token }}
          # An env var, not an inline argument, so no shell quoting can bend it.
          PROMPT: "${prompt.replace(/"/g, '\\"')}"
        run: >-
          copilot -p "$PROMPT"
          --additional-mcp-config "@$RUNNER_TEMP/${name}-mcp.json"
          --allow-all-tools
          --no-ask-user`,
  }
}
