"use client"

import { BRAND } from '@/lib/brand/config'
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AIAPIKeyManager } from "@/components/ai-api-key-manager"
import { OpenClawAgentManager } from "@/components/openclaw-agent-manager"
import {
  Brain,
  Sparkles,
  Cloud,
  FileText,
  Bot,
  Check
} from "lucide-react"
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
      fetch('/api/user/available-agents').then(r => r.json()),
      fetch('/api/user/ai-assistant-settings').then(r => r.json()),
    ]).then(([agentsData, settingsData]) => {
      setAgents(agentsData.agents || [])
      setCurrentAgentId(settingsData.defaultAgentId || null)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleSelect = async (agentId: string | null) => {
    setCurrentAgentId(agentId)
    await fetch('/api/user/ai-assistant-settings', {
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

export default function AgentsSettings({ onNavigate }: AgentsSettingsProps) {
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

        {/* Astrid — default agent for private lists */}
        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="theme-text-primary flex flex-wrap items-center gap-2">
              <Image src={BRAND.iconSmall} alt={BRAND.appName} width={24} height={24} className="rounded-full" />
              <span>{BRAND.appName}</span>
            </CardTitle>
            <CardDescription className="theme-text-muted">
              Choose a model to power {BRAND.appName}. Mention <strong>@astrid</strong> in any chat or comment to get help.
              {BRAND.appName} can read tasks across your lists, respond to messages, and complete tasks before their due dates.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AstridAgentSelector />
          </CardContent>
        </Card>

        {/* Cloud Agents link */}
        <Card
          className="theme-bg-secondary theme-border cursor-pointer hover:scale-[1.02] transition-transform"
          onClick={() => onNavigate('coding-agents')}
        >
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl">
                <Cloud className="w-8 h-8 text-indigo-500" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold theme-text-primary text-lg">
                  Cloud Agent Settings
                </h3>
                <p className="text-sm theme-text-muted mt-1">
                  Self-hosted SDK agents with GitHub integration
                </p>
              </div>
            </div>
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
              Add your API keys to enable AI agents (claude/openai/gemini/copilot@{BRAND.agentEmailDomain}).
              You only need to configure one provider.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* API Key Configuration */}
            <AIAPIKeyManager />
          </CardContent>
        </Card>

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
                  Edit descriptions in List Settings → Admin → Description
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
