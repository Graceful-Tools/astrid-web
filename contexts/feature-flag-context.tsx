'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useSSESubscription } from '@/hooks/use-sse-subscription'
import { featureRefreshPolicy, FEATURE_CACHE_TTL_MS } from '@/lib/feature-flag-lifecycle'
import type { FeatureKey } from '@/lib/feature-flags'

type EffectiveFeatures = Record<FeatureKey, boolean>
type Cache = { version: number; features: EffectiveFeatures; updatedAt: number; etag?: string }
// Every key defaults to false, so a client that has not yet loaded flags draws
// no gated UI. Record<FeatureKey, boolean> makes adding a key to FEATURE_KEYS a
// compile error here rather than a silently-missing default.
const DEFAULTS: EffectiveFeatures = { google_tasks: false, project_mode: false, task_cost: false }
interface FeatureFlagContextValue { isEnabled: (key: FeatureKey) => boolean }
const FeatureFlagContext = createContext<FeatureFlagContextValue>({ isEnabled: (_key: FeatureKey) => false })
const FEATURE_FLAG_EVENTS = ['feature_flags_updated'] as const

function idle(callback: () => void): () => void {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(callback, { timeout: 3000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = globalThis.setTimeout(callback, 1)
  return () => globalThis.clearTimeout(id)
}

export function FeatureFlagProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const [features, setFeatures] = useState<EffectiveFeatures>(DEFAULTS)
  const cacheRef = useRef<Cache | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const refreshEligible = useRef(false)

  const refresh = useCallback((force = false) => {
    if (!userId || !refreshEligible.current || inFlight.current) return inFlight.current ?? Promise.resolve()
    if (!force && cacheRef.current && Date.now() - cacheRef.current.updatedAt < FEATURE_CACHE_TTL_MS) return Promise.resolve()
    inFlight.current = fetch('/api/v1/features', {
      credentials: 'include',
      headers: cacheRef.current?.etag ? { 'If-None-Match': cacheRef.current.etag } : {},
    }).then(async response => {
      if (response.status === 304 && cacheRef.current) {
        cacheRef.current = { ...cacheRef.current, updatedAt: Date.now() }
      } else if (response.ok) {
        const body = await response.json()
        const next: Cache = {
          version: body.version,
          features: { ...DEFAULTS, ...body.features },
          updatedAt: Date.now(),
          etag: response.headers.get('etag') ?? undefined,
        }
        cacheRef.current = next
        setFeatures(next.features)
        localStorage.setItem(`astrid.featureFlags.${userId}`, JSON.stringify(next))
      }
    }).catch(() => {}).finally(() => { inFlight.current = null })
    return inFlight.current
  }, [userId])

  useEffect(() => {
    if (!userId) { setFeatures(DEFAULTS); cacheRef.current = null; refreshEligible.current = false; return }
    const cacheKey = `astrid.featureFlags.${userId}`
    const launchKey = 'astrid.featureFlags.launchCount'
    let cached: Cache | null = null
    try { cached = JSON.parse(localStorage.getItem(cacheKey) ?? 'null') } catch { cached = null }
    cacheRef.current = cached
    setFeatures(cached?.features ?? DEFAULTS)
    const launchCount = Number(localStorage.getItem(launchKey) ?? '0')
    const policy = featureRefreshPolicy({ launchCount, cacheUpdatedAt: cached?.updatedAt ?? null, now: Date.now() })
    refreshEligible.current = launchCount > 0
    localStorage.setItem(launchKey, String(policy.nextLaunchCount))
    if (policy.shouldFetch) return idle(() => { void refresh() })
  }, [userId, refresh])

  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => document.removeEventListener('visibilitychange', visible)
  }, [refresh])

  useSSESubscription(FEATURE_FLAG_EVENTS, event => {
    const version = Number(event.data?.version ?? 0)
    if (version > (cacheRef.current?.version ?? 0)) void refresh(true)
  }, { enabled: Boolean(userId) })

  const value = useMemo(() => ({ isEnabled: (key: FeatureKey) => features[key] ?? false }), [features])
  return <FeatureFlagContext.Provider value={value}>{children}</FeatureFlagContext.Provider>
}

export function useFeatureFlags() {
  return useContext(FeatureFlagContext)
}
