'use client'

/**
 * Every feature, with a link to its own rollout page (task 3cef96ef).
 *
 * Jon: "Currently /admin has only one feature in feature rollouts. This should
 * link to a separate admin page for every pending feature with the same set of
 * options... Pending requests should be per-feature and should be a general
 * config manager."
 *
 * WHAT WAS ACTUALLY WRONG, because it is not what it looked like. This page
 * already fetched EVERY flag and then threw all but one away —
 * `find(key === 'google_tasks')`. So project_mode and task_cost had rollout
 * rows in the database, an API that could edit them, and no way to reach them.
 * The server never needed changing; only this did.
 *
 * DRIVEN OFF THE FLAG ROWS, never a hand-kept list. A fourth feature added to
 * FEATURE_KEYS and seeded appears here and gets its own page with no edit to
 * this file — which is the "general config manager" part of the ask.
 *
 * The pending count is the number that decides which feature to open, so it is
 * on the row rather than a page away. It rides along on the same request (see
 * app/api/admin/features/route.ts) instead of costing one call per feature.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ChevronRight, Flag, Inbox } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { describeEffectiveRollout, type RolloutMode } from '@/lib/feature-rollout-ui'

interface FeatureTarget { treatment: 'INCLUDE' | 'EXCLUDE'; user: { email: string } | null }
interface FeatureFlag {
  key: string
  displayName: string
  description: string | null
  enabled: boolean
  rolloutMode: RolloutMode
  rolloutPercentage: number
  targets: FeatureTarget[]
  pendingRequests: number
  updatedAt: string
}

export default function FeatureRolloutsIndexPage() {
  const { status } = useSession()
  const router = useRouter()
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/features')
    if (response.status === 403) { setError('Admin access required'); return }
    if (!response.ok) { setError('Unable to load feature rollouts'); return }
    const data = await response.json()
    setFlags(data.flags ?? [])
  }, [])

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin')
    else if (status === 'authenticated') void load()
  }, [load, router, status])

  if (status === 'loading' || (!flags && !error)) {
    return <div className="flex min-h-screen items-center justify-center">Loading…</div>
  }
  if (error) return <div className="container mx-auto p-8 text-red-600">{error}</div>

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <header className="mb-6 border-b py-3">
        <h1 className="text-2xl font-bold">Feature Rollouts</h1>
        <p className="text-sm text-muted-foreground">
          Control availability without shipping another client build. Open a feature to change its
          rollout or review who is waiting for it.
        </p>
      </header>

      {flags && flags.length === 0 && (
        <Card><CardContent className="py-8 text-center text-muted-foreground">
          No feature flags are seeded yet.
        </CardContent></Card>
      )}

      <div className="space-y-3">
        {flags?.map(flag => {
          const included = flag.targets.filter(target => target.treatment === 'INCLUDE').length
          const excluded = flag.targets.filter(target => target.treatment === 'EXCLUDE').length
          return (
            <Link key={flag.key} href={`/admin/features/${flag.key}`} className="block">
              <Card className="transition hover:border-muted-foreground/50">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Flag className="h-4 w-4 shrink-0" />
                        <span className="truncate">{flag.displayName}</span>
                      </CardTitle>
                      <CardDescription className="mt-1">{flag.description}</CardDescription>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {/* Zero is rendered as nothing rather than a "0" badge: an
                          empty queue is the normal state and should not compete
                          for attention with one that needs action. */}
                      {flag.pendingRequests > 0 && (
                        <Badge variant="secondary" className="gap-1">
                          <Inbox className="h-3 w-3" />
                          {flag.pendingRequests} pending
                        </Badge>
                      )}
                      <Badge variant={flag.enabled ? 'default' : 'outline'}>
                        {flag.enabled ? 'Active' : 'Off'}
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 text-sm text-muted-foreground">
                  {describeEffectiveRollout(
                    flag.enabled,
                    flag.rolloutMode,
                    flag.rolloutPercentage,
                    included,
                    excluded,
                  )}
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
