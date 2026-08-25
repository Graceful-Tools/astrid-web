"use client"

import { BRAND } from '@/lib/brand/config'
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AIAPIKeyManager } from "@/components/ai-api-key-manager"
import { OpenClawAgentManager } from "@/components/openclaw-agent-manager"
import { AgentRuntimeSettings, AgentLoopRecipes } from "@/components/agent-runtime-settings"
import AdvancedAgentHosting from "@/components/Settings/AdvancedAgentHosting"
import {
  Brain,
  Sparkles,
  FileText,
  Bot,
  Check,
  Plug,
  Terminal
} from "lucide-react"
import Link from "next/link"
import Image from "next/image"

interface AgentsSettingsProps {
  onNavigate: (page: string) => void
}

interface AgentOption {
  id: string
  name: string
  email: string
  image: string | null
  service: string
}

function AstridAgentSelector() {
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/users/me/available-agents').then(r => r.json()),
      fetch('/api/v1/users/me/ai-preferences').then(r => r.json()),
    ]).then(([agentsData, settingsData]) => {
      setAgents(agentsData.agents || [])
      setCurrentAgentId(settingsData.defaultAgentId || null)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleSelect = async (agentId: string | null) => {
    setCurrentAgentId(agentId)
    await fetch('/api/v1/users/me/ai-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultAgentId: agentId }),
    })
  }

  if (loading) {
    return <div className="h-10 bg-gray-800/50 rounded animate-pulse" />
  }

  if (agents.length === 0) {
    return (
      <p className="text-sm theme-text-muted">
        Add an API key or register an OpenClaw agent below to power {BRAND.appName}.
      </p>
    )
  }

  // Filter out Astrid itself — this selector picks the model that powers Astrid
  const modelOptions = agents.filter(a => a.email !== `astrid@${BRAND.agentEmailDomain}`)

  if (modelOptions.length === 0) {
    return (
      <p className="text-sm theme-text-muted">
        Add an API key or register an OpenClaw agent below to power {BRAND.appName}.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {modelOptions.map(agent => (
        <button
          key={agent.id}
          onClick={() => handleSelect(currentAgentId === agent.id ? null : agent.id)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
            currentAgentId === agent.id
              ? 'border-blue-500 bg-blue-500/10'
              : 'theme-border hover:border-blue-500/50'
          }`}
        >
          {agent.image ? (
            <img src={agent.image} alt="" className="w-8 h-8 rounded-full" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
              <Bot className="w-4 h-4 text-purple-500" />
            </div>
          )}
          <div className="flex-1 text-left">
            <div className="text-sm font-medium theme-text-primary">{agent.name}</div>
            <div className="text-xs theme-text-muted">Powered by {agent.service}</div>
          </div>
          {currentAgentId === agent.id && (
            <Check className="w-5 h-5 text-blue-500 flex-shrink-0" />
          )}
        </button>
      ))}
      <p className="text-xs theme-text-muted pt-1">
        Choose the model that powers {BRAND.appName} for My Tasks and your private lists.
      </p>
    </div>
  )
}

/**
 * The front door: connect a harness, assign work, put it on a loop.
 *
 * Ungated on purpose — this is the zero-key path. Everything it teaches works
 * before any API key or provider setup exists, because /mcp does OAuth
 * discovery on its own and a keyless coding agent already defaults to polling.
 */
function ConnectCodingAgent() {
  const [origin, setOrigin] = useState(`https://${BRAND.domain}`)

  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin)
  }, [])

  return (
    <div className="space-y-4">
      <ol className="space-y-2 text-sm theme-text-muted">
        <li>
          <strong className="theme-text-primary">1. Connect</strong> — run the one-line setup for
          your coding tool below. It opens a browser to approve access; no API key, no token to
          paste.
        </li>
        <li>
          <strong className="theme-text-primary">2. Assign</strong> — your agent is already in the
          assignee list. Assign it a task and mark the task <strong>Ready</strong>. Pick the GitHub
          repository per list in List Settings → Admin.
        </li>
        <li>
          <strong className="theme-text-primary">3. Loop</strong> — schedule the queue command so
          the harness checks for work on its own. An empty queue costs one call and stops.
        </li>
      </ol>

      <AgentLoopRecipes origin={origin} />

      <p className="text-xs theme-text-muted">
        More detail:{' '}
        <Link href="/docs/mcp" className="text-blue-500 hover:underline">MCP connection docs</Link>
        {' '}·{' '}
        <Link href="/docs/loops" className="text-blue-500 hover:underline">running agents on a loop</Link>
      </p>
    </div>
  )
}

// onNavigate stays in the signature — the settings registry passes it to every page.
export default function AgentsSettings(_props: AgentsSettingsProps) {
  return (
    <div className="p-2 sm:p-4">
      <div className="max-w-sm sm:max-w-2xl mx-auto space-y-4 sm:space-y-6">
        {/* Settings Page Header */}
        <div className="flex flex-wrap items-center gap-3">
          <Brain className="w-8 h-8 text-purple-500" />
          <div>
            <h1 className="text-2xl font-bold theme-text-primary">AI Agents</h1>
            <p className="theme-text-muted">Assign tasks to AI agents and get intelligent help</p>
          </div>
        </div>

        {/* Connect a coding harness — the zero-key front door */}
        <Card className="theme-bg-secondary theme-border border-green-500/30">
          <CardHeader>
            <CardTitle className="theme-text-primary flex flex-wrap items-center gap-2">
              <Plug className="w-6 h-6 text-green-500" />
              <span>Connect your coding agent</span>
            </CardTitle>
            <CardDescription className="theme-text-muted">
              Use the coding tool you already pay for — GitHub Copilot, Claude Code, Codex — as
              your agent&apos;s runtime. Connect once, assign tasks, run a loop.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConnectCodingAgent />
          </CardContent>
        </Card>

        {/* Where each agent runs */}
        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="theme-text-primary flex flex-wrap items-center gap-2">
              <Terminal className="w-6 h-6 text-green-500" />
              <span>Where your agents run</span>
            </CardTitle>
            <CardDescription className="theme-text-muted">
              Let {BRAND.appName} call a provider on your API key, or keep the work in the
              coding harness you already pay for and have it poll this queue on a loop.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AgentRuntimeSettings />
          </CardContent>
        </Card>

        {/* Astrid — default agent for private lists */}
        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="theme-text-primary flex flex-wrap items-center gap-2">
              <Image src={BRAND.iconSmall} alt={BRAND.appName} width={24} height={24} className="rounded-full" />
              <span>{BRAND.appName}</span>
            </CardTitle>
            <CardDescription className="theme-text-muted">
              Choose a model to power {BRAND.appName}. Mention <strong>@astrid</strong> in any chat or comment to get help.{' '}
              {BRAND.appName} can read tasks across your lists, respond to messages, and complete tasks before their due dates.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AstridAgentSelector />
          </CardContent>
        </Card>

        {/* OpenClaw Agents */}
        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="theme-text-primary flex flex-wrap items-center gap-2">
              <Bot className="w-6 h-6 text-orange-500" />
              <span>OpenClaw Agents</span>
            </CardTitle>
            <CardDescription className="theme-text-muted">
              Connect your own AI agents via the OpenClaw protocol.
              Agents get OAuth credentials and communicate via REST + SSE.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OpenClawAgentManager />
          </CardContent>
        </Card>

        {/* AI Agent API Keys */}
        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="theme-text-primary flex flex-wrap items-center gap-2">
              <Sparkles className="w-6 h-6 text-yellow-500" />
              <span>Agent API Keys</span>
            </CardTitle>
            <CardDescription className="theme-text-muted">
              The alternative runtime: add a provider API key and {BRAND.appName} runs the agent
              server-side — no harness, works from your phone. One provider is enough. Saving a
              key switches that agent to &ldquo;{BRAND.appName} runs it&rdquo; above.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* API Key Configuration */}
            <AIAPIKeyManager />
          </CardContent>
        </Card>

        {/* Self-hosted SDK, webhooks, GitHub App — collapsed; most users never need it */}
        <AdvancedAgentHosting />

        {/* List Instructions Tip */}
        <Card className="theme-bg-secondary theme-border border-dashed">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <FileText className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
              <div>
                <h4 className="font-medium theme-text-primary text-sm">Tip: Control agent behavior per list</h4>
                <p className="text-sm theme-text-muted mt-1">
                  Each list&apos;s <strong>description</strong> is used as instructions for AI agents working on tasks in that list.
                  Write markdown in your list description to tell agents how to handle tasks — like a project brief.
                </p>
                <p className="text-xs theme-text-muted mt-2">
                  Set the repository, default agent, and per-list loop in List Settings → Admin →
                  AI Agent; edit instructions under Description.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
