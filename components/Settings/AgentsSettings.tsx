"use client"

import { BRAND } from '@/lib/brand/config'
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AgentHub } from "@/components/agent-hub"
import { GitHubIntegrationSettings } from "@/components/github-integration-settings"
import { GitHubSharedSetup } from "@/components/github-shared-setup"
import { GitHubCopilotMcpSetup } from "@/components/github-copilot-mcp-setup"
import { CAPABILITIES } from "@/lib/brand/capabilities"
import { agentServiceLabel } from "@/lib/ai/agent-config"
import {
  Brain,
  FileText,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Github
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
        Add an API key or register a Custom Agent below to power {BRAND.appName}.
      </p>
    )
  }

  // Filter out Astrid itself — this selector picks the model that powers Astrid
  const modelOptions = agents.filter(a => a.email !== `astrid@${BRAND.agentEmailDomain}`)

  if (modelOptions.length === 0) {
    return (
      <p className="text-sm theme-text-muted">
        Add an API key or register a Custom Agent below to power {BRAND.appName}.
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
            <div className="text-xs theme-text-muted">
              Powered by {agentServiceLabel(agent.service)}
            </div>
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
 * The account-level GitHub App connection. Not agent-specific — every
 * server-run coding agent creates branches and PRs through it — so it sits
 * beside the agent list rather than inside any one row. Collapsed: connect
 * once, then never look at it again.
 */
function GithubConnectionCard() {
  const [open, setOpen] = useState(false)

  return (
    <Card className="theme-bg-secondary theme-border">
      <CardHeader>
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setOpen(!open)}
        >
          <div>
            <CardTitle className="theme-text-primary flex items-center gap-2">
              <Github className="w-5 h-5" />
              GitHub connection
            </CardTitle>
            <CardDescription className="theme-text-muted">
              Lets server-run agents create branches and pull requests. Pick the repository per
              list in List Settings → Admin.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm">
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4 pt-0">
          <GitHubSharedSetup />
          <GitHubIntegrationSettings />
        </CardContent>
      )}
    </Card>
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

        {/* THE list: every agent, and per agent the one decision — who runs it.
            Everything else (key, loop recipe, webhook) appears inline as the
            answer to that choice. */}
        <Card className="theme-bg-secondary theme-border border-green-500/30">
          <CardHeader>
            <CardTitle className="theme-text-primary flex flex-wrap items-center gap-2">
              <Bot className="w-6 h-6 text-green-500" />
              <span>Your agents</span>
            </CardTitle>
            <CardDescription className="theme-text-muted">
              Pick who runs each agent. <strong>{BRAND.appName} runs it</strong> needs that
              provider&apos;s API key. <strong>My harness polls</strong> uses the coding tool you
              already pay for — connect it once and put it on a loop. <strong>Webhook server</strong>{' '}
              pushes work to a machine you host.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AgentHub />
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

        {/* Account-level GitHub App — shared by every server-run coding agent */}
        <GithubConnectionCard />

        {CAPABILITIES.integrationMcp && <GitHubCopilotMcpSetup />}

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
