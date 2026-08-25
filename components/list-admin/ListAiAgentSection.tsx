"use client"

import { BRAND } from '@/lib/brand/config'
import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Bot, ChevronDown, ChevronUp, Github, RefreshCw, Repeat } from "lucide-react"
import { AgentLoopRecipes } from "@/components/agent-runtime-settings"
import type { TaskList } from "@/types/task"

interface ListAiAgentSectionProps {
  list: TaskList
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
}

/**
 * Everything AI about ONE list, in one place: the model that powers the
 * assistant here, the repository a coding agent works against, and the loop
 * that works this board on a schedule.
 *
 * Merged from AstridAgentSection + GithubIntegrationSection, which sat in the
 * same tab as two unrelated-looking controls — and the repo picker hid itself
 * behind a provider filter that did not know Copilot existed, so a
 * Copilot-only account could never set a repository at all. The gate is now
 * the only thing it should have been: may this user edit the list, and is
 * GitHub connected. Providers gate which agent RUNS, not whether a repo can
 * be chosen — polling-mode agents need no provider here at all.
 */
export function ListAiAgentSection({ list, canEditSettings, onUpdate }: ListAiAgentSectionProps) {
  // --- assistant model (aiAgentsEnabled.defaultAgentId) ---
  const [availableAgents, setAvailableAgents] = useState<Array<{ id: string; name: string | null; email: string; image: string | null; service: string }>>([])
  const [listDefaultAgentId, setListDefaultAgentId] = useState<string | null>(() => {
    const config = list.aiAgentsEnabled
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      return (config as Record<string, unknown>).defaultAgentId as string || null
    }
    return null
  })

  // --- coding-agent repository (githubRepositoryId) ---
  const [tempGithubRepositoryId, setTempGithubRepositoryId] = useState<string | null>(list.githubRepositoryId || null)
  const [availableRepositories, setAvailableRepositories] = useState<Array<{ id: string; name: string; fullName: string }>>([])
  const [loadingRepositories, setLoadingRepositories] = useState(false)
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null)

  // --- per-list loop recipes ---
  const [showLoop, setShowLoop] = useState(false)
  const [origin, setOrigin] = useState(`https://${BRAND.domain}`)

  const loadRepositories = async (refresh = false) => {
    try {
      setLoadingRepositories(true)
      const url = refresh ? '/api/v1/github/repositories?refresh=true' : '/api/v1/github/repositories'
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        setAvailableRepositories(data.repositories || [])
      }
    } catch (error) {
      console.error('Error loading repositories:', error)
    } finally {
      setLoadingRepositories(false)
    }
  }

  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin)

    fetch('/api/v1/users/me/available-agents').then(r => r.json()).then(data => {
      setAvailableAgents(data.agents || [])
    }).catch(() => {})

    fetch('/api/v1/github/status').then(r => r.json()).then(data => {
      setGithubConnected(!!data.isGitHubConnected)
    }).catch(() => setGithubConnected(false))

    loadRepositories()
  }, [])

  if (!canEditSettings) return null

  return (
    <div className="border-t theme-border pt-4 space-y-4">
      <div className="flex items-center space-x-2">
        <Bot className="w-4 h-4 text-blue-600" />
        <Label className="text-sm font-medium theme-text-primary">AI Agent</Label>
      </div>

      {/* Assistant model for this list. Server-run, so it needs a keyed agent —
          hidden rather than disabled when the account has none. */}
      {availableAgents.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm theme-text-secondary">{BRAND.appName} model for this list</Label>
          <Select
            value={listDefaultAgentId || '_account_default'}
            onValueChange={(value) => {
              const newAgentId = value === '_account_default' ? null : value
              setListDefaultAgentId(newAgentId)
              const currentTypes = Array.isArray(list.aiAgentsEnabled)
                ? list.aiAgentsEnabled
                : (list.aiAgentsEnabled as Record<string, unknown>)?.enabledTypes || []
              const updatedConfig = {
                enabledTypes: currentTypes,
                defaultAgentId: newAgentId,
              }
              onUpdate({ ...list, aiAgentsEnabled: updatedConfig as unknown as string[] })
            }}
          >
            <SelectTrigger className="theme-bg-tertiary theme-border theme-text-primary">
              <SelectValue placeholder="Use account default" />
            </SelectTrigger>
            <SelectContent className="theme-bg-primary theme-border z-[10100]">
              <SelectItem value="_account_default" className="theme-text-primary">
                Use account default
              </SelectItem>
              {availableAgents.map(agent => (
                <SelectItem key={agent.id} value={agent.id} className="theme-text-primary">
                  <div className="flex items-center gap-2">
                    {agent.image ? (
                      <img src={agent.image} alt="" className="w-4 h-4 rounded-full" />
                    ) : (
                      <Bot className="w-4 h-4 text-purple-500" />
                    )}
                    <span>{agent.name || agent.email}</span>
                    <span className="text-xs theme-text-muted">({agent.service})</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs theme-text-muted">
            Powers {BRAND.appName} in this list&apos;s chat and comments. Coding agents assigned to
            tasks keep their own runtime.
          </p>
        </div>
      )}

      {/* Repository the coding agent works against */}
      {githubConnected ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm theme-text-secondary">Repository the coding agent works in</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadRepositories(true)}
              disabled={loadingRepositories}
              className="text-xs px-2 py-1"
            >
              <RefreshCw className={`w-3 h-3 ${loadingRepositories ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <Select
            value={tempGithubRepositoryId || "none"}
            onValueChange={(value) => {
              const repoId = value === "none" ? null : value
              setTempGithubRepositoryId(repoId)
              onUpdate({ ...list, githubRepositoryId: repoId })
            }}
            disabled={loadingRepositories}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={loadingRepositories ? "Loading..." : "Select repo"} />
            </SelectTrigger>
            <SelectContent className="z-[10100] max-w-[300px]">
              <SelectItem value="none">None</SelectItem>
              {availableRepositories.map((repo) => (
                <SelectItem key={repo.fullName} value={repo.fullName}>
                  <div className="truncate max-w-[250px]" title={repo.name}>
                    {repo.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {availableRepositories.length === 0 && !loadingRepositories && (
            <div className="text-xs theme-text-muted">
              No repositories found. Check that the GitHub App has access to your repositories.
            </div>
          )}
        </div>
      ) : githubConnected === false ? (
        <p className="text-xs theme-text-muted flex items-center gap-1.5">
          <Github className="w-3.5 h-3.5" />
          <span>
            Connect GitHub to pick the repository a coding agent works in —{' '}
            <Link href="/settings/agents" className="text-blue-500 hover:underline">
              Settings → AI Agents → Advanced
            </Link>
          </span>
        </p>
      ) : null}

      {/* Loop this board — the queue endpoint scopes by listId, so the pasted
          command works exactly this list and nothing else. */}
      <div className="space-y-2">
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm theme-text-secondary hover:theme-text-primary"
          onClick={() => setShowLoop(!showLoop)}
        >
          <Repeat className="w-3.5 h-3.5" />
          <span>Run a loop for this list</span>
          {showLoop ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {showLoop && (
          <div className="pt-1">
            <p className="text-xs theme-text-muted mb-2">
              Your coding harness checks this list on a schedule and works whatever is assigned to
              it and marked <strong>Ready</strong>. Tasks on other boards are never touched.
            </p>
            <AgentLoopRecipes origin={origin} listId={list.id} />
          </div>
        )}
      </div>

      <p className="text-xs theme-text-muted">
        Agents read this list&apos;s <strong>description</strong> as their working instructions —
        edit it above like a project brief.
      </p>
    </div>
  )
}
