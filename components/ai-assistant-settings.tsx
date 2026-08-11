"use client"

import { BRAND } from '@/lib/brand/config'
import { useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Bot, AlertCircle, Key, ChevronRight, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

interface APIKeyStatus {
  [serviceId: string]: {
    hasKey: boolean
    isValid?: boolean
  }
}

interface ExploratoryFeaturesSettingsProps {
  onManageApiKeys?: () => void
  onAppleReminders?: () => void
}

export function ExploratoryFeaturesSettings({ onManageApiKeys, onAppleReminders }: ExploratoryFeaturesSettingsProps) {
  const [apiKeyStatus, setApiKeyStatus] = useState<APIKeyStatus>({})
  const [loading, setLoading] = useState(true)

  const hasValidApiKey = Object.values(apiKeyStatus).some(status => status.hasKey && status.isValid !== false)
  const configuredKeyCount = Object.values(apiKeyStatus).filter(status => status.hasKey).length

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/v1/users/me/ai-credentials')
      if (response.ok) {
        const data = await response.json()
        setApiKeyStatus(data.keys || {})
      }
    } catch (error) {
      console.error('Failed to load API keys:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Sparkles className="w-6 h-6 text-purple-600" />
        </div>
        <div>
          <div className="theme-text-primary font-semibold flex items-center gap-2">
            Exploratory Features
            <Badge variant="secondary" className="bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
              ALPHA
            </Badge>
          </div>
          <p className="text-sm theme-text-muted">
            Early access features in development
          </p>
        </div>
      </div>

      {/* AI Assistants */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium theme-text-primary flex items-center gap-2">
          <Bot className="w-4 h-4" />
          AI Assistants
        </h3>
        <button
          onClick={onManageApiKeys}
          className={cn(
            "w-full flex items-center justify-between p-3 rounded-lg",
            "theme-bg-secondary hover:bg-opacity-80 transition-colors",
            "border theme-border"
          )}
        >
          <div className="flex items-center gap-3">
            <Key className="w-5 h-5 text-amber-500" />
            <div className="text-left">
              <div className="text-sm font-medium theme-text-primary">Manage API Keys</div>
              <div className="text-xs theme-text-muted">
                {configuredKeyCount > 0
                  ? `${configuredKeyCount} key${configuredKeyCount > 1 ? 's' : ''} configured`
                  : 'Add Claude, OpenAI, or Gemini keys'
                }
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 theme-text-muted" />
        </button>

        {!hasValidApiKey && (
          <p className="text-xs theme-text-muted pl-1">
            API keys power AI responses when you assign tasks to agents like claude@{BRAND.agentEmailDomain}
          </p>
        )}
      </div>

      {/* Apple Reminders - iOS only feature, shown for completeness */}
      {onAppleReminders && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium theme-text-primary flex items-center gap-2">
            <span className="text-base">🍎</span>
            Apple Reminders
          </h3>
          <button
            onClick={onAppleReminders}
            className={cn(
              "w-full flex items-center justify-between p-3 rounded-lg",
              "theme-bg-secondary hover:bg-opacity-80 transition-colors",
              "border theme-border"
            )}
          >
            <div className="flex items-center gap-3">
              <span className="text-lg">📋</span>
              <div className="text-left">
                <div className="text-sm font-medium theme-text-primary">Configure Sync</div>
                <div className="text-xs theme-text-muted">
                  Sync with Siri and Apple Watch
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 theme-text-muted" />
          </button>
        </div>
      )}

      {/* Alpha Warning */}
      <Alert className="border-purple-200 bg-purple-50 dark:bg-purple-950 dark:border-purple-800">
        <AlertCircle className="h-4 w-4 text-purple-600" />
        <AlertDescription className="text-purple-800 dark:text-purple-200">
          These features are experimental and under active development.
        </AlertDescription>
      </Alert>
    </div>
  )
}

// Keep legacy export for backward compatibility
export function AIAssistantSettings() {
  return <ExploratoryFeaturesSettings />
}
