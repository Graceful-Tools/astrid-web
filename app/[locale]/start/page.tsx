"use client"

/**
 * /starthere — run a small software business with agents from one Astrid.
 *
 * Everything on this page comes from lib/start-here/business-blueprint.ts,
 * which also renders /starthere.md for agents, so a human and an agent
 * following the guide copy the same commands. Commands themselves come from
 * lib/agent-skill (the canonical queue skill + loop recipes) — never retyped.
 */

import { BRAND } from '@/lib/brand/config'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import Image from "next/image"
import { ArrowLeft, Bot, CheckCircle2, FileText, ListChecks, Loader2, Repeat, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { scrollShellClassName } from "@/components/scroll-shell"
import { CopyBlock } from "@/components/agent-runtime-settings"
import { AgentCredentialsCard } from "@/components/agent-credentials-card"
import { apiGet, apiPost } from "@/lib/api"
import { useTranslations } from "@/lib/i18n/client"
import { RichMessage } from "@/components/shared/RichMessage"
import {
  START_HERE_MARKDOWN_PATH,
  START_HERE_PATH,
  STARTER_AGENTS,
  STARTER_LISTS,
  starterAgentForList,
  starterAgentSetup,
  starterList,
  type StarterAgent,
  type StarterList,
} from "@/lib/start-here/business-blueprint"
import { starterAgentCopy } from "@/lib/start-here/starter-agent-copy"
import {
  createStarterLists,
  findStarterLists,
  type StarterApi,
} from "@/lib/start-here/create-starter-lists"

type ListIds = Partial<Record<StarterList['key'], string>>

const starterApi: StarterApi = {
  async getJson(path) {
    const res = await apiGet(path)
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) }
  },
  async postJson(path, body) {
    const res = await apiPost(path, body)
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) }
  },
}

const noopSubscribe = () => () => {}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  const { t } = useTranslations()
  return (
    <Card className="theme-bg-secondary theme-border" data-testid={`starthere-step-${n}`}>
      <CardHeader>
        <CardTitle className="theme-text-primary text-lg">
          {t('startPage.step', { n: String(n), title })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

function AgentSetup({
  agent,
  origin,
  listId,
  signedIn,
}: {
  agent: StarterAgent
  origin: string
  listId?: string
  signedIn: boolean
}) {
  const { t } = useTranslations()
  const list = starterList(agent.list)
  const setup = starterAgentSetup(agent, origin, listId ?? null)
  const copy = starterAgentCopy(agent, t)
  let n = 1
  return (
    <details
      className="rounded-lg border theme-border p-3 group"
      data-testid={`starthere-agent-${agent.key}`}
    >
      <summary className="cursor-pointer list-none flex flex-wrap items-start justify-between gap-2">
        <span>
          <span className="font-semibold theme-text-primary">{agent.name}</span>
          <span className="theme-text-muted"> {t('startPage.agentList', { list: list.name })}</span>
          <span className="block text-sm theme-text-muted">{copy.role}</span>
        </span>
        <span className="text-xs theme-text-muted shrink-0">{t('startPage.buyPlan', { plan: copy.plan })}</span>
      </summary>
      <div className="space-y-3 pt-3">
        <p className="text-sm theme-text-muted">{copy.runs}</p>
        {!listId && (
          <p className="text-xs theme-text-muted">
            {t('startPage.createListsFirst', { list: list.name })}
          </p>
        )}
        {setup.connect && (
          <CopyBlock
            label={t('startPage.connectStep', { n: String(n++) })}
            code={setup.connect}
            testId={`starthere-connect-${agent.key}`}
          />
        )}
        {setup.install && (
          <CopyBlock
            label={t('startPage.installSkillStep', { n: String(n++), path: setup.install.path })}
            code={setup.install.content}
          />
        )}
        {copy.extraSteps.map(step => (
          <p key={step} className="text-sm theme-text-primary">
            {n++}. {step}
          </p>
        ))}
        {agent.key === 'github-actions' && signedIn && (
          <AgentCredentialsCard preset="githubActions" agent={agent.mailbox} />
        )}
        {setup.schedule && (
          <CopyBlock
            label={t('startPage.scheduleStep', { n: String(n++) })}
            code={setup.schedule}
            testId={`starthere-schedule-${agent.key}`}
          />
        )}
        {setup.workflow && (
          <CopyBlock
            label={t('startPage.workflowStep', { n: String(n++), path: setup.workflow.path })}
            code={setup.workflow.content}
            testId={`starthere-workflow-${agent.key}`}
          />
        )}
        <p className="text-sm theme-text-muted">
          <RichMessage
            message={t('startPage.checkStep')}
            values={{
              n,
              tool: <code className="font-mono text-xs">get_agent_queue</code>,
              mailbox: agent.mailbox,
              empty: <code className="font-mono text-xs">empty: true</code>,
            }}
          />
        </p>
        {setup.hosted && (
          <div className="space-y-3 rounded-lg border theme-border p-3" data-testid={`starthere-hosted-${agent.key}`}>
            <p className="text-sm font-semibold theme-text-primary">
              {t('startPage.hostedTitle', { agent: agent.name })}
            </p>
            <ul className="list-disc pl-5 space-y-1 text-sm theme-text-muted">
              {setup.hosted.secrets.map(secret => (
                <li key={secret.name}>
                  <code className="font-mono text-xs theme-text-primary">{secret.name}</code>: {secret.how.replace(/\*\*/g, '').replace(/`/g, '')}
                </li>
              ))}
            </ul>
            {signedIn && <CiTokenButton mailbox={agent.mailbox} secretName={setup.hosted.secrets[1]?.name ?? ''} />}
            <CopyBlock
              label={t('startPage.commitFile', { path: setup.hosted.workflow.path })}
              code={setup.hosted.workflow.content}
              testId={`starthere-hosted-workflow-${agent.key}`}
            />
            <p className="text-xs theme-text-muted">{setup.hosted.caveat}</p>
          </div>
        )}
        {setup.hostedUnavailable && (
          <p className="text-xs theme-text-muted" data-testid={`starthere-hosted-unavailable-${agent.key}`}>
            {setup.hostedUnavailable}
          </p>
        )}
      </div>
    </details>
  )
}

/**
 * Mint an access token bound to one agent, for a GitHub Actions secret
 * (AWTD-1494). The same mint the Copilot cloud card uses; shown once.
 */
function CiTokenButton({ mailbox, secretName }: { mailbox: string; secretName: string }) {
  const { t } = useTranslations()
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await apiPost('/api/mcp/user-tokens', {
        permissions: ['read', 'write'],
        expiresInDays: 365,
        description: `GitHub Actions — ${mailbox}`,
        agent: mailbox,
      })
      const data: { token?: string; error?: string } = await res.json().catch(() => ({}))
      if (!res.ok || !data.token) throw new Error(data.error || `HTTP ${res.status}`)
      setToken(data.token)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (token) {
    return (
      <div className="space-y-1">
        <CopyBlock label={t('startPage.saveAsSecret', { secret: secretName })} code={token} />
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" onClick={create} disabled={busy} data-testid={`starthere-ci-token-${mailbox}`}>
        {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {t('startPage.createCiToken')}
      </Button>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  )
}

export default function StartHerePage() {
  const { t } = useTranslations()
  const router = useRouter()
  const { status } = useSession()
  const signedIn = status === 'authenticated'
  const defaultOrigin = process.env.NEXT_PUBLIC_BASE_URL || `https://${BRAND.domain}`
  // The real host on the client (a preview deploy, localhost), the configured
  // origin during SSR — without a setState-in-effect render cascade.
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => `${window.location.protocol}//${window.location.host}`,
    () => defaultOrigin,
  )
  const [listIds, setListIds] = useState<ListIds>({})
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!signedIn) return
    findStarterLists(starterApi).then(setListIds).catch(() => {})
  }, [signedIn])

  const allCreated = useMemo(() => STARTER_LISTS.every(l => listIds[l.key]), [listIds])

  const create = useCallback(async () => {
    setCreating(true)
    setError(null)
    try {
      const results = await createStarterLists(starterApi)
      setListIds(Object.fromEntries(results.map(r => [r.key, r.id])))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }, [])

  return (
    <div className={`${scrollShellClassName} theme-bg-primary`}>
      <div className="theme-header theme-border app-header">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" onClick={() => router.push('/docs')} className="p-2 hover:bg-opacity-20" aria-label={t('startPage.backToDocs')}>
            <ArrowLeft className="w-5 h-5 theme-text-primary" />
          </Button>
          <div
            className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => router.push('/')}
            title={t('navigation.goHome')}
          >
            <Image src={BRAND.iconSmall} alt={BRAND.appName} width={24} height={24} className="rounded" />
            <span className="text-xl font-semibold theme-text-primary">{BRAND.wordmark}</span>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold theme-text-primary">
            {t('startPage.heading')}
          </h1>
          <p className="theme-text-muted">
            {t('startPage.intro')}
          </p>
          <p className="text-sm theme-text-muted flex items-center gap-2">
            <FileText className="w-4 h-4 shrink-0" />
            <span>
              <RichMessage
                message={t('startPage.agentReadThis')}
                values={{
                  link: (
                    <a className="underline" href={START_HERE_MARKDOWN_PATH} data-testid="starthere-markdown-link">
                      {START_HERE_MARKDOWN_PATH}
                    </a>
                  ),
                }}
              />
            </span>
          </p>
        </div>

        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="theme-text-primary text-lg flex items-center gap-2">
              <ListChecks className="w-5 h-5" /> {t('startPage.shapeTitle')}
            </CardTitle>
            <CardDescription className="theme-text-muted">
              {t('startPage.shapeDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2" data-testid="starthere-shape">
              {STARTER_LISTS.map(list => {
                const agent = starterAgentForList(list)
                return (
                  <div key={list.key} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-semibold theme-text-primary w-28">{list.name}</span>
                    <span className="theme-text-primary">{agent.name}</span>
                    <span className="theme-text-muted">— {starterAgentCopy(agent, t).role}</span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Step n={1} title={t('startPage.createTitle')}>
          <p className="text-sm theme-text-muted">
            <RichMessage message={t('startPage.createIntro')} values={{ is: <em>{t('startPage.createIntroIs')}</em> }} />
          </p>
          {signedIn ? (
            <Button onClick={create} disabled={creating || allCreated} data-testid="starthere-create-lists">
              {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {allCreated ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" /> {t('startPage.listsReady')}
                </>
              ) : (
                t('startPage.createLists')
              )}
            </Button>
          ) : (
            <Button onClick={() => router.push(`/auth/signin?callbackUrl=${encodeURIComponent(START_HERE_PATH)}`)}>
              {t('startPage.signInToCreate')}
            </Button>
          )}
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <details className="text-sm">
            <summary className="cursor-pointer theme-text-muted">{t('startPage.seeInstructions')}</summary>
            <div className="space-y-3 pt-3">
              {STARTER_LISTS.map(list => (
                <CopyBlock key={list.key} label={list.name} code={list.description} />
              ))}
            </div>
          </details>
        </Step>

        <Step n={2} title={t('startPage.connectTitle')}>
          <p className="text-sm theme-text-muted flex items-start gap-2">
            <Bot className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <RichMessage
                message={t('startPage.connectIntro')}
                values={{
                  assignedAndReady: (
                    <strong className="theme-text-primary">{t('startPage.connectIntroAssignedAndReady')}</strong>
                  ),
                }}
              />
            </span>
          </p>
          <div className="space-y-3">
            {STARTER_AGENTS.map(agent => (
              <AgentSetup
                key={agent.key}
                agent={agent}
                origin={origin}
                listId={listIds[agent.list]}
                signedIn={signedIn}
              />
            ))}
          </div>
        </Step>

        <Step n={3} title={t('startPage.workTitle')}>
          <ol className="list-decimal pl-5 space-y-1 text-sm theme-text-primary">
            <li>{t('startPage.workAddTask')}</li>
            <li><RichMessage message={t('startPage.workSetReady')} values={{ ready: <strong>Ready</strong> }} /></li>
            <li>{t('startPage.workAgentReports')}</li>
            <li>{t('startPage.workReply')}</li>
          </ol>
          <p className="text-sm theme-text-muted flex items-center gap-2">
            <Repeat className="w-4 h-4 shrink-0" />
            {t('startPage.workRecurring')}
          </p>
        </Step>

        <Step n={4} title={t('startPage.teamTitle')}>
          <p className="text-sm theme-text-muted flex items-start gap-2">
            <Users className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <RichMessage
                message={t('startPage.teamIntro')}
                values={{
                  members: t('lists.members'),
                  setting: (
                    <strong className="theme-text-primary">{t('listSettings.memberAgentAssignment.label')}</strong>
                  ),
                  aiAgent: t('listSettings.admin.aiAgent'),
                }}
              />
            </span>
          </p>
        </Step>

        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="theme-text-primary text-lg">{t('startPage.reference')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-between" onClick={() => router.push('/docs/loops')}>
              {t('startPage.everyRecipe')}
            </Button>
            <Button variant="outline" className="w-full justify-between" onClick={() => router.push('/docs/mcp')}>
              {t('startPage.mcpTokens')}
            </Button>
            <Button variant="outline" className="w-full justify-between" onClick={() => router.push('/settings/agents')}>
              {t('startPage.agentSettings')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
