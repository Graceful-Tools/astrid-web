'use client'

import { BRAND } from '@/lib/brand/config'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { AlertTriangle, Check, ChevronLeft, Flag, Inbox, Percent, Power, Save, UserCheck, Users, UserX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  buildFeatureRolloutDraft,
  describeEffectiveRollout,
  normalizeOverrideEmails,
  rolloutDraftChanged,
  type FeatureRolloutDraft,
  type RolloutMode,
} from '@/lib/feature-rollout-ui'

interface FeatureTarget { treatment: 'INCLUDE' | 'EXCLUDE'; user: { email: string } | null }
interface FeatureFlag {
  key: string
  displayName: string
  description: string | null
  enabled: boolean
  rolloutMode: RolloutMode
  rolloutPercentage: number
  version: number
  targets: FeatureTarget[]
  /** Rides along on GET /api/admin/features so the link can show a count. */
  pendingRequests?: number
  updatedAt: string
}

const MODES: Array<{ mode: RolloutMode; title: string; description: string; icon: typeof Power }> = [
  { mode: 'OFF', title: 'Nobody', description: 'Disable for every user. Saved overrides are ignored.', icon: Power },
  { mode: 'SELECTED_USERS', title: 'Selected users', description: 'Only people listed under Include.', icon: UserCheck },
  { mode: 'PERCENTAGE', title: 'Percentage', description: 'A stable cohort plus inclusions.', icon: Percent },
  { mode: 'ALL', title: 'Everyone', description: 'All users except explicit exclusions.', icon: Users },
]

/**
 * One feature's rollout controls, keyed by the URL (task 3cef96ef).
 *
 * This page WAS /admin/features and was hardcoded to google_tasks: it fetched
 * every flag and then did find(key === 'google_tasks'), so project_mode and
 * task_cost had no rollout UI at all. Jon: "This should link to a separate
 * admin page for every pending feature with the same set of options."
 *
 * Same options, now for whichever key the URL names. The copy that said
 * "Google Tasks" reads the flag's displayName instead, so a fourth feature
 * needs no edit here.
 */
export default function FeatureRolloutPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useParams<{ key: string }>()
  const featureKey = typeof params?.key === 'string' ? params.key : ''
  const [flag, setFlag] = useState<FeatureFlag | null>(null)
  const [savedDraft, setSavedDraft] = useState<FeatureRolloutDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [includedEmails, setIncludedEmails] = useState('')
  const [excludedEmails, setExcludedEmails] = useState('')

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/features')
    if (response.status === 403) { setError('Admin access required'); return }
    if (!response.ok) { setError('Unable to load feature rollouts'); return }
    const data = await response.json()
    const current: FeatureFlag | null = data.flags.find((item: FeatureFlag) => item.key === featureKey) ?? null
    setFlag(current)
    const included = current?.targets.filter(target => target.treatment === 'INCLUDE').map(target => target.user?.email).filter((email): email is string => Boolean(email)).join('\n') ?? ''
    const excluded = current?.targets.filter(target => target.treatment === 'EXCLUDE').map(target => target.user?.email).filter((email): email is string => Boolean(email)).join('\n') ?? ''
    setIncludedEmails(included)
    setExcludedEmails(excluded)
    if (current) setSavedDraft(buildFeatureRolloutDraft({ enabled: current.enabled, rolloutMode: current.rolloutMode, rolloutPercentage: current.rolloutPercentage, included, excluded }))
  }, [featureKey])

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin')
    else if (status === 'authenticated') void load()
  }, [load, router, status])

  const draft = useMemo(() => buildFeatureRolloutDraft({
    enabled: flag?.enabled ?? false,
    rolloutMode: flag?.rolloutMode ?? 'OFF',
    rolloutPercentage: flag?.rolloutPercentage ?? 0,
    included: includedEmails,
    excluded: excludedEmails,
  }), [excludedEmails, flag?.enabled, flag?.rolloutMode, flag?.rolloutPercentage, includedEmails])
  const dirty = rolloutDraftChanged(savedDraft, draft)
  const included = normalizeOverrideEmails(includedEmails)
  const excluded = normalizeOverrideEmails(excludedEmails)

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const save = async () => {
    if (!flag || !dirty || draft.invalidEmails.length) return
    if (flag.enabled && flag.rolloutMode === 'ALL' && !confirm(`Enable ${flag.displayName} for all users except the exclusion list?`)) return
    setSaving(true)
    try {
      const response = await fetch('/api/admin/features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: flag.key,
          enabled: draft.enabled,
          rolloutMode: draft.rolloutMode,
          rolloutPercentage: draft.rolloutPercentage,
          includedEmails: draft.includedEmails,
          excludedEmails: draft.excludedEmails,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to save rollout')
      toast.success('Feature rollout saved')
      await load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to save rollout')
    } finally { setSaving(false) }
  }

  if (status === 'loading' || (!flag && !error)) return <div className="flex min-h-screen items-center justify-center">Loading…</div>
  if (error) return <div className="container mx-auto p-8 text-red-600">{error}</div>
  if (!flag) return <div className="container mx-auto p-8">No feature flag named &quot;{featureKey}&quot; is seeded. <Link href="/admin/features" className="underline">Back to all features</Link></div>

  const saveDisabled = saving || !dirty || draft.invalidEmails.length > 0
  const effectiveSummary = describeEffectiveRollout(flag.enabled, flag.rolloutMode, flag.rolloutPercentage, draft.includedEmails.length, draft.excludedEmails.length)
  const pausedIncludedUser = !flag.enabled ? draft.includedEmails[0] : undefined
  const nobodyHasInclusions = flag.enabled && flag.rolloutMode === 'OFF' && draft.includedEmails.length > 0

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <header data-testid="admin-save-header" className="mb-6 flex flex-col gap-4 border-b bg-background/95 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <Link href="/admin/features" className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ChevronLeft className="h-4 w-4" />All features</Link>
            <h1 className="text-2xl font-bold">{flag.displayName}</h1>
            <p className="text-sm text-muted-foreground">Control availability without shipping another client build.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 self-end sm:self-auto">
          <Link href={`/admin/features/${flag.key}/requests`}>
            <Badge variant="outline" className="gap-1 hover:bg-accent">
              <Inbox className="h-3 w-3" />
              {flag.pendingRequests ? `${flag.pendingRequests} pending` : 'Access requests'}
            </Badge>
          </Link>
          <Badge variant={dirty ? 'secondary' : 'outline'}>{dirty ? 'Unsaved changes' : 'All changes saved'}</Badge>
          <Button onClick={save} disabled={saveDisabled} className="min-w-36"><Save className="mr-2 h-4 w-4" />{saving ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </header>

      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div><CardTitle className="flex items-center gap-2"><Flag className="h-5 w-5" />{flag.displayName}</CardTitle><CardDescription className="mt-1">{flag.description}</CardDescription></div>
            <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
              <div className="text-right"><Label htmlFor="feature-master">Master availability</Label><p className="text-xs text-muted-foreground">{flag.enabled ? 'Rollout rules are active' : 'Off for every user'}</p></div>
              <Switch id="feature-master" checked={flag.enabled} onCheckedChange={enabled => setFlag({ ...flag, enabled })} />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-8 pt-6">
          <Alert className={flag.enabled ? 'border-blue-500/40 bg-blue-500/5' : ''}>
            {flag.enabled ? <Check className="h-4 w-4" /> : <Power className="h-4 w-4" />}
            <AlertTitle>Effective access</AlertTitle>
            <AlertDescription>{effectiveSummary}</AlertDescription>
          </Alert>

          {pausedIncludedUser && <Alert className="border-amber-500/50 bg-amber-500/10">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Rollout paused</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{pausedIncludedUser}{draft.includedEmails.length > 1 ? ` and ${draft.includedEmails.length - 1} other included user${draft.includedEmails.length === 2 ? '' : 's'}` : ''} will not receive {flag.displayName} until master availability is on.</p>
              <Button type="button" size="sm" onClick={() => setFlag({ ...flag, enabled: true })}>Activate rollout</Button>
            </AlertDescription>
          </Alert>}

          {nobodyHasInclusions && <Alert className="border-amber-500/50 bg-amber-500/10">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Nobody means nobody</AlertTitle>
            <AlertDescription>Your saved inclusion is inactive until you select Selected users, Percentage, or Everyone.</AlertDescription>
          </Alert>}

          <section className="space-y-3">
            <div><h2 className="font-semibold">1. Choose the base rollout</h2><p className="text-sm text-muted-foreground">This rule applies after the master switch and before per-user overrides.</p></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {MODES.map(({ mode, title, description, icon: Icon }) => {
                const selected = flag.rolloutMode === mode
                return <button key={mode} type="button" onClick={() => setFlag({ ...flag, rolloutMode: mode })} className={`rounded-lg border p-4 text-left transition ${selected ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'hover:border-muted-foreground/50'}`} aria-pressed={selected}>
                  <div className="mb-2 flex items-center justify-between"><Icon className="h-5 w-5" />{selected && <Check className="h-4 w-4 text-primary" />}</div><p className="font-medium">{title}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p>
                </button>
              })}
            </div>
            {flag.rolloutMode === 'PERCENTAGE' && <div className="max-w-xs space-y-2"><Label htmlFor="rollout-percentage">Rollout percentage</Label><div className="flex items-center gap-2"><Input id="rollout-percentage" type="number" min={0} max={100} value={flag.rolloutPercentage} onChange={event => setFlag({ ...flag, rolloutPercentage: Math.max(0, Math.min(100, Number(event.target.value))) })} /><span className="font-medium">%</span></div><p className="text-xs text-muted-foreground">The same users remain in the cohort as the percentage changes.</p></div>}
          </section>

          <section className="space-y-3">
            <div><h2 className="font-semibold">2. Add user overrides</h2><p className="text-sm text-muted-foreground"><strong>Nobody disables access for everyone.</strong> In other modes, Excluded wins, then Included, then the base rollout. Enter one email per line or separate with commas.</p></div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 rounded-lg border border-green-500/30 p-4"><Label htmlFor="included-users" className="flex items-center gap-2"><UserCheck className="h-4 w-4 text-green-600" />Include when active</Label><Textarea id="included-users" value={includedEmails} onChange={event => setIncludedEmails(event.target.value)} placeholder={`tester@${BRAND.domain}\nanother@${BRAND.domain}`} rows={5} /><p className="text-xs text-muted-foreground">{flag.rolloutMode === 'OFF' ? `${draft.includedEmails.length} saved user${draft.includedEmails.length === 1 ? '' : 's'}; inactive while Nobody is selected.` : `${draft.includedEmails.length} valid user${draft.includedEmails.length === 1 ? '' : 's'} will receive the feature whenever master availability is on.`}</p></div>
              <div className="space-y-2 rounded-lg border border-red-500/30 p-4"><Label htmlFor="excluded-users" className="flex items-center gap-2"><UserX className="h-4 w-4 text-red-600" />Always exclude</Label><Textarea id="excluded-users" value={excludedEmails} onChange={event => setExcludedEmails(event.target.value)} placeholder={`user@${BRAND.domain}`} rows={5} /><p className="text-xs text-muted-foreground">{draft.excludedEmails.length} valid user{draft.excludedEmails.length === 1 ? '' : 's'} will never receive the feature.</p></div>
            </div>
            {draft.invalidEmails.length > 0 && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Fix invalid email addresses before saving</AlertTitle><AlertDescription>{draft.invalidEmails.join(', ')}</AlertDescription></Alert>}
            {included.emails.some(email => excluded.emails.includes(email)) && <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>Duplicate override resolved</AlertTitle><AlertDescription>A user listed in both boxes will be excluded.</AlertDescription></Alert>}
          </section>

          <div className="flex flex-col gap-2 border-t pt-4 text-xs text-muted-foreground sm:flex-row sm:justify-between"><span>Version {flag.version} · Updated {new Date(flag.updatedAt).toLocaleString()}</span><span>Signed in as {session?.user?.email}</span></div>
        </CardContent>
      </Card>

      <div data-testid="admin-bottom-actions" className="mb-8 mt-4 flex items-center justify-between rounded-xl border bg-background p-3 shadow-sm">
        <div className="text-sm"><p className="font-medium">{dirty ? 'Your changes are not live yet.' : 'This rollout is up to date.'}</p><p className="hidden text-xs text-muted-foreground sm:block">{dirty ? 'Review the effective-access summary, then save.' : effectiveSummary}</p></div>
        <Button onClick={save} disabled={saveDisabled} className="min-w-36"><Save className="mr-2 h-4 w-4" />{saving ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </div>
  )
}
