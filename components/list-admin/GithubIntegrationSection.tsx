"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Bot, RefreshCw } from "lucide-react"
import type { TaskList } from "@/types/task"

interface GithubIntegrationSectionProps {
  list: TaskList
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
}

/**
 * GitHub Integration control for a list's admin settings: pick the repo
 * an AI agent works against. Self-loads the account's AI providers
 * (which gate visibility) and repositories on mount. Extracted from
 * list-admin-settings.tsx (Stage 13 of the god-file refactor).
 */
export function GithubIntegrationSection({
  list,
  canEditSettings,
  onUpdate,
}: GithubIntegrationSectionProps) {
  const [tempGithubRepositoryId, setTempGithubRepositoryId] = useState<string | null>(list.githubRepositoryId || null)
  const [availableRepositories, setAvailableRepositories] = useState<Array<{ id: string; name: string; fullName: string }>>([])
  const [loadingRepositories, setLoadingRepositories] = useState(false)
  // AI providers state determines whether GitHub integration is shown.
  const [availableAiProviders, setAvailableAiProviders] = useState<Array<{ id: string; name: string }>>([])
  const [, setLoadingAiProviders] = useState(false)

  // Load available AI providers (determines if GitHub integration shows).
  const loadAiProviders = async () => {
    try {
      setLoadingAiProviders(true)
      const response = await fetch('/api/v1/github/status')
      if (response.ok) {
        const data = await response.json()
        const providers = [
          { id: 'claude', name: 'Claude Code Agent' },
          { id: 'openai', name: 'OpenAI Codex Agent' },
          { id: 'gemini', name: 'Gemini AI Agent' }
        ].filter(provider => data.aiProviders?.includes(provider.id))
        setAvailableAiProviders(providers)
        console.log(`🤖 Found ${providers.length} AI providers configured`)
      }
    } catch (error) {
      console.error('Error loading AI providers:', error)
    } finally {
      setLoadingAiProviders(false)
    }
  }

  const loadRepositories = async (refresh = false) => {
    try {
      setLoadingRepositories(true)
      const url = refresh ? '/api/v1/github/repositories?refresh=true' : '/api/v1/github/repositories'
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        setAvailableRepositories(data.repositories || [])
        console.log(`📦 Loaded ${data.repositories?.length || 0} repositories (cached: ${data.cached !== false})`)
      }
    } catch (error) {
      console.error('Error loading repositories:', error)
    } finally {
      setLoadingRepositories(false)
    }
  }

  useEffect(() => {
    loadAiProviders()
    loadRepositories()
  }, [])

  if (!canEditSettings || availableAiProviders.length === 0) return null

  return (
    <div className="border-t theme-border pt-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Bot className="w-4 h-4 text-blue-600" />
            <Label className="text-sm font-medium theme-text-primary">AI Coding Agent</Label>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadRepositories(true)}
            disabled={loadingRepositories}
            className="text-xs px-2 py-1"
          >
            {loadingRepositories ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
          </Button>
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-sm theme-text-secondary">Repository the AI coding agent works in</Label>
          <Select
            value={tempGithubRepositoryId || "none"}
            onValueChange={(value) => {
              const repoId = value === "none" ? null : value
              setTempGithubRepositoryId(repoId)
              onUpdate({ ...list, githubRepositoryId: repoId })
            }}
            disabled={loadingRepositories}
          >
            <SelectTrigger className="w-full max-w-[180px] min-w-[120px]">
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
        </div>

        {availableRepositories.length === 0 && !loadingRepositories && (
          <div className="text-xs theme-text-muted">
            No repositories found. Make sure your GitHub account is connected and has access to repositories.
          </div>
        )}
      </div>
    </div>
  )
}
