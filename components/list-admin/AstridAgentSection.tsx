"use client"

import { BRAND } from '@/lib/brand/config'
import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Bot } from "lucide-react"
import type { TaskList } from "@/types/task"

interface AstridAgentSectionProps {
  list: TaskList
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
}

/**
 * Astrid Agent selector for a list's admin settings: pick the AI agent
 * (model) that powers Astrid for this list. Self-loads the account's
 * available agents on mount; hidden when there are none. Extracted from
 * list-admin-settings.tsx (Stage 13).
 */
export function AstridAgentSection({ list, canEditSettings, onUpdate }: AstridAgentSectionProps) {
  const [availableAgents, setAvailableAgents] = useState<Array<{ id: string; name: string | null; email: string; image: string | null; service: string }>>([])
  const [listDefaultAgentId, setListDefaultAgentId] = useState<string | null>(() => {
    const config = list.aiAgentsEnabled
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      return (config as Record<string, unknown>).defaultAgentId as string || null
    }
    return null
  })

  useEffect(() => {
    fetch('/api/user/available-agents').then(r => r.json()).then(data => {
      setAvailableAgents(data.agents || [])
    }).catch(() => {})
  }, [])

  if (!canEditSettings || availableAgents.length === 0) return null

  return (
    <div className="space-y-2">
      <Label className="text-sm theme-text-secondary flex items-center space-x-1.5">
        <Bot className="w-4 h-4" />
        <span>{BRAND.appName} Agent</span>
      </Label>
      <Select
        value={listDefaultAgentId || '_account_default'}
        onValueChange={(value) => {
          const newAgentId = value === '_account_default' ? null : value
          setListDefaultAgentId(newAgentId)
          // Build the updated aiAgentsEnabled config
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
        Choose a model to power {BRAND.appName} for this list. {BRAND.appName} reads messages, acts on tasks, and completes tasks by their due dates.
      </p>
    </div>
  )
}
