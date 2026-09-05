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

import { BRAND } from '@/lib/brand/config'
import { CAPABILITIES } from '@/lib/brand/capabilities'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AgentLoopRecipes } from '@/components/agent-runtime-settings'
import { WebhookSettingsManager } from '@/components/webhook-settings-manager'
import { CustomAgentManager } from '@/components/custom-agent-manager'
import { GitHubCopilotMcpSetup } from '@/components/github-copilot-mcp-setup'
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

/** Who operates the runtime — the primary choice. Derived from the stored mode, never stored itself. */
type Ownership = 'astrid' | 'self' | 'off'

const OWNERSHIP_META: Record<Ownership, { label: string; icon: typeof Cloud; tint: string }> = {
  astrid: { label: `${BRAND.appName} runs it`, icon: Cloud, tint: 'text-blue-500 bg-blue-500/15' },
  self: { label: 'I run it', icon: Terminal, tint: 'text-green-500 bg-green-500/15' },
  off: { label: 'Off', icon: CircleSlash, tint: 'text-gray-500 bg-gray-500/15' },
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
const SELF_TRANSPORTS: { key: Mode | 'sse'; label: string; icon: typeof Cloud }[] = [
  { key: 'polling', label: 'Native coding harness', icon: Terminal },
  { key: 'webhook', label: 'Webhook server', icon: Webhook },
  { key: 'sse', label: 'Custom Agent (SSE)', icon: Bot },
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
      {CAPABILITIES.integrationMcp && (
        <div className="flex justify-end">
          <Link href="/docs/loops" className="text-xs text-blue-500 hover:underline">
            Connect my coding agent guide
          </Link>
        </div>
      )}

      {ROWS.map(row => {
        const mode = (modes[row.modeMailbox] as Mode) || 'polling'
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
                  {(Object.keys(OWNERSHIP_META) as Ownership[]).map(candidate => {
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
                {ownership === 'self' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs theme-text-muted">Transport:</span>
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
                                ? 'text-green-500 bg-green-500/15'
                                : 'theme-text-muted hover:theme-text-primary'
                            }`}
                          >
                            <TransportIcon className="w-3.5 h-3.5" />
                            {transport.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

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

      {/* Custom Agents — a peer option whose runtime uses the external-agent protocol */}
      <div className="border theme-border rounded-lg overflow-hidden">
        <div
          className="flex flex-wrap items-center justify-between gap-3 p-3 cursor-pointer"
          onClick={() => setExpanded(expanded === 'custom-agents' ? null : 'custom-agents')}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Bot className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-medium theme-text-primary">Custom Agents</span>
            </div>
            <div className="text-xs theme-text-muted">
              Agents you operate over OAuth + REST + SSE
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
