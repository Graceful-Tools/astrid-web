/**
 * Feature access requests — the demand-measurement half of gated features
 * (task dd7172d8).
 *
 * Pure helpers only: validation, normalization and the demand summary. The
 * persistence and email side effects live in the route handlers so this file
 * stays trivially testable.
 *
 * Deliberately says nothing about payments or entitlements. A request is a
 * signal that someone wants a feature, nothing more.
 */

import { FEATURE_KEYS, type FeatureKey } from '@/lib/feature-flags'

export type FeatureRequestStatus = 'PENDING' | 'GRANTED' | 'DECLINED'

export const FEATURE_REQUEST_STATUSES: readonly FeatureRequestStatus[] = [
  'PENDING',
  'GRANTED',
  'DECLINED',
]

/** Longest use-case note we store. Long enough to be useful, short enough that
 *  the admin queue stays skimmable and the column can't be used as blob storage. */
export const MAX_USE_CASE_LENGTH = 1000

export interface FeatureRequestInput {
  featureKey: unknown
  useCase?: unknown
}

export type FeatureRequestParseResult =
  | { ok: true; featureKey: FeatureKey; useCase: string | null }
  | { ok: false; error: string }

function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && (FEATURE_KEYS as readonly string[]).includes(value)
}

/**
 * Validate and normalize a request body.
 *
 * An empty or whitespace-only use case normalizes to null rather than "" — the
 * admin queue renders "no note given" for null, and we don't want two
 * representations of the same thing.
 */
export function parseFeatureRequest(input: FeatureRequestInput): FeatureRequestParseResult {
  if (!isFeatureKey(input.featureKey)) {
    return { ok: false, error: 'Unknown feature' }
  }

  if (input.useCase !== undefined && input.useCase !== null && typeof input.useCase !== 'string') {
    return { ok: false, error: 'useCase must be a string' }
  }

  const trimmed = typeof input.useCase === 'string' ? input.useCase.trim() : ''
  if (trimmed.length > MAX_USE_CASE_LENGTH) {
    return { ok: false, error: `useCase must be ${MAX_USE_CASE_LENGTH} characters or fewer` }
  }

  return { ok: true, featureKey: input.featureKey, useCase: trimmed.length > 0 ? trimmed : null }
}

export interface FeatureRequestRow {
  status: string
  grandfathered: boolean
  createdAt: Date | string
}

export interface FeatureDemandSummary {
  /** Every request row, including grandfathered ones. */
  total: number
  /** Distinct people who actually asked — the number worth reporting. */
  requested: number
  pending: number
  granted: number
  declined: number
  /** Auto-granted because they already had a board; excluded from `requested`. */
  grandfathered: number
  /** Requests created in the last 7 days, excluding grandfathered rows. */
  last7Days: number
}

/**
 * Roll a set of request rows into the numbers the admin page shows.
 *
 * `requested` deliberately excludes grandfathered rows: those users never asked
 * for anything, they just happened to have a board when the gate landed.
 * Counting them as demand would overstate the signal on day one, which is the
 * exact question this feature exists to answer.
 */
export function summarizeFeatureDemand(
  rows: FeatureRequestRow[],
  now: Date = new Date()
): FeatureDemandSummary {
  const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000

  let pending = 0
  let granted = 0
  let declined = 0
  let grandfathered = 0
  let requested = 0
  let last7Days = 0

  for (const row of rows) {
    if (row.grandfathered) {
      grandfathered += 1
    } else {
      requested += 1
      const created = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)
      if (created.getTime() >= sevenDaysAgo) last7Days += 1
    }

    if (row.status === 'PENDING') pending += 1
    else if (row.status === 'GRANTED') granted += 1
    else if (row.status === 'DECLINED') declined += 1
  }

  return {
    total: rows.length,
    requested,
    pending,
    granted,
    declined,
    grandfathered,
    last7Days,
  }
}

/**
 * Where feature-request notifications go.
 *
 * Env-overridable because a whitelabel partner running their own deployment
 * must be able to route requests to their own team rather than ours — the same
 * reasoning as every other brand-configurable address.
 */
export function featureRequestRecipient(): string {
  return process.env.FEATURE_REQUEST_EMAIL || 'jon@gracefultools.com'
}
