'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ChevronLeft, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'

type RolloutMode = 'OFF' | 'ALL' | 'PERCENTAGE' | 'SELECTED_USERS'
interface FeatureTarget { treatment: 'INCLUDE' | 'EXCLUDE'; user: { email: string } | null }
interface FeatureFlag {
  key: 'google_tasks'
  displayName: string
  description: string | null
  enabled: boolean
  rolloutMode: RolloutMode
  rolloutPercentage: number
  version: number
  targets: FeatureTarget[]
  updatedAt: string
}

export default function FeatureRolloutsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [flag, setFlag] = useState<FeatureFlag | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [includedEmails, setIncludedEmails] = useState('')
  const [excludedEmails, setExcludedEmails] = useState('')

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/features')
    if (response.status === 403) { setError('Admin access required'); return }
    if (!response.ok) { setError('Unable to load feature rollouts'); return }
    const data = await response.json()
    const google = data.flags.find((item: FeatureFlag) => item.key === 'google_tasks') ?? null
    setFlag(google)
    setIncludedEmails(google?.targets.filter((target: FeatureTarget) => target.treatment === 'INCLUDE').map((target: FeatureTarget) => target.user?.email).filter(Boolean).join(', ') ?? '')
    setExcludedEmails(google?.targets.filter((target: FeatureTarget) => target.treatment === 'EXCLUDE').map((target: FeatureTarget) => target.user?.email).filter(Boolean).join(', ') ?? '')
  }, [])

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin')
    else if (status === 'authenticated') void load()
  }, [load, router, status])

  const emails = (value: string) => value.split(/[\s,]+/).map(item => item.trim()).filter(Boolean)
  const save = async () => {
    if (!flag) return
    if ((flag.enabled && flag.rolloutMode === 'ALL') && !confirm('Enable Google Tasks for all users?')) return
    setSaving(true)
    try {
      const response = await fetch('/api/admin/features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: flag.key,
          enabled: flag.enabled,
          rolloutMode: flag.rolloutMode,
          rolloutPercentage: flag.rolloutPercentage,
          includedEmails: emails(includedEmails),
          excludedEmails: emails(excludedEmails),
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to save rollout')
      toast.success('Feature rollout updated')
      await load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to save rollout')
    } finally { setSaving(false) }
  }

  if (status === 'loading' || (!flag && !error)) return <div className="flex min-h-screen items-center justify-center">Loading…</div>
  if (error) return <div className="container mx-auto p-8 text-red-600">{error}</div>
  if (!flag) return <div className="container mx-auto p-8">Google Tasks flag is not seeded.</div>

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8 flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/admin/analytics')}><ChevronLeft /></Button>
        <div><h1 className="text-2xl font-bold">Feature Rollouts</h1><p className="text-muted-foreground">Safely release features without adding startup work.</p></div>
      </div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Flag className="h-5 w-5" />{flag.displayName}</CardTitle><CardDescription>{flag.description}</CardDescription></CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between"><div><Label>Master switch</Label><p className="text-xs text-muted-foreground">Off overrides every rollout rule.</p></div><Switch checked={flag.enabled} onCheckedChange={enabled => setFlag({ ...flag, enabled })} /></div>
          <div className="space-y-2"><Label>Rollout</Label><Select value={flag.rolloutMode} onValueChange={(rolloutMode: RolloutMode) => setFlag({ ...flag, rolloutMode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="OFF">Off</SelectItem><SelectItem value="SELECTED_USERS">Selected users</SelectItem><SelectItem value="PERCENTAGE">Percentage</SelectItem><SelectItem value="ALL">All users</SelectItem></SelectContent></Select></div>
          {flag.rolloutMode === 'PERCENTAGE' && <div className="space-y-2"><Label>Percentage (0–100)</Label><Input type="number" min={0} max={100} value={flag.rolloutPercentage} onChange={event => setFlag({ ...flag, rolloutPercentage: Math.max(0, Math.min(100, Number(event.target.value))) })} /></div>}
          <div className="space-y-2"><Label>Explicitly include</Label><Input value={includedEmails} onChange={event => setIncludedEmails(event.target.value)} placeholder="tester@astrid.cc, another@astrid.cc" /><p className="text-xs text-muted-foreground">Comma or space separated. Includes override mode and percentage.</p></div>
          <div className="space-y-2"><Label>Explicitly exclude</Label><Input value={excludedEmails} onChange={event => setExcludedEmails(event.target.value)} placeholder="user@astrid.cc" /><p className="text-xs text-muted-foreground">Exclusions always win.</p></div>
          <div className="flex items-center justify-between border-t pt-4"><p className="text-xs text-muted-foreground">Version {flag.version} · Updated {new Date(flag.updatedAt).toLocaleString()} · Signed in as {session?.user?.email}</p><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save rollout'}</Button></div>
        </CardContent>
      </Card>
    </div>
  )
}
