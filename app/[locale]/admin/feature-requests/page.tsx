'use client'

/**
 * Feature access request queue (task dd7172d8).
 *
 * This page answers the question the gate exists to answer: **how many people
 * actually want Project Mode?** The demand tiles are the headline; the queue
 * below is how you act on it.
 *
 * Granting here is the admin opt-in — it adds the user as an INCLUDE target on
 * the `project_mode` flag, which is seeded SELECTED_USERS, so a grant takes
 * effect immediately without touching the rollout page.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Check, Inbox, TrendingUp, UserCheck, UserX, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import type { FeatureDemandSummary } from '@/lib/feature-access-requests'

interface RequestRow {
  id: string
  featureKey: string
  useCase: string | null
  status: 'PENDING' | 'GRANTED' | 'DECLINED'
  grandfathered: boolean
  createdAt: string
  user: { id: string; email: string; name: string | null } | null
}

const FEATURE_KEY = 'project_mode'

export default function FeatureRequestsPage() {
  const { status } = useSession()
  const router = useRouter()
  const [demand, setDemand] = useState<FeatureDemandSummary | null>(null)
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/feature-requests?featureKey=${FEATURE_KEY}`)
    if (response.status === 403) { setError('Admin access required'); return }
    if (!response.ok) { setError('Unable to load access requests'); return }
    const data = await response.json()
    setDemand(data.demand)
    setRequests(data.requests)
  }, [])

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin')
    else if (status === 'authenticated') void load()
  }, [load, router, status])

  const review = async (requestId: string, decision: 'GRANTED' | 'DECLINED') => {
    setBusyId(requestId)
    try {
      const response = await fetch('/api/admin/feature-requests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, decision }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to save decision')
      toast.success(decision === 'GRANTED' ? 'Access granted' : 'Request declined')
      await load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to save decision')
    } finally {
      setBusyId(null)
    }
  }

  if (status === 'loading' || (!demand && !error)) {
    return <div className="flex min-h-screen items-center justify-center">Loading…</div>
  }
  if (error) return <div className="container mx-auto p-8 text-red-600">{error}</div>

  const pending = requests.filter(row => row.status === 'PENDING')
  const decided = requests.filter(row => row.status !== 'PENDING' && !row.grandfathered)

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <header className="mb-6 border-b pb-4">
        <h1 className="text-2xl font-bold">Access Requests</h1>
        <p className="text-sm text-muted-foreground">
          Who is asking for Project Mode, and how many of them there are.
        </p>
      </header>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DemandTile icon={Users} label="People who asked" value={demand?.requested ?? 0}
          hint="Excludes users grandfathered in with an existing board" />
        <DemandTile icon={Inbox} label="Awaiting review" value={demand?.pending ?? 0} />
        <DemandTile icon={TrendingUp} label="Asked in last 7 days" value={demand?.last7Days ?? 0} />
        <DemandTile icon={UserCheck} label="Granted" value={demand?.granted ?? 0}
          hint={demand?.grandfathered ? `+${demand.grandfathered} grandfathered` : undefined} />
      </div>

      <Card className="mb-6">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2"><Inbox className="h-5 w-5" />Pending</CardTitle>
          <CardDescription>
            Granting adds the user to the Project Mode include list — it takes effect immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waiting.</p>
          ) : (
            <ul className="space-y-3">
              {pending.map(row => (
                <li key={row.id} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">{row.user?.name || row.user?.email || 'Unknown user'}</p>
                      {row.user?.name && <p className="text-xs text-muted-foreground">{row.user.email}</p>}
                      <p className="mt-2 whitespace-pre-wrap text-sm">
                        {row.useCase || <span className="text-muted-foreground">No use case given.</span>}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Asked {new Date(row.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" disabled={busyId === row.id} onClick={() => review(row.id, 'GRANTED')}>
                        <Check className="mr-1 h-4 w-4" />Grant
                      </Button>
                      <Button size="sm" variant="outline" disabled={busyId === row.id}
                        onClick={() => review(row.id, 'DECLINED')}>
                        <UserX className="mr-1 h-4 w-4" />Decline
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {decided.length > 0 && (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Reviewed</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <ul className="space-y-2">
              {decided.map(row => (
                <li key={row.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{row.user?.email || 'Unknown user'}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={row.status === 'GRANTED' ? 'default' : 'outline'}>{row.status}</Badge>
                    <Button size="sm" variant="ghost" disabled={busyId === row.id}
                      onClick={() => review(row.id, row.status === 'GRANTED' ? 'DECLINED' : 'GRANTED')}>
                      {row.status === 'GRANTED' ? 'Revoke' : 'Grant'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function DemandTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users
  label: string
  value: number
  hint?: string
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-3xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
