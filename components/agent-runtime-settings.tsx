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
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Check, Copy } from 'lucide-react'
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

function CopyBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy — select the text instead')
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium theme-text-muted">{label}</span>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={copy}>
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          <span className="ml-1 text-xs">{copied ? 'Copied' : 'Copy'}</span>
        </Button>
      </div>
      <pre className="p-3 theme-bg-tertiary rounded-lg overflow-x-auto">
        <code className="text-xs font-mono theme-text-primary whitespace-pre">{code}</code>
      </pre>
    </div>
  )
}

/**
 * The loop recipes.
 *
 * Every one of them is the same three moves — connect MCP, ask for the queue,
 * repeat on a schedule — so the tabs differ only in that harness's syntax.
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
  const mcpUrl = `${origin}/mcp`
  // Same name /docs/mcp tells people to register, so one harness ends up with one
  // server entry rather than two half-configured ones.
  const serverName = BRAND.wordmark.toLowerCase()
  const listClause = listId ? ` and listId "${listId}"` : ''
  const agentFor = (tab: string) => mailbox ?? TAB_MAILBOX[tab] ?? 'claude'
  const queueLine = (tab: string) =>
    `Call get_agent_queue with agent "${agentFor(tab)}"${listClause}. Work every task it returns to completion, commenting progress on each one. If it answers empty:true, stop and say nothing is queued.`

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
        <CopyBlock label="1. Connect this workspace to your queue" code={`claude mcp add --transport http ${serverName} ${mcpUrl}`} />
        <CopyBlock
          label="2. Save the loop as a command you can re-run"
          code={`# .claude/commands/${serverName}-queue.md
${queueLine('claude-code')}`}
        />
        <CopyBlock label="3. Run it every 30 minutes in a session" code={`/loop 30m /${serverName}-queue`} />
        <p className="text-xs theme-text-muted">
          Prefer it running without a session open? Put the headless form on cron:
        </p>
        <CopyBlock
          label="Unattended alternative"
          code={`*/30 * * * * cd ~/code/your-project && claude -p "/${serverName}-queue" >> ~/${serverName}-loop.log 2>&1`}
        />
      </TabsContent>

      <TabsContent value="copilot" className="space-y-3 pt-3">
        <CopyBlock
          label="1. Connect the Copilot CLI to your queue"
          code={`copilot mcp add --transport http ${serverName} ${mcpUrl}`}
        />
        <CopyBlock
          label="Or add it to VS Code (.vscode/mcp.json)"
          code={`{
  "servers": {
    "${serverName}": {
      "type": "http",
      "url": "${mcpUrl}"
    }
  }
}`}
        />
        <CopyBlock
          label="2. Run the loop on a schedule"
          code={`*/30 * * * * cd ~/code/your-project && copilot -p "${queueLine('copilot')}" --allow-all-tools >> ~/${serverName}-loop.log 2>&1`}
        />
        <p className="text-xs theme-text-muted">
          On first run the CLI opens a browser to authorize — approve once and the schedule takes
          over. Working in a GitHub repo instead? The GitHub Actions tab runs the same loop in CI.
        </p>
      </TabsContent>

      <TabsContent value="codex" className="space-y-3 pt-3">
        <CopyBlock
          label="1. Add the queue to ~/.codex/config.toml"
          code={`[mcp_servers.${serverName}]
command = "npx"
args = ["-y", "mcp-remote", "${mcpUrl}"]`}
        />
        <CopyBlock
          label="2. Run the loop on a schedule"
          code={`*/30 * * * * cd ~/code/your-project && codex exec "${queueLine('codex')}" >> ~/${serverName}-loop.log 2>&1`}
        />
      </TabsContent>

      <TabsContent value="github" className="space-y-3 pt-3">
        <CopyBlock
          label="Schedule a job that only spends minutes when work is queued"
          code={`# .github/workflows/${serverName}-queue.yml
name: ${BRAND.appName} queue
on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch:

jobs:
  work-the-queue:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Read the queue
        id: queue
        run: |
          curl -sS "${origin}/api/v1/agent-queue?agent=${agentFor('github')}${listId ? `&listId=${listId}` : ''}" \\
            -H "X-OAuth-Token: \${{ secrets.ASTRID_TOKEN }}" > queue.json
          echo "empty=$(jq -r .empty queue.json)" >> "$GITHUB_OUTPUT"
      # Every later step is skipped on a quiet run, so an empty queue costs
      # one API call rather than a whole agent boot.
      - name: Work it
        if: steps.queue.outputs.empty == 'false'
        run: echo "Hand queue.json to your agent step here"`}
        />
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
