import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'

export const FEATURE_KEYS = ['google_tasks'] as const
export type FeatureKey = typeof FEATURE_KEYS[number]
export type RolloutMode = 'OFF' | 'ALL' | 'PERCENTAGE' | 'SELECTED_USERS'
export type Treatment = 'INCLUDE' | 'EXCLUDE'

export interface EvaluatedFeatureFlag {
  key: string
  enabled: boolean
  rolloutMode: RolloutMode
  rolloutPercentage: number
  targets: Array<{ userId: string; treatment: Treatment }>
}

export function stableRolloutBucket(featureKey: string, userId: string): number {
  const prefix = createHash('sha256').update(`${featureKey}:${userId}`).digest().readUInt32BE(0)
  return prefix % 100
}

export function evaluateFeatureFlag(flag: EvaluatedFeatureFlag | null, userId: string): boolean {
  if (!flag?.enabled) return false
  const target = flag.targets.find(item => item.userId === userId)
  if (target?.treatment === 'EXCLUDE') return false
  if (target?.treatment === 'INCLUDE') return true
  if (flag.rolloutMode === 'ALL') return true
  if (flag.rolloutMode === 'PERCENTAGE') {
    return stableRolloutBucket(flag.key, userId) < Math.max(0, Math.min(100, flag.rolloutPercentage))
  }
  return false
}

type CachedFlags = { expiresAt: number; flags: EvaluatedFeatureFlag[]; version: number }
let cache: CachedFlags | null = null
let inFlight: Promise<CachedFlags> | null = null
const SERVER_CACHE_TTL_MS = 30_000

async function loadFlags(): Promise<CachedFlags> {
  if (cache && cache.expiresAt > Date.now()) return cache
  if (inFlight) return inFlight
  inFlight = (async () => {
    const rows = await prisma.featureFlag.findMany({ include: { targets: true } })
    const next = {
      expiresAt: Date.now() + SERVER_CACHE_TTL_MS,
      // Global monotonic-ish configuration version: per-flag counters do not
      // compose once multiple flags exist, while updatedAt does.
      version: rows.reduce((maximum, row) => Math.max(maximum, row.updatedAt.getTime()), 1),
      flags: rows.map(row => ({
        key: row.key,
        enabled: row.enabled,
        rolloutMode: row.rolloutMode as RolloutMode,
        rolloutPercentage: row.rolloutPercentage,
        targets: row.targets.map(target => ({
          userId: target.userId,
          treatment: target.treatment as Treatment,
        })),
      })),
    }
    cache = next
    return next
  })().finally(() => { inFlight = null })
  return inFlight
}

export function invalidateFeatureFlagCache(): void {
  cache = null
}

export async function getEffectiveFeatures(userId: string): Promise<{
  version: number
  features: Record<FeatureKey, boolean>
}> {
  const loaded = await loadFlags()
  const features = Object.fromEntries(FEATURE_KEYS.map(key => [
    key,
    evaluateFeatureFlag(loaded.flags.find(flag => flag.key === key) ?? null, userId),
  ])) as Record<FeatureKey, boolean>
  return { version: loaded.version, features }
}

export async function isFeatureEnabled(key: FeatureKey, userId: string): Promise<boolean> {
  return (await getEffectiveFeatures(userId)).features[key]
}
