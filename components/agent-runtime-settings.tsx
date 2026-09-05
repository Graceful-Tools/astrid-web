"use client"

/**
 * The loop recipes — how each harness connects to the queue and runs it on a
 * schedule. `AgentLoopRecipes` is rendered by the agent hub (per-agent, pinned
 * to one identity), the per-list AI section (listId-scoped), and /docs/loops
 * (everything, for a logged-out reader). One copy, because a settings snippet
 * that drifts from the docs snippet is how someone pastes a config that no
 * longer matches the tool.
 *
 * The per-agent runtime toggle that used to live here became the mode control
 * in components/agent-hub.tsx.
 */

import { BRAND } from '@/lib/brand/config'
import {
  queueContractLine,
  queueSkillAdapter,
  type QueueSkillHarness,
} from '@/lib/agent-skill/astrid-queue-skill'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { useTranslations } from '@/lib/i18n/client'
import { toast } from 'sonner'

type AgentExecutionMode = 'api' | 'polling'

interface AgentRuntime {
  mailbox: string
  email: string
  mode: AgentExecutionMode
  locked: boolean
}

/** Display names live here, not in the API: the API answers with identities. */
const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'GitHub Copilot',
  openai: 'OpenAI',
  gemini: 'Gemini',
}

/** Which harness each agent identity is usually driven by, for the setup tab. */
const DEFAULT_HARNESS: Record<string, string> = {
  claude: 'claude-code',
  codex: 'codex',
  copilot: 'copilot',
  openai: 'codex',
  gemini: 'gemini',
}

/**
 * The inverse, for harness-first rendering: when no agent identity is pinned,
 * each tab addresses the identity that harness normally runs as. This is what
 * lets one "connect your coding agent" card serve every harness without first
 * asking the reader which agent row they came from.
 */
const TAB_MAILBOX: Record<string, string> = {
  'claude-code': 'claude',
  copilot: 'copilot',
  codex: 'codex',
  github: 'copilot',
  gemini: 'gemini',
  cursor: 'claude',
}

/** Every harness tab, in display order. */
const ALL_TABS: readonly string[] = ['claude-code', 'copilot', 'codex', 'github', 'gemini', 'cursor']

const TAB_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  copilot: 'Copilot / VS Code',
  codex: 'Codex',
  github: 'GitHub Actions',
  gemini: 'Gemini CLI',
  cursor: 'Cursor',
}

/**
 * Which tabs a PINNED agent identity shows. A pinned row already knows what
 * runs it — offering six tabs there makes the reader pick their answer from
 * five wrong ones. Copilot keeps two because both really are its harnesses:
 * the CLI/VS Code locally, GitHub Actions in CI. Unpinned render sites (the
 * connect card, the per-list loop, /docs/loops) keep everything.
 */
const MAILBOX_TABS: Record<string, readonly string[]> = {
  claude: ['claude-code'],
  copilot: ['copilot', 'github'],
  codex: ['codex'],
  openai: ['codex'],
  gemini: ['gemini'],
}

function CopyBlock({
  code,
  label,
  testId,
}: {
  code: string
  label: string
  testId?: string
}) {
  const { t } = useTranslations()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('common.unableToCopy'))
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium theme-text-muted">{label}</span>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={copy}>
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          <span className="ml-1 text-xs">
            {t(copied ? 'messages.copied' : 'actions.copy')}
          </span>
        </Button>
      </div>
      <pre className="p-3 theme-bg-tertiary rounded-lg overflow-x-auto">
        <code
          className="text-xs font-mono theme-text-primary whitespace-pre-wrap break-words"
          data-testid={testId}
        >
          {code}
        </code>
      </pre>
    </div>
  )
}

function RecipeStep({
  number,
  title,
  children,
}: {
  number: number
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2 rounded-lg border theme-border p-3">
      <h4 className="text-sm font-semibold theme-text-primary">
        {number}. {title}
      </h4>
      {children}
    </section>
  )
}

/**
 * The loop recipes.
 *
 * Every primary harness follows the same four moves — connect MCP, install the
 * queue behavior, choose how it runs, and verify the complete connection — so
 * the tabs differ only in that harness's syntax.
 *
 * Exported because /docs/loops teaches the identical thing to a logged-out
 * reader. One copy: a settings panel and a docs page that drift apart is how
 * someone ends up pasting a config that no longer matches the tool.
 */
export function AgentLoopRecipes({
  mailbox,
  origin,
  listId,
}: {
  /**
   * Pin every tab to one agent identity (the per-agent runtime rows do this).
   * Omitted, each tab uses that harness's own identity via TAB_MAILBOX.
   */
  mailbox?: string
  origin: string
  /**
   * Scope the loop to one list/board. The queue endpoint takes listId so that
   * two harnesses working different boards never take each other's tasks —
   * passing it here is what makes "run a /fixall loop per list" one paste.
   */
  listId?: string | null
}) {
  const { t } = useTranslations()
  const mcpUrl = `${origin}/mcp`
  // Same name /docs/mcp tells people to register, so one harness ends up with one
  // server entry rather than two half-configured ones.
  const serverName = BRAND.wordmark.toLowerCase()
  const listClause = listId ? ` and listId "${listId}"` : ''
  const agentFor = (tab: string) => mailbox ?? TAB_MAILBOX[tab] ?? 'claude'
  const queueLine = (tab: string) => queueContractLine({ mailbox: agentFor(tab), listId })
  // Install steps serve the canonical queue skill's generated adapter, so a
  // recipe and the skill it installs cannot drift (lib/agent-skill).
  const adapterFor = (harness: QueueSkillHarness, tab: string) =>
    queueSkillAdapter(harness, { mailbox: agentFor(tab), listId })
  const installBlock = (harness: QueueSkillHarness, tab: string) => {
    const adapter = adapterFor(harness, tab)
    return `# ${adapter.installPath}
${adapter.content}`
  }
  const connectionCheck = (tab: string, scheduling: string) => {
    const boardSelection = listId
      ? `Use listId "${listId}" and confirm that exact board is visible.`
      : 'Choose one board from get_lists, report its name and ID, and use that listId for the queue call.'

    return `Connection check only. Do not create, comment on, update, or complete a task.
1. Confirm the ${BRAND.appName} account shown during authorization.
2. Call get_lists. ${boardSelection}
3. Confirm get_agent_queue, add_comment, and update_task are available.
4. Call get_agent_queue with agent "${agentFor(tab)}"${listClause}.
5. Report exactly:
- account: the authorized ${BRAND.appName} account
- board: selected board name and ID
- mailbox: the response agent mailbox and email
- queue visibility: empty:true, or the visible queue count
- comment/update permissions: whether both tools are available and the selected board grants write access
- scheduling: ${scheduling}
Treat empty:true as a successful connection. If a field cannot be verified, say so instead of guessing.`
  }
  const connectionTest = (tab: string, scheduling: string) => (
    <RecipeStep number={4} title="Test">
      <CopyBlock
        label="Run a non-mutating connection check"
        code={connectionCheck(tab, scheduling)}
        testId="agent-connection-check"
      />
    </RecipeStep>
  )
  const cloudSecretName =
    `COPILOT_MCP_${BRAND.wordmark.replace(/[^a-z0-9]/gi, '_').toUpperCase()}_TOKEN`
  const tokenSetupUrl = `${origin}/settings/agents`
  // The Actions gate never stores a long-lived credential: client credentials
  // from API Access exchange for a one-hour token, scoped to exactly what a
  // queue read plus task/comment writes need — never the wildcard an MCP setup
  // token maps to.
  const actionsScopes =
    'tasks:read tasks:write lists:read comments:read comments:write user:read'
  const actionsClientIdReference = '${{ secrets.ASTRID_CLIENT_ID }}'
  const actionsClientSecretReference = '${{ secrets.ASTRID_CLIENT_SECRET }}'
  const actionsTokenReference = '${{ steps.token.outputs.access-token }}'

  const visibleTabs = (mailbox && MAILBOX_TABS[mailbox]) || ALL_TABS
  const preferredTab = (mailbox && DEFAULT_HARNESS[mailbox]) || 'claude-code'

  return (
    <Tabs
      defaultValue={visibleTabs.includes(preferredTab) ? preferredTab : visibleTabs[0]}
      className="w-full"
    >
      {/* One relevant recipe needs no picker chrome. Radix unmounts inactive
          tab content, so hiding the triggers is the whole gate. */}
      {visibleTabs.length > 1 && (
        <TabsList className="flex flex-wrap h-auto">
          {visibleTabs.map(tab => (
            <TabsTrigger key={tab} value={tab}>{TAB_LABELS[tab]}</TabsTrigger>
          ))}
        </TabsList>
      )}

      <TabsContent value="claude-code" className="space-y-3 pt-3">
        <RecipeStep number={1} title="Connect">
          <CopyBlock
            label="Add the remote MCP server"
            code={`claude mcp add --transport http ${serverName} ${mcpUrl}`}
          />
          <p className="text-xs theme-text-muted">
            Open <code className="font-mono">/mcp</code> in Claude Code and choose Authenticate.
            If the command is unavailable, add the same HTTP server to a project
            <code className="font-mono"> .mcp.json</code> file instead.
          </p>
          <CopyBlock
            label="Manual MCP fallback"
            code={`{
  "mcpServers": {
    "${serverName}": {
      "type": "http",
      "url": "${mcpUrl}"
    }
  }
}`}
          />
        </RecipeStep>
        <RecipeStep number={2} title="Install">
          <CopyBlock
            label="Save the queue skill as a project command"
            code={installBlock('claude-code', 'claude-code')}
          />
        </RecipeStep>
        <RecipeStep number={3} title="Schedule or run">
          <CopyBlock label="Run every 30 minutes in this session" code={`/loop 30m /${serverName}-queue`} />
          <CopyBlock
            label="Unattended cron fallback"
            code={`*/30 * * * * cd ~/code/your-project && claude -p "/${serverName}-queue" >> ~/${serverName}-loop.log 2>&1`}
          />
        </RecipeStep>
        {connectionTest('claude-code', 'Claude Code /loop every 30 minutes, or the cron fallback')}
      </TabsContent>

      <TabsContent value="copilot" className="space-y-3 pt-3">
        <RecipeStep number={1} title="Connect">
          <CopyBlock
            label="Copilot CLI: add the remote MCP server"
            code={`copilot mcp add --transport http ${serverName} ${mcpUrl}`}
          />
          <CopyBlock
            label="VS Code fallback: .vscode/mcp.json"
            code={`{
  "servers": {
    "${serverName}": {
      "type": "http",
      "url": "${mcpUrl}"
    }
  }
}`}
          />
          <p className="text-xs theme-text-muted">
            The CLI and VS Code open {BRAND.appName}&apos;s browser authorization. The Copilot app and
            GitHub.com cannot open remote MCP OAuth; create a dedicated token, save it as the
            Agents secret <code className="font-mono">{cloudSecretName}</code>, and paste the
            generated repository MCP configuration in Settings &gt; Copilot &gt; MCP servers.
          </p>
          <Button variant="outline" size="sm" asChild>
            <a href={tokenSetupUrl}>
              {t('settingsPages.aiAgents.githubMcp.create')}
              <ExternalLink className="ml-2 h-3.5 w-3.5" />
            </a>
          </Button>
        </RecipeStep>
        <RecipeStep number={2} title="Install">
          <p className="text-xs theme-text-muted">
            Commit this repository custom agent once. Copilot CLI, the Copilot app,
            GitHub.com, and VS Code can then select the same queue behavior.
          </p>
          <CopyBlock
            label="Repository custom agent"
            code={installBlock('copilot', 'copilot')}
          />
        </RecipeStep>
        <RecipeStep number={3} title="Schedule or run">
          <CopyBlock
            label="Run Copilot CLI every 30 minutes"
            code={`*/30 * * * * cd ~/code/your-project && copilot -p "${queueLine('copilot')}" --allow-all-tools >> ~/${serverName}-loop.log 2>&1`}
          />
          <p className="text-xs theme-text-muted">
            For an interactive run, select the {BRAND.appName} Queue custom agent in the
            Copilot app, GitHub.com, or VS Code. For hosted scheduling, use the GitHub Actions tab.
          </p>
        </RecipeStep>
        {connectionTest(
          'copilot',
          'Copilot CLI cron every 30 minutes, an interactive custom-agent run, or GitHub Actions',
        )}
      </TabsContent>

      <TabsContent value="codex" className="space-y-3 pt-3">
        <RecipeStep number={1} title="Connect">
          <CopyBlock
            label="Add the remote server and authorize it"
            code={`codex mcp add ${serverName} --url ${mcpUrl}
codex mcp login ${serverName}`}
          />
          <CopyBlock
            label="Manual MCP fallback: ~/.codex/config.toml"
            code={`[mcp_servers.${serverName}]
url = "${mcpUrl}"`}
          />
        </RecipeStep>
        <RecipeStep number={2} title="Install">
          <CopyBlock
            label="Add the queue skill to AGENTS.md"
            code={installBlock('codex', 'codex')}
          />
        </RecipeStep>
        <RecipeStep number={3} title="Schedule or run">
          <CopyBlock
            label="Run Codex every 30 minutes"
            code={`*/30 * * * * cd ~/code/your-project && codex exec --sandbox workspace-write "${queueLine('codex')}" >> ~/${serverName}-loop.log 2>&1`}
          />
        </RecipeStep>
        {connectionTest('codex', 'Codex cron every 30 minutes, or a manual codex exec run')}
      </TabsContent>

      <TabsContent value="github" className="space-y-3 pt-3">
        <RecipeStep number={1} title="Connect">
          <p className="text-xs theme-text-muted">
            Create OAuth client credentials in {BRAND.appName} and save them as repository
            Actions secrets named <code className="font-mono">ASTRID_CLIENT_ID</code> and{' '}
            <code className="font-mono">ASTRID_CLIENT_SECRET</code>. Each run exchanges the
            client credentials for a one hour access token with only the scopes a queue
            worker needs — no long-lived token ever reaches the repository.
          </p>
          <Button variant="outline" size="sm" asChild>
            <a href={`${origin}/settings/api-access`}>
              {t('settingsPages.apiAccess.title')}
              <ExternalLink className="ml-2 h-3.5 w-3.5" />
            </a>
          </Button>
        </RecipeStep>
        <RecipeStep number={2} title="Install">
          <p className="text-xs theme-text-muted">
            This workflow is a queue gate: it answers &quot;is there work?&quot; and it does
            not run an agent itself. Point the second job at your existing supported agent
            job (a Copilot CLI, Claude Code, or Codex step from the other tabs).
          </p>
          <CopyBlock
            label="Add the queue gate workflow"
            testId="actions-queue-gate"
            code={`# .github/workflows/${serverName}-queue.yml
name: ${BRAND.appName} queue gate
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
            -d client_id="${actionsClientIdReference}" \\
            -d client_secret="${actionsClientSecretReference}" \\
            -d "scope=${actionsScopes}" | jq -r .access_token)
          echo "::add-mask::$ACCESS_TOKEN"
          echo "access-token=$ACCESS_TOKEN" >> "$GITHUB_OUTPUT"
      - name: Read the queue
        id: queue
        run: |
          curl -fsS "${origin}/api/v1/agent-queue?agent=${agentFor('github')}${listId ? `&listId=${listId}` : ''}" \\
            -H "X-OAuth-Token: ${actionsTokenReference}" > queue.json
          echo "has-work=$(jq -r 'if .empty then "false" else "true" end' queue.json)" >> "$GITHUB_OUTPUT"

  run-your-agent:
    needs: queue-gate
    if: needs.queue-gate.outputs.has-work == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Replace this step with your existing supported agent job — the gate
      # only decides whether that job starts.
      - run: echo "Queue has assigned Ready tasks - start your agent job"`}
          />
        </RecipeStep>
        <RecipeStep number={3} title="Schedule or run">
          <p className="text-xs theme-text-muted">
            Commit the workflow for its 30-minute schedule, or use Run workflow in GitHub Actions
            to test it immediately. A quiet run stops after the scoped queue request, so an
            empty queue costs one API call rather than a whole agent boot.
          </p>
        </RecipeStep>
        {connectionTest(
          'github',
          'GitHub Actions every 30 minutes, with workflow_dispatch for an immediate test',
        )}
      </TabsContent>

      <TabsContent value="gemini" className="space-y-3 pt-3">
        <CopyBlock
          label="1. Add the queue to ~/.gemini/settings.json"
          code={`{
  "mcpServers": {
    "${serverName}": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${mcpUrl}"]
    }
  }
}`}
        />
        <CopyBlock
          label="2. Run the loop on a schedule"
          code={`*/30 * * * * cd ~/code/your-project && gemini -p "${queueLine('gemini')}" >> ~/${serverName}-loop.log 2>&1`}
        />
      </TabsContent>

      <TabsContent value="cursor" className="space-y-3 pt-3">
        <CopyBlock
          label="1. Add the queue to .cursor/mcp.json"
          code={`{
  "mcpServers": {
    "${serverName}": {
      "url": "${mcpUrl}"
    }
  }
}`}
        />
        <p className="text-xs theme-text-muted">
          2. Cursor has no scheduler of its own — ask it for your queue at the start of a
          working session, or run the Claude Code / Codex cron line above alongside it.
        </p>
      </TabsContent>
    </Tabs>
  )
}
