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
import {
  START_HERE_MARKDOWN_PATH,
  STARTER_AGENTS,
  STARTER_LISTS,
  starterAgentForList,
  starterAgentSetup,
  starterList,
  type StarterAgent,
  type StarterList,
} from "@/lib/start-here/business-blueprint"
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
  return (
    <Card className="theme-bg-secondary theme-border" data-testid={`starthere-step-${n}`}>
      <CardHeader>
        <CardTitle className="theme-text-primary text-lg">
          Step {n} — {title}
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
  const list = starterList(agent.list)
  const setup = starterAgentSetup(agent, origin, listId ?? null)
  let n = 1
  return (
    <details
      className="rounded-lg border theme-border p-3 group"
      data-testid={`starthere-agent-${agent.key}`}
    >
      <summary className="cursor-pointer list-none flex flex-wrap items-start justify-between gap-2">
        <span>
          <span className="font-semibold theme-text-primary">{agent.name}</span>
          <span className="theme-text-muted"> → {list.name} list</span>
          <span className="block text-sm theme-text-muted">{agent.role}</span>
        </span>
        <span className="text-xs theme-text-muted shrink-0">Buy: {agent.plan}</span>
      </summary>
      <div className="space-y-3 pt-3">
        <p className="text-sm theme-text-muted">{agent.runs}</p>
        {!listId && (
          <p className="text-xs theme-text-muted">
            Create the lists in Step 1 first and these commands fill in your {list.name} list id.
          </p>
        )}
        {setup.connect && (
          <CopyBlock
            label={`${n++}. Connect, then approve the ${BRAND.appName} sign-in it opens`}
            code={setup.connect}
            testId={`starthere-connect-${agent.key}`}
          />
        )}
        {setup.install && (
          <CopyBlock
            label={`${n++}. Install the queue skill at ${setup.install.path}`}
            code={setup.install.content}
          />
        )}
        {agent.extraSteps.map(step => (
          <p key={step} className="text-sm theme-text-primary">
            {n++}. {step}
          </p>
        ))}
        {agent.key === 'github-actions' && signedIn && (
          <AgentCredentialsCard preset="githubActions" agent={agent.mailbox} />
        )}
        {setup.schedule && (
          <CopyBlock
            label={`${n++}. Run it every 30 minutes (crontab on any always-on machine)`}
            code={setup.schedule}
            testId={`starthere-schedule-${agent.key}`}
          />
        )}
        {setup.workflow && (
          <CopyBlock
            label={`${n++}. Commit ${setup.workflow.path}, then replace its last step with the job to run`}
            code={setup.workflow.content}
            testId={`starthere-workflow-${agent.key}`}
          />
        )}
        <p className="text-sm theme-text-muted">
          {n}. Check it: ask the agent to call <code className="font-mono text-xs">get_agent_queue</code> with
          agent &quot;{agent.mailbox}&quot;. <code className="font-mono text-xs">empty: true</code> means
          connected and idle.
        </p>
      </div>
    </details>
  )
}

export default function StartHerePage() {
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
          <Button variant="ghost" onClick={() => router.push('/docs')} className="p-2 hover:bg-opacity-20" aria-label="Back to docs">
            <ArrowLeft className="w-5 h-5 theme-text-primary" />
          </Button>
          <div
            className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => router.push('/')}
            title="Go to Home"
          >
            <Image src={BRAND.iconSmall} alt={BRAND.appName} width={24} height={24} className="rounded" />
            <span className="text-xl font-semibold theme-text-primary">{BRAND.wordmark}</span>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold theme-text-primary">
            Run your software business with agents — from one {BRAND.appName}
          </h1>
          <p className="theme-text-muted">
            {BRAND.appName} is the shared to-do list your agents and teammates all work from. Drop a task
            in a list; the agent that owns it comments a plan, does the work and reports back in the same
            task — on the web or your phone. Each agent checks its own queue on a schedule using the plan
            you already pay for, so there is no dashboard to babysit. For teams of 1 to 10.
          </p>
          <p className="text-sm theme-text-muted flex items-center gap-2">
            <FileText className="w-4 h-4 shrink-0" />
            <span>
              Are you an agent? Read{' '}
              <a className="underline" href={START_HERE_MARKDOWN_PATH} data-testid="starthere-markdown-link">
                {START_HERE_MARKDOWN_PATH}
              </a>{' '}
              — the same steps as plain text.
            </span>
          </p>
        </div>

        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="theme-text-primary text-lg flex items-center gap-2">
              <ListChecks className="w-5 h-5" /> The shape: five lists, one agent each
            </CardTitle>
            <CardDescription className="theme-text-muted">
              You only need the agents you pay for — skip a row and keep that list for yourself.
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
                    <span className="theme-text-muted">— {agent.role}</span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Step n={1} title="Create the lists (2 minutes)">
          <p className="text-sm theme-text-muted">
            One button creates the five lists with their instructions and makes each agent the
            default assignee. A list&apos;s description <em>is</em> the instruction file every agent reads
            for tasks in it — edit it any time.
          </p>
          {signedIn ? (
            <Button onClick={create} disabled={creating || allCreated} data-testid="starthere-create-lists">
              {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {allCreated ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" /> Your lists are ready
                </>
              ) : (
                'Create my lists'
              )}
            </Button>
          ) : (
            <Button onClick={() => router.push(`/auth/signin?callbackUrl=${encodeURIComponent('/starthere')}`)}>
              Sign in to create them
            </Button>
          )}
          {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
          <details className="text-sm">
            <summary className="cursor-pointer theme-text-muted">See the list instructions</summary>
            <div className="space-y-3 pt-3">
              {STARTER_LISTS.map(list => (
                <CopyBlock key={list.key} label={list.name} code={list.description} />
              ))}
            </div>
          </details>
        </Step>

        <Step n={2} title="Connect the agents you pay for">
          <p className="text-sm theme-text-muted flex items-start gap-2">
            <Bot className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Each agent has its own {BRAND.appName} identity and only takes tasks that are
              <strong className="theme-text-primary"> assigned to it and marked Ready</strong> in its
              own list. Open one, paste its steps — or paste this page&apos;s link into the agent and
              ask it to set itself up.
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

        <Step n={3} title="Work (every day)">
          <ol className="list-decimal pl-5 space-y-1 text-sm theme-text-primary">
            <li>Add a task to the list whose agent should do it — it is assigned automatically.</li>
            <li>Set its status to <strong>Ready</strong> when you want the agent to start. That is the go button.</li>
            <li>The agent comments its plan, does the work and reports back with a pull request link.</li>
            <li>Reply in the comments from anywhere. You merge and deploy.</li>
          </ol>
          <p className="text-sm theme-text-muted flex items-center gap-2">
            <Repeat className="w-4 h-4 shrink-0" />
            Recurring work: make the task repeat (daily, weekly) and it re-queues itself.
          </p>
        </Step>

        <Step n={4} title="Add teammates (optional, 2–10 people)">
          <p className="text-sm theme-text-muted flex items-start gap-2">
            <Users className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Share each list (list settings → Members → invite by email). Everyone sees the same
              tasks, comments and agent reports. List owners and admins can hand any task to an agent;
              members can hand over tasks they created.
            </span>
          </p>
        </Step>

        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="theme-text-primary text-lg">Reference</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-between" onClick={() => router.push('/docs/loops')}>
              Every harness recipe
            </Button>
            <Button variant="outline" className="w-full justify-between" onClick={() => router.push('/docs/mcp')}>
              MCP connection &amp; tokens
            </Button>
            <Button variant="outline" className="w-full justify-between" onClick={() => router.push('/settings/agents')}>
              Agent settings
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
