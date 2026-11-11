"use client"

/**
 * The agents page's one list: every agent, and per agent the ONE question that
 * decides everything else — who OWNS the runtime.
 *
 *   Astrid runs it → the key for THAT provider, inline. Nothing else.
 *   I run it       → the transport choice (native harness polling, Custom
 *                    Agent SSE, webhook server), then that transport's setup.
 *   Off            → out of every picker; settings kept.
 *
 * Ownership is presentation only: storage and dispatch keep the explicit
 * four-state mode (`api | polling | webhook | off`, lib/ai/agent-execution-mode.ts)
 * because pull and push fail differently. A webhook runtime is user-operated
 * but Astrid-initiated — Astrid pushes the work to it.
 *
 * This replaces four separate cards (a generic connect card, a runtime toggle
 * card, an all-providers key manager, a collapsed Advanced wall) whose reader
 * had to know which parts applied to them. Here nothing shows until it is the
 * answer to the mode the user picked.
 *
 * Codex and OpenAI are ONE row. They were always one agent with two identities
 * under it, split by runtime: server-run work executes as openai@ (it has the
 * executor and takes the OpenAI key), harness work queues as codex@ (it has
 * the harness identity). The row's mode picks which identity is live, and
 * lib/ai/assignable-agents.ts hides the other from every picker.
 *
 * Custom Agents are a peer row whose OAuth + SSE protocol is managed directly
 * instead of offering the provider execution modes.
 */

import { useTranslations } from '@/lib/i18n/client'
import { RichMessage, fillMessage } from '@/components/shared/RichMessage'
import { BRAND } from '@/lib/brand/config'
import { LOCAL_HARNESS_AGENT_MAILBOXES } from '@/lib/brand/agent-emails'
import { CAPABILITIES } from '@/lib/brand/capabilities'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AgentLoopRecipes } from '@/components/agent-runtime-settings'
import { WebhookSettingsManager } from '@/components/webhook-settings-manager'
import { CustomAgentManager } from '@/components/custom-agent-manager'
import { GitHubCopilotMcpSetup } from '@/components/github-copilot-mcp-setup'
import { AgentCredentialsCard } from '@/components/agent-credentials-card'
import { Bot, Check, ChevronDown, ChevronUp, CircleSlash, Cloud, Eye, EyeOff, Loader2, TestTube, Terminal, Trash2, Webhook } from "lucide-react"
import { Github } from "@/components/ui/brand-icons"
import Link from 'next/link'
import { toast } from 'sonner'
import { apiCall, apiPost, apiPut } from '@/lib/api'

type Mode = 'api' | 'polling' | 'webhook' | 'off'

interface AgentRowConfig {
  key: string
  label: string
  /** Mailbox whose stored mode this row controls (codex row → openai). */
  modeMailbox: string
  /** Provider whose credential backs "Astrid runs it". */
  service: string
  /** Identity the polling queue answers to. */
  pollMailbox: string
  /** Identity shown per mode — the codex row's is mode-dependent. */
  identityFor: (mode: Mode) => string
  keyPlaceholder?: string
  keyDocsUrl?: string
  /** Copilot authenticates with GitHub OAuth, not a pasted key. */
  oauth?: boolean
}

const ROWS: AgentRowConfig[] = [
  {
    key: 'claude',
    label: 'Claude',
    modeMailbox: 'claude',
    service: 'claude',
    pollMailbox: 'claude',
    identityFor: () => 'claude',
    keyPlaceholder: 'sk-ant-...',
    keyDocsUrl: 'https://docs.anthropic.com/claude/reference/getting-started',
  },
  {
    key: 'codex',
    label: 'Codex',
    modeMailbox: 'openai',
    service: 'openai',
    pollMailbox: 'codex',
    identityFor: mode => (mode === 'polling' ? 'codex' : 'openai'),
    keyPlaceholder: 'sk-...',
    keyDocsUrl: 'https://platform.openai.com/docs/api-reference',
  },
  {
    // Like Claude: the Muse Code CLI polls muse@, or Astrid runs it on a Meta
    // Model API key (AWTD-1053). One identity either way.
    key: 'muse',
    label: 'Muse',
    modeMailbox: 'muse',
    service: 'muse',
    pollMailbox: 'muse',
    identityFor: () => 'muse',
    keyDocsUrl: 'https://developer.meta.com/ai/',
  },
  {
    key: 'copilot',
    label: 'GitHub Copilot',
    modeMailbox: 'copilot',
    service: 'copilot',
    pollMailbox: 'copilot',
    identityFor: () => 'copilot',
    oauth: true,
  },
  {
    key: 'gemini',
    label: 'Gemini',
    modeMailbox: 'gemini',
    service: 'gemini',
    pollMailbox: 'gemini',
    identityFor: () => 'gemini',
    keyPlaceholder: 'AIza...',
    keyDocsUrl: 'https://aistudio.google.com/apikey',
  },
]

/**
 * How many agent rows the hub renders.
 *
 * Exported so tests can count rows rather than hardcode a number: a literal
 * `toHaveLength(4)` went red the moment Muse was added, which is precisely the
 * "one agent, many places to remember" problem AWTD-937 set out to remove.
 */
export const AGENT_HUB_ROW_COUNT = ROWS.length

/**
 * Every mailbox the hub writes a mode for. Exported so a test can hold this
 * table against the server's rules instead of trusting them to agree — they
 * did not (task 42349da6).
 */
export const AGENT_HUB_MODE_MAILBOXES: readonly string[] = ROWS.map(row => row.modeMailbox)

/**
 * A row whose agent has no server-side executor, so Astrid cannot run it and
 * there is no webhook to push it to. Only "I run it" and "Off" are real.
 *
 * Read from the shared harness registry rather than the endpoint's `locked`
 * flag: it is the same source the server rejects writes from (AWTD-937), and
 * it is known before the first fetch resolves, so the row never renders a
 * button for a moment and then withdraws it.
 *
 * The Codex row is NOT locked — its modeMailbox is `openai`, which does have a
 * server executor. Locking is per mailbox, not per row label.
 */
function isHarnessOnly(row: AgentRowConfig): boolean {
  return LOCAL_HARNESS_AGENT_MAILBOXES.includes(row.modeMailbox)
}

/** Who operates the runtime — the primary choice. Derived from the stored mode, never stored itself. */
type Ownership = 'astrid' | 'self' | 'off'

// The first two labels are the keys the page intro names the control with, so
// the button and the sentence about it read the same in every locale.
const OWNERSHIP_META: Record<Ownership, { labelKey: string; icon: typeof Cloud; tint: string }> = {
  astrid: { labelKey: 'settingsPages.aiAgents.yourAgents.astridRuns', icon: Cloud, tint: 'text-brand bg-brand/15' },
  self: { labelKey: 'settingsPages.aiAgents.yourAgents.selfRuns', icon: Terminal, tint: 'text-success bg-success/15' },
  off: { labelKey: 'settingsPages.aiAgents.hub.off', icon: CircleSlash, tint: 'text-theme-muted bg-theme-tertiary' },
}

function ownershipOf(mode: Mode): Ownership {
  if (mode === 'api') return 'astrid'
  if (mode === 'off') return 'off'
  return 'self'
}

/**
 * Transports under "I run it". `polling` and `webhook` are the stored modes;
 * `sse` is not a per-provider mode at all — a Custom Agent is its own identity,
 * so that option hands over to the Custom Agents section.
 */
const SELF_TRANSPORTS: { key: Mode | 'sse'; labelKey: string; icon: typeof Cloud }[] = [
  { key: 'polling', labelKey: 'settingsPages.aiAgents.hub.transportNative', icon: Terminal },
  { key: 'webhook', labelKey: 'settingsPages.connections.categories.webhook', icon: Webhook },
  { key: 'sse', labelKey: 'settingsPages.aiAgents.hub.transportSse', icon: Bot },
]

interface KeyStatus {
  hasKey: boolean
  isValid?: boolean
}

/** Inline credential editor for one provider — the whole of "Astrid runs it". */
function InlineKeyEditor({
  row,
  status,
  copilotConnected,
  onChanged,
}: {
  row: AgentRowConfig
  status: KeyStatus | undefined
  copilotConnected: boolean
  onChanged: () => void
}) {
  const { t } = useTranslations()
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | null>(null)

  if (row.oauth) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm theme-text-muted">
          {copilotConnected
            ? t('settingsPages.aiAgents.hub.copilotConnected')
            : t('settingsPages.aiAgents.hub.copilotAuthorize')}
        </p>
        {copilotConnected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                await apiCall('/api/v1/integrations/copilot/status', { method: 'DELETE' })
                toast.success(t('settingsPages.aiAgents.hub.copilotDisconnected'))
                onChanged()
              } catch {
                toast.error(t('settingsPages.aiAgents.hub.copilotDisconnectFailed'))
              }
            }}
          >
            {t('settingsPages.connections.github.disconnect')}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={async () => {
              try {
                const response = await fetch('/api/v1/integrations/copilot/authorize')
                const data = await response.json()
                if (!response.ok || !data.url) throw new Error(data.error || t('settingsPages.aiAgents.hub.copilotAuthStartFailed'))
                window.location.assign(data.url)
              } catch (error) {
                toast.error(error instanceof Error ? error.message : t('settingsPages.aiAgents.hub.copilotConnectFailed'))
              }
            }}
          >
            <Github className="w-4 h-4 mr-1.5" />
            {t('settingsPages.connections.github.connect')}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Input
            type={showKey ? 'text' : 'password'}
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder={status?.hasKey ? t('settingsPages.aiAgents.hub.keySavedPlaceholder') : row.keyPlaceholder}
            className="pr-9 theme-bg-tertiary theme-border theme-text-primary"
          />
          <button
            type="button"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 theme-text-muted"
            onClick={() => setShowKey(v => !v)}
          >
            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <Button
          size="sm"
          disabled={!key.trim() || busy !== null}
          onClick={async () => {
            setBusy('save')
            try {
              await apiPut('/api/v1/users/me/ai-credentials', {
                serviceId: row.service,
                apiKey: key.trim(),
              })
              setKey('')
              toast.success(t('settingsPages.aiAgents.hub.keySaved', { agent: row.label }))
              onChanged()
            } catch {
              toast.error(t('settingsPages.aiAgents.hub.keySaveFailed'))
            } finally {
              setBusy(null)
            }
          }}
        >
          {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : t('actions.save')}
        </Button>
        {status?.hasKey && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={async () => {
                setBusy('test')
                try {
                  const response = await apiPost('/api/v1/users/me/ai-credentials/test', {
                    serviceId: row.service,
                  })
                  const result = await response.json()
                  if (result.success) toast.success(t('settingsPages.aiAgents.hub.keyValid', { agent: row.label }))
                  else toast.error(fillMessage(t('settingsPages.aiAgents.hub.keyTestFailed'), { error: String(result.error) }))
                  onChanged()
                } catch {
                  toast.error(t('settingsPages.aiAgents.hub.keyTestError'))
                } finally {
                  setBusy(null)
                }
              }}
            >
              <TestTube className="w-3.5 h-3.5 mr-1" />
              {t('settingsPages.aiAgents.hub.testKey')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={async () => {
                setBusy('delete')
                try {
                  await apiCall('/api/v1/users/me/ai-credentials', {
                    method: 'DELETE',
                    body: JSON.stringify({ serviceId: row.service }),
                  })
                  toast.success(t('settingsPages.aiAgents.hub.keyRemoved', { agent: row.label }))
                  onChanged()
                } catch {
                  toast.error(t('settingsPages.aiAgents.hub.keyRemoveFailed'))
                } finally {
                  setBusy(null)
                }
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </>
        )}
      </div>
      <p className="text-xs theme-text-muted">
        {t('settingsPages.aiAgents.hub.keyEncrypted')}{' '}
        {row.keyDocsUrl && (
          <a href={row.keyDocsUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">
            {t('settingsPages.aiAgents.hub.getKey')}
          </a>
        )}
      </p>
    </div>
  )
}

export function AgentHub() {
  const { t } = useTranslations()
  const [modes, setModes] = useState<Record<string, string>>({})
  const [keys, setKeys] = useState<Record<string, KeyStatus>>({})
  const [copilotConnected, setCopilotConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savingMode, setSavingMode] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [origin, setOrigin] = useState(`https://${BRAND.domain}`)

  const refreshCredentials = () => {
    fetch('/api/v1/users/me/ai-credentials')
      .then(r => r.json())
      .then(data => setKeys(data.keys || {}))
      .catch(() => {})
    fetch('/api/v1/integrations/copilot/status')
      .then(r => r.json())
      .then(data => setCopilotConnected(data.connected === true))
      .catch(() => {})
  }

  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin)

    fetch('/api/v1/users/me/agent-modes')
      .then(r => r.json())
      .then(data => setModes(data.modes || {}))
      .catch(() => toast.error(t('settingsPages.aiAgents.hub.loadFailed')))
      .finally(() => setLoading(false))

    refreshCredentials()
  }, [])

  const setMode = async (row: AgentRowConfig, mode: Mode) => {
    const previous = modes[row.modeMailbox]
    setSavingMode(row.key)
    setModes(prev => ({ ...prev, [row.modeMailbox]: mode }))
    setExpanded(row.key)

    try {
      const response = await apiPut('/api/v1/users/me/agent-modes', {
        agent: row.modeMailbox,
        mode,
      })
      const data = await response.json()
      setModes(data.modes || {})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settingsPages.aiAgents.hub.saveFailed'))
      setModes(prev => ({ ...prev, [row.modeMailbox]: previous }))
    } finally {
      setSavingMode(null)
    }
  }

  if (loading) {
    return <div className="h-40 theme-bg-tertiary rounded-lg animate-pulse" />
  }

  return (
    <div className="space-y-3">
      {CAPABILITIES.integrationMcp && (
        <div className="flex justify-end">
          <Link href="/docs/loops" className="text-xs text-brand hover:underline">
            {t('settingsPages.aiAgents.hub.guideLink')}
          </Link>
        </div>
      )}

      {ROWS.map(row => {
        const mode = (modes[row.modeMailbox] as Mode) || 'polling'
        const harnessOnly = isHarnessOnly(row)
        // "Astrid runs it" needs a server executor this agent does not have.
        const choices = (Object.keys(OWNERSHIP_META) as Ownership[]).filter(
          candidate => !(harnessOnly && candidate === 'astrid')
        )
        const ownership = ownershipOf(mode)
        const isExpanded = expanded === row.key
        const identity = row.identityFor(mode)
        const keyStatus = keys[row.service]
        const configured =
          mode !== 'api' || (row.oauth ? copilotConnected : keyStatus?.hasKey)
        const isOff = mode === 'off'

        return (
          <div
            key={row.key}
            className={`border theme-border rounded-lg overflow-hidden ${isOff ? 'opacity-60' : ''}`}
          >
            <div
              className="flex flex-wrap items-center justify-between gap-3 p-3 cursor-pointer"
              onClick={() => setExpanded(isExpanded ? null : row.key)}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium theme-text-primary">{row.label}</span>
                  {!configured && !isOff && (
                    <Badge variant="outline" className="text-xs text-warning">
                      {t('settingsPages.aiAgents.hub.needsSetup')}
                    </Badge>
                  )}
                </div>
                <div className="text-xs theme-text-muted truncate">
                  {identity}@{BRAND.agentEmailDomain}
                </div>
              </div>

              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                {savingMode === row.key && <Loader2 className="w-4 h-4 animate-spin theme-text-muted" />}
                <div className="inline-flex rounded-lg border theme-border overflow-hidden">
                  {choices.map(candidate => {
                    const meta = OWNERSHIP_META[candidate]
                    const OwnershipIcon = meta.icon
                    const active = ownership === candidate
                    return (
                      <button
                        key={candidate}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          if (candidate === 'astrid') setMode(row, 'api')
                          else if (candidate === 'off') setMode(row, 'off')
                          else if (ownership !== 'self') {
                            // Entering "I run it" defaults to polling; the
                            // transport choice below refines it.
                            setMode(row, 'polling')
                            setExpanded(row.key)
                          }
                        }}
                        className={`px-2.5 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${
                          active ? meta.tint : 'theme-text-muted hover:theme-text-primary'
                        }`}
                      >
                        <OwnershipIcon className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{t(meta.labelKey)}</span>
                      </button>
                    )
                  })}
                </div>
                <button
                  type="button"
                  className="theme-text-muted"
                  onClick={() => setExpanded(isExpanded ? null : row.key)}
                >
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {isExpanded && (
              <div className="border-t theme-border p-3 theme-bg-secondary space-y-3">
                {/* A harness-only agent has exactly one transport, so there is no
                    choice to present — the polling copy below already says what
                    runs it (task 42349da6). */}
                {ownership === 'self' && !harnessOnly && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs theme-text-muted">{t('settingsPages.aiAgents.hub.transportLabel')}</span>
                    <div className="inline-flex rounded-lg border theme-border overflow-hidden">
                      {SELF_TRANSPORTS.map(transport => {
                        const TransportIcon = transport.icon
                        const active = mode === transport.key
                        return (
                          <button
                            key={transport.key}
                            type="button"
                            aria-pressed={active}
                            onClick={() => {
                              if (transport.key === 'sse') setExpanded('custom-agents')
                              else if (mode !== transport.key) setMode(row, transport.key)
                            }}
                            className={`px-2.5 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${
                              active
                                ? 'text-success bg-success/15'
                                : 'theme-text-muted hover:theme-text-primary'
                            }`}
                          >
                            <TransportIcon className="w-3.5 h-3.5" />
                            {t(transport.labelKey)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {mode === 'api' && (
                  <>
                    <p className="text-xs theme-text-muted">
                      {t('settingsPages.aiAgents.hub.apiModeDescription')}
                    </p>
                    <InlineKeyEditor
                      row={row}
                      status={keyStatus}
                      copilotConnected={copilotConnected}
                      onChanged={refreshCredentials}
                    />
                  </>
                )}

                {mode === 'polling' && (
                  <>
                    <p className="text-xs theme-text-muted">
                      <RichMessage
                        message={t('settingsPages.aiAgents.hub.pollingModeDescription')}
                        values={{ agent: row.label, ready: <strong>{t('listSettings.admin.readyStatus')}</strong> }}
                      />
                    </p>
                    <AgentLoopRecipes mailbox={row.pollMailbox} origin={origin} />
                    {/* The Copilot app / GitHub.com cloud agent is one of Copilot's
                        harnesses, so its token + repository MCP setup lives here
                        rather than as a page-level card. */}
                    {row.key === 'copilot' && CAPABILITIES.integrationMcp && (
                      <GitHubCopilotMcpSetup origin={origin} />
                    )}
                  </>
                )}

                {mode === 'off' && (
                  <p className="text-xs theme-text-muted">
                    {t('settingsPages.aiAgents.hub.offModeDescription')}
                  </p>
                )}

                {mode === 'webhook' && (
                  <>
                    <p className="text-xs theme-text-muted">
                      <RichMessage
                        message={t('settingsPages.aiAgents.hub.webhookModeDescription')}
                        values={{
                          sdk: (
                            <a
                              href="https://www.npmjs.com/package/@gracefultools/astrid-sdk"
                              target="_blank"
                              rel="noreferrer"
                              className="text-[rgb(var(--theme-accent))] hover:underline"
                            >
                              {BRAND.appName} SDK
                            </a>
                          ),
                          nativeHarness: t('settingsPages.aiAgents.hub.transportNative'),
                          agentLoops: (
                            <Link href="/docs/loops" className="text-[rgb(var(--theme-accent))] hover:underline">
                              {t('settingsPages.aiAgents.hub.agentLoops')}
                            </Link>
                          ),
                        }}
                      />
                    </p>
                    <AgentCredentialsCard preset="webhookServer" agent={row.pollMailbox} />
                    <WebhookSettingsManager />
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Custom Agents — a peer option whose runtime uses the external-agent protocol */}
      <div className="border theme-border rounded-lg overflow-hidden">
        <div
          className="flex flex-wrap items-center justify-between gap-3 p-3 cursor-pointer"
          onClick={() => setExpanded(expanded === 'custom-agents' ? null : 'custom-agents')}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Bot className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-medium theme-text-primary">{t('settingsPages.aiAgents.hub.customAgents')}</span>
            </div>
            <div className="text-xs theme-text-muted">
              {t('settingsPages.aiAgents.hub.customAgentsDescription')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {expanded === 'custom-agents' && <Check className="w-4 h-4 text-orange-500" />}
            <button type="button" className="theme-text-muted">
              {expanded === 'custom-agents' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>
        {expanded === 'custom-agents' && (
          <div className="border-t theme-border p-3 theme-bg-secondary">
            <CustomAgentManager />
          </div>
        )}
      </div>
    </div>
  )
}
