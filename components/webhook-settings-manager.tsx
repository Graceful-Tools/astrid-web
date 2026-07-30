"use client"

import { BRAND } from '@/lib/brand/config'
import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { useTranslations } from "@/lib/i18n/client"
import {
  Webhook,
  Copy,
  Check,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Eye,
  EyeOff,
  Send,
  Trash2,
  Shield
} from "lucide-react"

interface WebhookConfig {
  configured: boolean
  enabled?: boolean
  webhookUrl?: string
  hasSecret?: boolean
  events?: string[]
  agents?: string[]
  failureCount?: number
  lastFiredAt?: string
  availableAgents?: string[]
}

const AGENT_CONFIG: Record<string, {
  label: string
  selectedClass: string
  dotClass: string
  badgeClass: string
}> = {
  claude: {
    label: 'Claude',
    selectedClass: 'bg-purple-500/20 text-purple-400 border-purple-500/50',
    dotClass: 'bg-purple-500',
    badgeClass: 'text-purple-400 border-purple-500/50'
  },
  openai: {
    label: 'OpenAI',
    selectedClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50',
    dotClass: 'bg-emerald-500',
    badgeClass: 'text-emerald-400 border-emerald-500/50'
  },
  gemini: {
    label: 'Gemini',
    selectedClass: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
    dotClass: 'bg-blue-500',
    badgeClass: 'text-blue-400 border-blue-500/50'
  },
  copilot: {
    label: 'GitHub Copilot',
    selectedClass: 'bg-slate-500/20 text-slate-300 border-slate-500/50',
    dotClass: 'bg-slate-400',
    badgeClass: 'text-slate-300 border-slate-500/50'
  }
}

interface TestResult {
  success: boolean
  message: string
  responseTime?: number
  statusCode?: number
  error?: string
}

export function WebhookSettingsManager() {
  const { t } = useTranslations()
  const [config, setConfig] = useState<WebhookConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  // Form state
  const [webhookUrl, setWebhookUrl] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [selectedAgents, setSelectedAgents] = useState<string[]>([])
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [showSecret, setShowSecret] = useState(false)
  const [copied, setCopied] = useState(false)
  const [regenerateSecret, setRegenerateSecret] = useState(false)

  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/user/webhook-settings")
      if (response.ok) {
        const data = await response.json()
        setConfig(data)
        if (data.webhookUrl) {
          setWebhookUrl(data.webhookUrl)
        }
        if (data.enabled !== undefined) {
          setEnabled(data.enabled)
        }
        if (data.agents) {
          setSelectedAgents(data.agents)
        }
      }
    } catch (error) {
      console.error("Failed to fetch webhook config:", error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const handleSave = async () => {
    setSaving(true)
    setNewSecret(null)
    try {
      const response = await fetch("/api/user/webhook-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl,
          enabled,
          regenerateSecret,
          events: ["task.assigned", "comment.created"],
          agents: selectedAgents
        })
      })

      const data = await response.json()

      if (response.ok) {
        if (data.webhookSecret) {
          setNewSecret(data.webhookSecret)
          setShowSecret(true)
        }
        setRegenerateSecret(false)
        await fetchConfig()
      } else {
        console.error("Failed to save webhook config:", data.error)
      }
    } catch (error) {
      console.error("Failed to save webhook config:", error)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const response = await fetch("/api/user/webhook-settings", {
        method: "POST"
      })
      const data = await response.json()
      setTestResult(data)
    } catch (error) {
      setTestResult({
        success: false,
        message: "Failed to test webhook",
        error: String(error)
      })
    } finally {
      setTesting(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to remove your webhook configuration?")) {
      return
    }

    setSaving(true)
    try {
      const response = await fetch("/api/user/webhook-settings", {
        method: "DELETE"
      })

      if (response.ok) {
        setConfig({ configured: false })
        setWebhookUrl("")
        setEnabled(true)
        setNewSecret(null)
      }
    } catch (error) {
      console.error("Failed to delete webhook config:", error)
    } finally {
      setSaving(false)
    }
  }

  const copySecret = async () => {
    if (newSecret) {
      await navigator.clipboard.writeText(newSecret)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (loading) {
    return (
      <Card className="theme-bg-secondary theme-border">
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin theme-text-muted" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Main Configuration Card */}
      <Card className="theme-bg-secondary theme-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 theme-text-primary">
            <Webhook className="w-5 h-5" />
            Webhook Configuration
          </CardTitle>
          <CardDescription className="theme-text-muted">
            Configure a webhook URL to receive task notifications on your Claude Code Remote server
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Webhook URL */}
          <div className="space-y-2">
            <Label htmlFor="webhookUrl" className="theme-text-primary">Webhook URL</Label>
            <Input
              id="webhookUrl"
              type="url"
              placeholder="https://your-server.com/webhook"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="theme-bg-primary theme-border theme-text-primary"
            />
            <p className="text-sm theme-text-muted">
              The URL of your Claude Code Remote server that will receive webhook notifications
            </p>
          </div>

          {/* Enabled Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="theme-text-primary">Enabled</Label>
              <p className="text-sm theme-text-muted">
                When enabled, webhooks will be sent for task assignments
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          {/* Agent Selection */}
          <div className="space-y-3">
            <div className="space-y-0.5">
              <Label className="theme-text-primary">Agents to Handle</Label>
              <p className="text-sm theme-text-muted">
                Select which AI agents this webhook should handle. Unselected agents will be handled by polling mode instead.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(AGENT_CONFIG).map(([agent, config]) => {
                const isSelected = selectedAgents.includes(agent)
                return (
                  <button
                    key={agent}
                    type="button"
                    onClick={() => {
                      if (isSelected) {
                        setSelectedAgents(prev => prev.filter(a => a !== agent))
                      } else {
                        setSelectedAgents(prev => [...prev, agent])
                      }
                    }}
                    className={`
                      px-3 py-1.5 rounded-full text-sm font-medium transition-all border
                      ${isSelected
                        ? config.selectedClass
                        : 'bg-gray-500/10 text-gray-400 border-gray-500/30 hover:border-gray-400/50'
                      }
                    `}
                  >
                    <span className={`inline-block w-2 h-2 rounded-full mr-2 ${isSelected ? config.dotClass : 'bg-gray-500'}`}></span>
                    {config.label}
                    {isSelected && <Check className="inline-block w-3 h-3 ml-1" />}
                  </button>
                )
              })}
            </div>
            {selectedAgents.length === 0 && (
              <p className="text-sm text-amber-500">
                No agents selected. All tasks will be handled by polling mode.
              </p>
            )}
          </div>

          {/* Regenerate Secret Option (only show if already configured) */}
          {config?.configured && config?.hasSecret && (
            <div className="flex items-center justify-between p-4 theme-bg-tertiary rounded-lg">
              <div className="space-y-0.5">
                <Label className="theme-text-primary flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Webhook Secret
                </Label>
                <p className="text-sm theme-text-muted">
                  Regenerate the secret used for HMAC signature verification
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={regenerateSecret}
                  onCheckedChange={setRegenerateSecret}
                />
                <span className="text-sm theme-text-muted">Regenerate on save</span>
              </div>
            </div>
          )}

          {/* Save Button */}
          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={saving || !webhookUrl}
              className="flex-1"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  {config?.configured ? "Update Configuration" : "Save Configuration"}
                </>
              )}
            </Button>

            {config?.configured && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={saving}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* New Secret Display (shown after save) */}
      {newSecret && (
        <Card className="theme-bg-secondary border-yellow-500 border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-500">
              <AlertCircle className="w-5 h-5" />
              Save Your Webhook Secret
            </CardTitle>
            <CardDescription className="theme-text-muted">
              This secret will only be shown once. Copy it now and add it to your Claude Code Remote server&apos;s environment variables.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex-1 p-3 theme-bg-primary rounded-lg font-mono text-sm theme-text-primary break-all">
                {showSecret ? newSecret : "•".repeat(40)}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowSecret(!showSecret)}
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={copySecret}
              >
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <div className="p-3 theme-bg-tertiary rounded-lg">
              <p className="text-sm theme-text-muted mb-2">Add to your <code>.env</code> file:</p>
              <code className="text-sm theme-text-primary">ASTRID_WEBHOOK_SECRET={newSecret}</code>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status Card (only if configured) */}
      {config?.configured && (
        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 theme-text-primary">
              Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="theme-text-muted text-sm">Status</Label>
                <div className="flex items-center gap-2">
                  {config.enabled ? (
                    <Badge variant="default" className="bg-green-500">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      Disabled
                    </Badge>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label className="theme-text-muted text-sm">Failure Count</Label>
                <div className="flex items-center gap-2">
                  {(config.failureCount ?? 0) > 0 ? (
                    <Badge variant="destructive">
                      {config.failureCount} failures
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="theme-text-primary">
                      No failures
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {config.lastFiredAt && (
              <div className="space-y-1">
                <Label className="theme-text-muted text-sm">Last Fired</Label>
                <p className="theme-text-primary text-sm">
                  {new Date(config.lastFiredAt).toLocaleString()}
                </p>
              </div>
            )}

            <div className="space-y-1">
              <Label className="theme-text-muted text-sm">Agents Handled by Webhook</Label>
              <div className="flex flex-wrap gap-2">
                {config.agents && config.agents.length > 0 ? (
                  config.agents.map((agent) => {
                    const agentInfo = AGENT_CONFIG[agent] || { label: agent, badgeClass: 'text-gray-400 border-gray-500/50' }
                    return (
                      <Badge key={agent} variant="outline" className={agentInfo.badgeClass}>
                        {agentInfo.label}
                      </Badge>
                    )
                  })
                ) : (
                  <span className="text-sm text-amber-500">None (all tasks go to polling)</span>
                )}
              </div>
              {config.agents && config.agents.length > 0 && config.agents.length < 3 && (
                <p className="text-xs theme-text-muted mt-1">
                  Other agents will be handled by polling mode
                </p>
              )}
            </div>

            {config.events && config.events.length > 0 && (
              <div className="space-y-1">
                <Label className="theme-text-muted text-sm">Subscribed Events</Label>
                <div className="flex flex-wrap gap-2">
                  {config.events.map((event) => (
                    <Badge key={event} variant="outline" className="theme-text-primary">
                      {event}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Test Webhook Button */}
            <div className="pt-4 border-t theme-border">
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={testing || !config.enabled}
                className="w-full"
              >
                {testing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Test Webhook
                  </>
                )}
              </Button>
            </div>

            {/* Test Result */}
            {testResult && (
              <div className={`p-4 rounded-lg ${testResult.success ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                <div className="flex items-start gap-2">
                  {testResult.success ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                  )}
                  <div>
                    <p className={`font-medium ${testResult.success ? 'text-green-500' : 'text-red-500'}`}>
                      {testResult.message}
                    </p>
                    {testResult.responseTime && (
                      <p className="text-sm theme-text-muted">
                        Response time: {testResult.responseTime}ms
                      </p>
                    )}
                    {testResult.statusCode && (
                      <p className="text-sm theme-text-muted">
                        Status code: {testResult.statusCode}
                      </p>
                    )}
                    {testResult.error && (
                      <p className="text-sm text-red-400 mt-1">
                        Error: {testResult.error}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Documentation Card */}
      <Card className="theme-bg-secondary theme-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 theme-text-primary">
            Documentation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium theme-text-primary">What is Claude Code Remote?</h4>
            <p className="text-sm theme-text-muted">
              Claude Code Remote allows you to run a self-hosted server that receives task notifications
              and executes them using the Claude Code CLI on your own infrastructure. This gives you
              full access to CLI capabilities like file editing, git operations, and bash commands.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium theme-text-primary">Getting Started</h4>
            <ol className="list-decimal list-inside text-sm theme-text-muted space-y-1">
              <li>Deploy the Claude Code Remote server package</li>
              <li>Configure your webhook URL above</li>
              <li>Copy the webhook secret to your server&apos;s environment</li>
              <li>Assign tasks to <code className="px-1 py-0.5 theme-bg-tertiary rounded">claude@{BRAND.agentEmailDomain}</code></li>
            </ol>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium theme-text-primary">Webhook Events</h4>
            <ul className="list-disc list-inside text-sm theme-text-muted space-y-1">
              <li><code className="px-1 py-0.5 theme-bg-tertiary rounded">task.assigned</code> - Task assigned to AI agent</li>
              <li><code className="px-1 py-0.5 theme-bg-tertiary rounded">comment.created</code> - User commented on AI task</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
