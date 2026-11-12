'use client'

import { useSSESubscription } from '@/hooks/use-sse-subscription'

const FEATURE_FLAG_EVENTS = ['feature_flags_updated'] as const

/**
 * The live half of FeatureFlagProvider: tells it when the server's flag version moves.
 *
 * Its own module so the provider can load it after hydration (AWTD-1604). Imported
 * statically, useSSESubscription brought the SSE manager and pino into every page's
 * first-load JS, for a subscription that only matters once a user is signed in.
 */
export function FeatureFlagSSEListener({ onVersion }: { onVersion: (version: number) => void }) {
  useSSESubscription(FEATURE_FLAG_EVENTS, event => {
    onVersion(Number(event.data?.version ?? 0))
  })
  return null
}
