"use client"

/**
 * Where each agent actually runs — this server, or the user's own harness.
 *
 * Two jobs, in the order someone needs them:
 *   1. Pick the runtime per agent (the toggle).
 *   2. If they picked polling, show them exactly how to point their harness at
 *      the queue and put it on a loop. That second half is the whole feature:
 *      "polling mode" without a copy-pasteable loop is just an agent that stopped
 *      answering.
 *
 * The setup snippets are deliberately concrete — a real MCP config and a real
 * schedule for each harness — because the alternative is a paragraph telling
 * people to "configure MCP", which is where every integration doc goes to die.
 */

import { BRAND } from '@/lib/brand/config'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Check, Copy, Cloud, Loader2, RefreshCw, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { apiGet, apiPut } from '@/lib/api'

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
  copilot: 'github',
  openai: 'codex',
  gemini: 'gemini',
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
export function AgentLoopRecipes({ mailbox, origin }: { mailbox: string; origin: string }) {
  const mcpUrl = `${origin}/mcp`
  // Same name /docs/mcp tells people to register, so one harness ends up with one
  // server entry rather than two half-configured ones.
  const serverName = BRAND.wordmark.toLowerCase()
  const queueLine = `Call get_agent_queue with agent "${mailbox}". Work every task it returns to completion, commenting progress on each one. If it answers empty:true, stop and say nothing is queued.`

  return (
    <Tabs defaultValue={DEFAULT_HARNESS[mailbox] || 'claude-code'} className="w-full">
      <TabsList className="flex flex-wrap h-auto">
        <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
        <TabsTrigger value="codex">Codex</TabsTrigger>
        <TabsTrigger value="github">GitHub Actions</TabsTrigger>
        <TabsTrigger value="gemini">Gemini CLI</TabsTrigger>
        <TabsTrigger value="cursor">Cursor</TabsTrigger>
      </TabsList>

      <TabsContent value="claude-code" className="space-y-3 pt-3">
        <CopyBlock label="1. Connect this workspace to your queue" code={`claude mcp add --transport http ${serverName} ${mcpUrl}`} />
        <CopyBlock
          label="2. Save the loop as a command you can re-run"
          code={`# .claude/commands/${serverName}-queue.md
${queueLine}`}
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

      <TabsContent value="codex" className="space-y-3 pt-3">
        <CopyBlock
          label="1. Add the queue to ~/.codex/config.toml"
          code={`[mcp_servers.${serverName}]
command = "npx"
args = ["-y", "mcp-remote", "${mcpUrl}"]`}
        />
        <CopyBlock
          label="2. Run the loop on a schedule"
          code={`*/30 * * * * cd ~/code/your-project && codex exec "${queueLine}" >> ~/${serverName}-loop.log 2>&1`}
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
          curl -sS "${origin}/api/v1/agent-queue?agent=${mailbox}" \\
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
          code={`*/30 * * * * cd ~/code/your-project && gemini -p "${queueLine}" >> ~/${serverName}-loop.log 2>&1`}
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

export function AgentRuntimeSettings() {
  const [agents, setAgents] = useState<AgentRuntime[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [origin, setOrigin] = useState(`https://${BRAND.domain}`)

  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin)

    apiGet('/api/v1/users/me/agent-modes')
      .then(r => r.json())
      .then(data => {
        setAgents(data.agents || [])
        // Open the setup for whatever is already polling: someone arriving here
        // with a polling agent needs the instructions, not another click.
        const firstPolling = (data.agents || []).find((a: AgentRuntime) => a.mode === 'polling')
        if (firstPolling) setExpanded(firstPolling.mailbox)
      })
      .catch(() => toast.error('Could not load agent runtimes'))
      .finally(() => setLoading(false))
  }, [])

  const setMode = async (mailbox: string, mode: AgentExecutionMode) => {
    setSaving(mailbox)
    // Optimistic: the toggle is the whole interaction, so it must not lag.
    setAgents(prev => prev.map(a => (a.mailbox === mailbox ? { ...a, mode } : a)))

    try {
      // apiPut, not a raw fetch: the client API layer is what carries a write
      // through a dropped connection instead of discarding it.
      const response = await apiPut('/api/v1/users/me/agent-modes', { agent: mailbox, mode })
      const data = await response.json()
      setAgents(data.agents || [])
      if (mode === 'polling') setExpanded(mailbox)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save')
      // Put the row back rather than leaving the UI claiming a mode the server
      // never accepted — a wrong answer here is a silent agent.
      setAgents(prev =>
        prev.map(a => (a.mailbox === mailbox ? { ...a, mode: mode === 'polling' ? 'api' : 'polling' } : a))
      )
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return <div className="h-24 theme-bg-tertiary rounded-lg animate-pulse" />
  }

  return (
    <div className="space-y-4">
      <p className="text-sm theme-text-muted">
        Every agent below is yours either way — same identity, same list, same comments.
        This only decides who does the work: {BRAND.appName} calling a provider on your API
        key, or the coding harness you already pay for, picking the task up on its own loop.
      </p>

      <div className="space-y-3">
        {agents.map(agent => {
          const polling = agent.mode === 'polling'
          const label = AGENT_LABELS[agent.mailbox] || agent.mailbox

          return (
            <div key={agent.mailbox} className="border theme-border rounded-lg overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium theme-text-primary">{label}</span>
                    {agent.locked && (
                      <Badge variant="outline" className="text-xs">
                        Harness only
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs theme-text-muted truncate">{agent.email}</div>
                </div>

                <div className="flex items-center gap-2">
                  {saving === agent.mailbox && <Loader2 className="w-4 h-4 animate-spin theme-text-muted" />}
                  <div className="inline-flex rounded-lg border theme-border overflow-hidden">
                    <button
                      type="button"
                      disabled={agent.locked}
                      onClick={() => setMode(agent.mailbox, 'api')}
                      className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${
                        !polling ? 'bg-blue-500/15 text-blue-500' : 'theme-text-muted hover:theme-text-primary'
                      } ${agent.locked ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <Cloud className="w-3.5 h-3.5" />
                      {BRAND.appName} runs it
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode(agent.mailbox, 'polling')}
                      className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${
                        polling ? 'bg-green-500/15 text-green-500' : 'theme-text-muted hover:theme-text-primary'
                      }`}
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      My harness polls
                    </button>
                  </div>
                </div>
              </div>

              {polling && (
                <div className="border-t theme-border p-3 space-y-3 theme-bg-secondary">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs theme-text-muted">
                      {BRAND.appName} will not call any provider for {label}. Assign it a task, mark
                      the task <strong>Ready</strong>, and your harness picks it up on its next loop.
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setExpanded(expanded === agent.mailbox ? null : agent.mailbox)}
                    >
                      <RefreshCw className="w-3.5 h-3.5 mr-1" />
                      {expanded === agent.mailbox ? 'Hide setup' : 'Set up the loop'}
                    </Button>
                  </div>

                  {expanded === agent.mailbox && <AgentLoopRecipes mailbox={agent.mailbox} origin={origin} />}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
