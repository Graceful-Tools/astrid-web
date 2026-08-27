"use client"

/**
 * The agents page's one list: every agent, and per agent the ONE question that
 * decides everything else — who runs it.
 *
 *   Astrid runs it   → the key for THAT provider, inline. Nothing else.
 *   My harness polls → that harness's connect + loop recipe, inline.
 *   Webhook server   → the webhook manager, inline.
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
 * OpenClaw is a row like the others, but its runtime is its own protocol —
 * expanding it manages OpenClaw agents instead of offering the three modes.
 */

import { BRAND } from '@/lib/brand/config'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AgentLoopRecipes } from '@/components/agent-runtime-settings'
import { WebhookSettingsManager } from '@/components/webhook-settings-manager'
import { OpenClawAgentManager } from '@/components/openclaw-agent-manager'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Cloud,
  Eye,
  EyeOff,
  Github,
  Loader2,
  TestTube,
  Terminal,
  Trash2,
  Webhook,
} from 'lucide-react'
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

const MODE_META: Record<Mode, { label: string; icon: typeof Cloud; tint: string }> = {
  api: { label: `${BRAND.appName} runs it`, icon: Cloud, tint: 'text-blue-500 bg-blue-500/15' },
  polling: { label: 'My harness polls', icon: Terminal, tint: 'text-green-500 bg-green-500/15' },
  webhook: { label: 'Webhook server', icon: Webhook, tint: 'text-purple-500 bg-purple-500/15' },
  off: { label: "Don't use", icon: CircleSlash, tint: 'text-gray-500 bg-gray-500/15' },
}

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
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | null>(null)

  if (row.oauth) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm theme-text-muted">
          {copilotConnected
            ? `Connected — ${BRAND.appName} uses your Copilot subscription for this agent's work.`
            : `Authorize GitHub so ${BRAND.appName} can use your Copilot subscription. Revocable from GitHub at any time.`}
        </p>
        {copilotConnected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                await apiCall('/api/v1/integrations/copilot/status', { method: 'DELETE' })
                toast.success('GitHub Copilot disconnected')
                onChanged()
              } catch {
                toast.error('Unable to disconnect GitHub Copilot')
              }
            }}
          >
            Disconnect
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={async () => {
              try {
                const response = await fetch('/api/v1/integrations/copilot/authorize')
                const data = await response.json()
                if (!response.ok || !data.url) throw new Error(data.error || 'Unable to start GitHub authorization')
                window.location.assign(data.url)
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Unable to connect GitHub Copilot')
              }
            }}
          >
            <Github className="w-4 h-4 mr-1.5" />
            Connect GitHub
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
            placeholder={status?.hasKey ? 'Key saved — paste to replace' : row.keyPlaceholder}
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
              toast.success(`${row.label} key saved`)
              onChanged()
            } catch {
              toast.error('Failed to save API key')
            } finally {
              setBusy(null)
            }
          }}
        >
          {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
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
                  if (result.success) toast.success(`${row.label} key is valid`)
                  else toast.error(`Key test failed: ${result.error}`)
                  onChanged()
                } catch {
                  toast.error('Failed to test API key')
                } finally {
                  setBusy(null)
                }
              }}
            >
              <TestTube className="w-3.5 h-3.5 mr-1" />
              Test
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
                  toast.success(`${row.label} key removed`)
                  onChanged()
                } catch {
                  toast.error('Failed to remove API key')
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
        Encrypted at rest, used only server-side.{' '}
        {row.keyDocsUrl && (
          <a href={row.keyDocsUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">
            Get a key
          </a>
        )}
      </p>
    </div>
  )
}

export function AgentHub() {
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
      .catch(() => toast.error('Could not load agent settings'))
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
      toast.error(error instanceof Error ? error.message : 'Could not save')
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
      {ROWS.map(row => {
        const mode = (modes[row.modeMailbox] as Mode) || 'polling'
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
                    <Badge variant="outline" className="text-xs text-yellow-600 dark:text-yellow-400">
                      Needs setup
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
                  {(Object.keys(MODE_META) as Mode[]).map(candidate => {
                    const meta = MODE_META[candidate]
                    const ModeIcon = meta.icon
                    const active = mode === candidate
                    return (
                      <button
                        key={candidate}
                        type="button"
                        onClick={() => setMode(row, candidate)}
                        className={`px-2.5 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${
                          active ? meta.tint : 'theme-text-muted hover:theme-text-primary'
                        }`}
                      >
                        <ModeIcon className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{meta.label}</span>
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
                {mode === 'api' && (
                  <>
                    <p className="text-xs theme-text-muted">
                      {BRAND.appName} runs this agent server-side — works from your phone, needs
                      nothing running at home.
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
                      Your own {row.label} setup does the work. Connect it once, then assign this
                      agent a task and mark the task <strong>Ready</strong> — the loop picks it up.
                    </p>
                    <AgentLoopRecipes mailbox={row.pollMailbox} origin={origin} />
                  </>
                )}

                {mode === 'off' && (
                  <p className="text-xs theme-text-muted">
                    This agent is out of the way: it does not appear in assignee pickers and{' '}
                    {BRAND.appName} never runs it. Your saved settings and keys are kept — pick
                    another mode to bring it back exactly as it was.
                  </p>
                )}

                {mode === 'webhook' && (
                  <>
                    <p className="text-xs theme-text-muted">
                      A server you host is pushed this agent&apos;s work the moment it appears —
                      for machines with a permanent address. Runs on the{' '}
                      <a
                        href="https://www.npmjs.com/package/@gracefultools/astrid-sdk"
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-500 hover:underline"
                      >
                        {BRAND.appName} SDK
                      </a>{' '}
                      (<code className="text-xs">npx astrid-agent serve</code>, credentials from{' '}
                      <Link href="/settings/api-access" className="text-blue-500 hover:underline">
                        API Access
                      </Link>
                      ).
                    </p>
                    <WebhookSettingsManager />
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* OpenClaw — a peer option whose runtime is its own protocol */}
      <div className="border theme-border rounded-lg overflow-hidden">
        <div
          className="flex flex-wrap items-center justify-between gap-3 p-3 cursor-pointer"
          onClick={() => setExpanded(expanded === 'openclaw' ? null : 'openclaw')}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Bot className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-medium theme-text-primary">OpenClaw</span>
            </div>
            <div className="text-xs theme-text-muted">
              Your own agents over the OpenClaw protocol — OAuth + SSE, always connected
            </div>
          </div>
          <div className="flex items-center gap-2">
            {expanded === 'openclaw' && <Check className="w-4 h-4 text-orange-500" />}
            <button type="button" className="theme-text-muted">
              {expanded === 'openclaw' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>
        {expanded === 'openclaw' && (
          <div className="border-t theme-border p-3 theme-bg-secondary">
            <OpenClawAgentManager />
          </div>
        )}
      </div>
    </div>
  )
}
