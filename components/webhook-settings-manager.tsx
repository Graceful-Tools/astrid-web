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
import { RichMessage, fillMessage } from "@/components/shared/RichMessage"
import Link from "next/link"
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
    selectedClass: 'bg-category-purple/20 text-category-purple border-category-purple/50',
    dotClass: 'bg-category-purple',
    badgeClass: 'text-category-purple border-category-purple/50'
  },
  openai: {
    label: 'OpenAI',
    selectedClass: 'bg-category-green/20 text-category-green border-category-green/50',
    dotClass: 'bg-category-green',
    badgeClass: 'text-category-green border-category-green/50'
  },
  gemini: {
    label: 'Gemini',
    selectedClass: 'bg-category-blue/20 text-category-blue border-category-blue/50',
    dotClass: 'bg-category-blue',
    badgeClass: 'text-category-blue border-category-blue/50'
  },
  copilot: {
    label: 'GitHub Copilot',
    selectedClass: 'bg-theme-active text-theme-secondary border-theme-strong',
    dotClass: 'bg-current text-theme-muted',
    badgeClass: 'text-theme-secondary border-theme-strong'
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
      const response = await fetch("/api/v1/users/me/webhook-settings")
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
      const response = await fetch("/api/v1/users/me/webhook-settings", {
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
      const response = await fetch("/api/v1/users/me/webhook-settings", {
        method: "POST"
      })
      const data = await response.json()
      setTestResult(data)
    } catch (error) {
      setTestResult({
        success: false,
        message: t('settingsPages.aiAgents.webhook.testFailed'),
        error: String(error)
      })
    } finally {
      setTesting(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(t('settingsPages.aiAgents.webhook.confirmRemove'))) {
      return
    }

    setSaving(true)
    try {
      const response = await fetch("/api/v1/users/me/webhook-settings", {
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
            {t('settingsPages.aiAgents.webhook.title')}
          </CardTitle>
          <CardDescription className="theme-text-muted">
            {t('settingsPages.aiAgents.webhook.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Webhook URL */}
          <div className="space-y-2">
            <Label htmlFor="webhookUrl" className="theme-text-primary">{t('settingsPages.aiAgents.webhook.urlLabel')}</Label>
            <Input
              id="webhookUrl"
              type="url"
              placeholder="https://your-server.com/webhook"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="theme-bg-primary theme-border theme-text-primary"
            />
            <p className="text-sm theme-text-muted">
              {t('settingsPages.aiAgents.webhook.urlHint')}
            </p>
          </div>

          {/* Enabled Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="theme-text-primary">{t('settingsPages.aiAgents.webhook.enabledLabel')}</Label>
              <p className="text-sm theme-text-muted">
                {t('settingsPages.aiAgents.webhook.enabledHint')}
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
              <Label className="theme-text-primary">{t('settingsPages.aiAgents.webhook.agentsLabel')}</Label>
              <p className="text-sm theme-text-muted">
                {t('settingsPages.aiAgents.webhook.agentsHint')}
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
                        : 'bg-theme-tertiary text-theme-muted border-theme-surface hover:border-theme-strong'
                      }
                    `}
                  >
                    <span className={`inline-block w-2 h-2 rounded-full mr-2 ${isSelected ? config.dotClass : 'bg-theme-active'}`}></span>
                    {config.label}
                    {isSelected && <Check className="inline-block w-3 h-3 ml-1" />}
                  </button>
                )
              })}
            </div>
            {selectedAgents.length === 0 && (
              <p className="text-sm text-warning">
                {t('settingsPages.aiAgents.webhook.noAgents')}
              </p>
            )}
          </div>

          {/* Regenerate Secret Option (only show if already configured) */}
          {config?.configured && config?.hasSecret && (
            <div className="flex items-center justify-between p-4 theme-bg-tertiary rounded-lg">
              <div className="space-y-0.5">
                <Label className="theme-text-primary flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  {t('settingsPages.aiAgents.webhook.secretLabel')}
                </Label>
                <p className="text-sm theme-text-muted">
                  {t('settingsPages.aiAgents.webhook.secretHint')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={regenerateSecret}
                  onCheckedChange={setRegenerateSecret}
                />
                <span className="text-sm theme-text-muted">{t('settingsPages.aiAgents.webhook.regenerateOnSave')}</span>
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
                  {t('settingsPages.profileInfo.saving')}
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  {t(config?.configured ? 'settingsPages.aiAgents.webhook.updateConfig' : 'settingsPages.aiAgents.webhook.saveConfig')}
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
        <Card className="theme-bg-secondary border-warning border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-warning">
              <AlertCircle className="w-5 h-5" />
              {t('settingsPages.aiAgents.webhook.saveSecretTitle')}
            </CardTitle>
            <CardDescription className="theme-text-muted">
              {t('settingsPages.aiAgents.webhook.secretShownOnce')}
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
                {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <div className="p-3 theme-bg-tertiary rounded-lg">
              <p className="text-sm theme-text-muted mb-2">{t('settingsPages.aiAgents.webhook.envHint').split('{file}')[0]}<code>.env</code>{t('settingsPages.aiAgents.webhook.envHint').split('{file}')[1]}</p>
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
              {t('tasks.status')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="theme-text-muted text-sm">{t('tasks.status')}</Label>
                <div className="flex items-center gap-2">
                  {config.enabled ? (
                    <Badge variant="default" className="bg-success">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      {t('settingsPages.connections.status.active')}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      {t('settingsPages.connections.status.disabled')}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label className="theme-text-muted text-sm">{t('settingsPages.aiAgents.webhook.failureCount')}</Label>
                <div className="flex items-center gap-2">
                  {(config.failureCount ?? 0) > 0 ? (
                    <Badge variant="destructive">
                      {t('settingsPages.aiAgents.webhook.failuresCount', { count: String(config.failureCount) })}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="theme-text-primary">
                      {t('settingsPages.aiAgents.webhook.noFailures')}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {config.lastFiredAt && (
              <div className="space-y-1">
                <Label className="theme-text-muted text-sm">{t('settingsPages.aiAgents.webhook.lastFired')}</Label>
                <p className="theme-text-primary text-sm">
                  {new Date(config.lastFiredAt).toLocaleString()}
                </p>
              </div>
            )}

            <div className="space-y-1">
              <Label className="theme-text-muted text-sm">{t('settingsPages.aiAgents.webhook.agentsHandled')}</Label>
              <div className="flex flex-wrap gap-2">
                {config.agents && config.agents.length > 0 ? (
                  config.agents.map((agent) => {
                    const agentInfo = AGENT_CONFIG[agent] || { label: agent, badgeClass: 'text-theme-muted border-theme-strong' }
                    return (
                      <Badge key={agent} variant="outline" className={agentInfo.badgeClass}>
                        {agentInfo.label}
                      </Badge>
                    )
                  })
                ) : (
                  <span className="text-sm text-warning">{t('settingsPages.aiAgents.webhook.noneAllPolling')}</span>
                )}
              </div>
              {config.agents && config.agents.length > 0 && config.agents.length < 3 && (
                <p className="text-xs theme-text-muted mt-1">
                  {t('settingsPages.aiAgents.webhook.otherAgentsPolling')}
                </p>
              )}
            </div>

            {config.events && config.events.length > 0 && (
              <div className="space-y-1">
                <Label className="theme-text-muted text-sm">{t('settingsPages.aiAgents.webhook.subscribedEvents')}</Label>
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
                    {t('settingsPages.aiAgents.webhook.testing')}
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    {t('settingsPages.aiAgents.webhook.test')}
                  </>
                )}
              </Button>
            </div>

            {/* Test Result */}
            {testResult && (
              <div className={`p-4 rounded-lg ${testResult.success ? 'bg-success-subtle border border-success/30' : 'bg-danger-subtle border border-danger/30'}`}>
                <div className="flex items-start gap-2">
                  {testResult.success ? (
                    <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-danger flex-shrink-0" />
                  )}
                  <div>
                    <p className={`font-medium ${testResult.success ? 'text-success' : 'text-danger'}`}>
                      {testResult.message}
                    </p>
                    {testResult.responseTime && (
                      <p className="text-sm theme-text-muted">
                        {t('settingsPages.aiAgents.webhook.responseTime', { time: String(testResult.responseTime) })}
                      </p>
                    )}
                    {testResult.statusCode && (
                      <p className="text-sm theme-text-muted">
                        {t('settingsPages.aiAgents.webhook.statusCode', { code: String(testResult.statusCode) })}
                      </p>
                    )}
                    {testResult.error && (
                      <p className="text-sm text-danger mt-1">
                        {fillMessage(t('settingsPages.aiAgents.webhook.errorDetail'), { error: testResult.error })}
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
            {t('settingsPages.aiAgents.webhook.documentation')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium theme-text-primary">{t('settingsPages.aiAgents.webhook.aboutTitle')}</h4>
            <p className="text-sm theme-text-muted">
              {t('settingsPages.aiAgents.webhook.aboutBody')}
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium theme-text-primary">{t('settingsPages.aiAgents.webhook.gettingStarted')}</h4>
            <ol className="list-decimal list-inside text-sm theme-text-muted space-y-1">
              <li>
                <RichMessage
                  message={t('settingsPages.aiAgents.webhook.stepReceiver')}
                  values={{
                    sdk: (
                      <a
                        href="https://www.npmjs.com/package/@gracefultools/astrid-sdk"
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand hover:underline"
                      >
                        {BRAND.appName} SDK
                      </a>
                    ),
                  }}
                />
              </li>
              <li>{t('settingsPages.aiAgents.webhook.stepConfigureUrl')}</li>
              <li>{t('settingsPages.aiAgents.webhook.stepCopySecret')}</li>
              <li>{t('settingsPages.aiAgents.webhook.stepAssign').split('{agent}')[0]}<code className="px-1 py-0.5 theme-bg-tertiary rounded">claude@{BRAND.agentEmailDomain}</code>{t('settingsPages.aiAgents.webhook.stepAssign').split('{agent}')[1]}</li>
            </ol>
            <p className="text-sm theme-text-muted">
              <RichMessage
                message={t('settingsPages.aiAgents.webhook.guidedSetup')}
                values={{
                  selfRuns: t('settingsPages.aiAgents.yourAgents.selfRuns'),
                  nativeHarness: t('settingsPages.aiAgents.hub.transportNative'),
                  settings: t('settings.settings'),
                  aiAgents: t('settingsPages.aiAgents.title'),
                  recipes: (
                    <Link href="/docs/loops" className="text-brand hover:underline">
                      {t('settingsPages.aiAgents.webhook.recipesLink')}
                    </Link>
                  ),
                }}
              />
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium theme-text-primary">{t('settingsPages.aiAgents.webhook.eventsTitle')}</h4>
            <ul className="list-disc list-inside text-sm theme-text-muted space-y-1">
              <li><code className="px-1 py-0.5 theme-bg-tertiary rounded">task.assigned</code> - {t('settingsPages.aiAgents.webhook.eventTaskAssigned')}</li>
              <li><code className="px-1 py-0.5 theme-bg-tertiary rounded">comment.created</code> - {t('settingsPages.aiAgents.webhook.eventCommentCreated')}</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
