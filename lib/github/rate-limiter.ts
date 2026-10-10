/**
 * The one HTTP path to GitHub's GraphQL API for the Projects backend
 * (AWTD-1150, P4b). Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.8.
 *
 * Three layers, each testable on its own:
 *
 *   admit()            pure: may this call spend `cost` points now, given what
 *                      the bucket has spent this hour and who is asking?
 *   GitHubBudget       the per-installation / per-user-token bucket — Redis
 *                      across instances, memory when Redis is not configured
 *   createGraphqlClient  admit → POST with a 15s timeout → honour GitHub's own
 *                      limits (primary and secondary) → charge the real cost
 *
 * Priority (§8.8): a person's edit goes first, then hydrations, then
 * reconcile. Each class may spend up to its share of the hourly budget, so
 * background work can never use up the room a person's edit needs, and
 * reconcile never takes more than 30%.
 */

import { GITHUB_API_URL } from './host'
import { RedisCache } from '@/lib/redis'

export type GitHubPriority = 'write' | 'hydrate' | 'reconcile'

/**
 * The fraction of the hourly budget each class may have spent before it must
 * wait. Reconcile's 30% is the spec's cap; hydrations stop short of the top so
 * a burst of webhook traffic still leaves edits room to land.
 */
export const PRIORITY_SHARE: Record<GitHubPriority, number> = {
  write: 1,
  hydrate: 0.9,
  reconcile: 0.3,
}

/** GitHub's GraphQL budget for an installation is 5,000 points an hour at minimum. */
export const DEFAULT_HOURLY_POINTS = 5000

/** Every call is bounded (§8.8). */
export const REQUEST_TIMEOUT_MS = 15_000

/** Secondary-limit retries before giving up, and the longest wait we will sit through. */
const MAX_RETRIES = 2
const MAX_RETRY_WAIT_MS = 10_000

export interface BucketState {
  /** Points spent by every class this hour. */
  spent: number
  /** Points spent by reconcile alone this hour. */
  reconcileSpent: number
  /** The hourly budget (GitHub's, as last reported, else the default). */
  limit: number
  /** When GitHub said the budget resets, if it has said; ms since epoch. */
  resetAt: number | null
  /** GitHub's own `remaining`, when it reported one more recent than our tally. */
  remaining: number | null
}

export type Admission = { ok: true } | { ok: false; retryAfterMs: number; reason: 'share' | 'exhausted' }

/**
 * Whether `priority` may spend `cost` more points now.
 *
 * Pure, so the fairness rules are table-tested: shares are of the hourly
 * limit; reconcile's share counts only reconcile's spend (so a busy hour of
 * edits does not starve it outright), while write and hydrate count everything.
 */
export function admit(state: BucketState, priority: GitHubPriority, cost: number, now: number): Admission {
  const waitForReset = Math.max(1000, (state.resetAt ?? now + 60_000) - now)

  if (state.remaining !== null && state.remaining < cost) {
    return { ok: false, retryAfterMs: waitForReset, reason: 'exhausted' }
  }

  const ceiling = state.limit * PRIORITY_SHARE[priority]
  const counted = priority === 'reconcile' ? state.reconcileSpent : state.spent
  if (counted + cost > ceiling) {
    return { ok: false, retryAfterMs: waitForReset, reason: 'share' }
  }
  return { ok: true }
}

export class GitHubRateLimitedError extends Error {
  constructor(
    readonly bucket: string,
    readonly retryAfterMs: number,
    readonly reason: 'share' | 'exhausted' | 'secondary',
  ) {
    super(`GitHub budget for ${bucket} is spent (${reason}); retry in ${Math.ceil(retryAfterMs / 1000)}s`)
    this.name = 'GitHubRateLimitedError'
  }
}

export class GitHubGraphqlError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors?: Array<{ type?: string; message: string }>,
    /** Set when GitHub wants SAML SSO authorisation for this org (X-GitHub-SSO). */
    readonly ssoUrl?: string,
  ) {
    super(message)
    this.name = 'GitHubGraphqlError'
  }
}

// ── Budget storage ──────────────────────────────────────────────────────────

export interface GitHubBudget {
  read(bucket: string): Promise<BucketState>
  charge(bucket: string, priority: GitHubPriority, cost: number, reported?: { remaining: number; limit?: number; resetAt: number }): Promise<void>
}

const HOUR_MS = 3_600_000

function hourKey(bucket: string, now: number): string {
  return `ghrl:${bucket}:${Math.floor(now / HOUR_MS)}`
}

interface StoredBucket {
  spent: number
  reconcileSpent: number
  limit: number
  resetAt: number | null
  remaining: number | null
}

const EMPTY = (): StoredBucket => ({ spent: 0, reconcileSpent: 0, limit: DEFAULT_HOURLY_POINTS, resetAt: null, remaining: null })

/**
 * A bucket per hour window, stored as one small JSON value.
 *
 * Read-modify-write is not atomic across instances; the tally can undercount by
 * a concurrent call or two. That is acceptable because it is a soft limit in
 * front of GitHub's hard one — every response's `remaining` corrects it, and
 * `admit` refuses outright once GitHub says the budget is gone.
 */
export function createBudget(store: {
  get(key: string): Promise<StoredBucket | null>
  set(key: string, value: StoredBucket, ttlSeconds: number): Promise<void>
} = RedisCache as never, clock: () => number = Date.now): GitHubBudget {
  return {
    async read(bucket) {
      return { ...EMPTY(), ...(await store.get(hourKey(bucket, clock()))) }
    },
    async charge(bucket, priority, cost, reported) {
      const key = hourKey(bucket, clock())
      const current = { ...EMPTY(), ...(await store.get(key)) }
      current.spent += cost
      if (priority === 'reconcile') current.reconcileSpent += cost
      if (reported) {
        current.remaining = reported.remaining
        current.resetAt = reported.resetAt
        if (reported.limit) current.limit = reported.limit
      }
      await store.set(key, current, HOUR_MS / 1000 + 60)
    },
  }
}

/** For tests and for running without Redis: one process's memory. */
export function memoryBudgetStore() {
  const map = new Map<string, StoredBucket>()
  return {
    async get(key: string) {
      return map.get(key) ?? null
    },
    async set(key: string, value: StoredBucket) {
      map.set(key, { ...value })
    },
  }
}

// ── The client ──────────────────────────────────────────────────────────────

export interface QueryOptions {
  /**
   * Writes: any GraphQL error fails the call. Reads accept partial data (one
   * unreadable field should not lose a page); a mutation that half-applied
   * must not be reported as done.
   */
  strict?: boolean
}

export interface GraphqlClient {
  query<T>(query: string, variables?: Record<string, unknown>, options?: QueryOptions): Promise<T>
}

export interface GraphqlClientOptions {
  /** The installation or user token. */
  token: string | (() => Promise<string>)
  /** `installation:<id>` or `user:<id>` — whose budget this spends. */
  bucket: string
  priority: GitHubPriority
  budget?: GitHubBudget
  /** Injected so tests replay recorded responses; never the network in unit tests. */
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  clock?: () => number
  /** Points to reserve before a call whose cost is not known yet. */
  estimatedCost?: number
}

interface GraphqlResponse<T> {
  data?: T & { rateLimit?: { cost: number; remaining: number; resetAt: string } }
  errors?: Array<{ type?: string; message: string }>
}

function retryAfterMs(res: Response, now: number): number | null {
  const retryAfter = res.headers.get('retry-after')
  if (retryAfter) return Number(retryAfter) * 1000
  if (res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    if (reset) return Math.max(1000, reset * 1000 - now)
  }
  return null
}

export function createGraphqlClient(options: GraphqlClientOptions): GraphqlClient {
  const budget = options.budget ?? createBudget()
  const doFetch = options.fetch ?? fetch
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const clock = options.clock ?? Date.now
  const estimate = options.estimatedCost ?? 1

  return {
    async query<T>(query: string, variables: Record<string, unknown> = {}, queryOptions: QueryOptions = {}): Promise<T> {
      const admission = admit(await budget.read(options.bucket), options.priority, estimate, clock())
      if (!admission.ok) throw new GitHubRateLimitedError(options.bucket, admission.retryAfterMs, admission.reason)

      const token = typeof options.token === 'function' ? await options.token() : options.token

      for (let attempt = 0; ; attempt++) {
        const res = await doFetch(`${GITHUB_API_URL}/graphql`, {
          method: 'POST',
          headers: {
            authorization: `bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/vnd.github+json',
          },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })

        // Primary (x-ratelimit-remaining: 0) and secondary (retry-after) limits.
        if (res.status === 403 || res.status === 429) {
          const wait = retryAfterMs(res, clock())
          if (wait !== null) {
            if (attempt < MAX_RETRIES && wait <= MAX_RETRY_WAIT_MS) {
              await sleep(wait)
              continue
            }
            throw new GitHubRateLimitedError(options.bucket, wait, 'secondary')
          }
        }

        const body = (await res.json().catch(() => ({}))) as GraphqlResponse<T>
        if (!res.ok) {
          const sso = res.headers.get('x-github-sso')
          const ssoUrl = sso?.match(/url=([^;\s]+)/)?.[1]
          throw new GitHubGraphqlError(`GitHub GraphQL ${res.status}`, res.status, body.errors, ssoUrl)
        }

        const rate = body.data?.rateLimit
        await budget.charge(
          options.bucket,
          options.priority,
          rate?.cost ?? estimate,
          rate ? { remaining: rate.remaining, resetAt: Date.parse(rate.resetAt) } : undefined,
        )

        if (body.errors?.some(e => e.type === 'RATE_LIMITED')) {
          throw new GitHubRateLimitedError(options.bucket, rate ? Math.max(1000, Date.parse(rate.resetAt) - clock()) : 60_000, 'exhausted')
        }
        if (queryOptions.strict && body.errors?.length) {
          const type = body.errors[0].type
          const status = type === 'FORBIDDEN' ? 403 : type === 'NOT_FOUND' ? 404 : 422
          throw new GitHubGraphqlError(body.errors[0].message, status, body.errors)
        }
        // GitHub returns partial data with errors (e.g. one inaccessible
        // field). A query with no data at all is a failure.
        if (!body.data) {
          throw new GitHubGraphqlError(body.errors?.[0]?.message ?? 'GitHub GraphQL returned no data', res.status, body.errors)
        }
        return body.data as T
      }
    },
  }
}
