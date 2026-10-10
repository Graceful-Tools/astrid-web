/**
 * AWTD-1150 (P4b): the GitHub rate limiter (spec §8.8).
 *
 * Pinned here:
 *   - priority: a person's write may use the whole budget, hydrations 90%,
 *     reconcile at most 30% (counting only its own spend);
 *   - GitHub's own `remaining` overrides our tally;
 *   - every response's rateLimit.cost is charged to the bucket;
 *   - secondary limits (retry-after) are waited out, twice, then surfaced;
 *   - every call carries a 15s timeout and goes to the configured host.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  admit,
  createBudget,
  createGraphqlClient,
  memoryBudgetStore,
  GitHubRateLimitedError,
  GitHubGraphqlError,
  REQUEST_TIMEOUT_MS,
  type BucketState,
} from '@/lib/github/rate-limiter'
import { GITHUB_API_URL } from '@/lib/github/host'

const NOW = Date.parse('2026-10-10T12:00:00Z')
const state = (over: Partial<BucketState> = {}): BucketState => ({
  spent: 0,
  reconcileSpent: 0,
  limit: 5000,
  resetAt: NOW + 30 * 60_000,
  remaining: null,
  ...over,
})

describe('admit: priority shares of the hourly budget (AWTD-1150)', () => {
  it.each([
    ['write', 4999, true],
    ['hydrate', 4499, true],
    ['hydrate', 4500, false],
    ['reconcile', 1499, true],
    ['reconcile', 1500, false],
  ] as const)('%s with %i spent → %s', (priority, spent, ok) => {
    const s = state({ spent, reconcileSpent: priority === 'reconcile' ? spent : 0 })
    expect(admit(s, priority, 1, NOW).ok).toBe(ok)
  })

  it('reconcile is capped by its OWN spend, so a busy hour of edits does not starve it', () => {
    expect(admit(state({ spent: 4000, reconcileSpent: 100 }), 'reconcile', 1, NOW).ok).toBe(true)
  })

  it('a refusal says when to come back: at the reset', () => {
    expect(admit(state({ reconcileSpent: 1500, spent: 1500 }), 'reconcile', 1, NOW)).toEqual({
      ok: false,
      retryAfterMs: 30 * 60_000,
      reason: 'share',
    })
  })

  it("GitHub's own remaining wins over our tally — even for a write", () => {
    expect(admit(state({ spent: 10, remaining: 0 }), 'write', 1, NOW)).toMatchObject({ ok: false, reason: 'exhausted' })
  })
})

describe('createBudget (AWTD-1150)', () => {
  it('tallies per bucket per hour, reconcile separately, and records what GitHub reported', async () => {
    const budget = createBudget(memoryBudgetStore(), () => NOW)
    await budget.charge('installation:1', 'hydrate', 3)
    await budget.charge('installation:1', 'reconcile', 2, { remaining: 4900, resetAt: NOW + 1000 })
    await budget.charge('installation:2', 'write', 7)

    expect(await budget.read('installation:1')).toMatchObject({ spent: 5, reconcileSpent: 2, remaining: 4900, resetAt: NOW + 1000 })
    expect((await budget.read('installation:2')).spent).toBe(7)
  })

  it('starts a fresh tally each hour', async () => {
    let now = NOW
    const budget = createBudget(memoryBudgetStore(), () => now)
    await budget.charge('installation:1', 'hydrate', 3)
    now += 3_600_000
    expect((await budget.read('installation:1')).spent).toBe(0)
  })
})

function respond(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: init.headers })
}

const OK = { data: { viewer: { login: 'x' }, rateLimit: { cost: 3, remaining: 4990, resetAt: '2026-10-10T12:30:00Z' } } }

describe('createGraphqlClient (AWTD-1150)', () => {
  const client = (fetchImpl: typeof fetch, extra: Partial<Parameters<typeof createGraphqlClient>[0]> = {}) => {
    const budget = createBudget(memoryBudgetStore(), () => NOW)
    return {
      budget,
      client: createGraphqlClient({
        token: 'ghs_test',
        bucket: 'installation:42',
        priority: 'hydrate',
        budget,
        fetch: fetchImpl,
        sleep: async () => {},
        clock: () => NOW,
        ...extra,
      }),
    }
  }

  it('POSTs to the configured host with the token and a 15s timeout, and charges the reported cost', async () => {
    const fetchImpl = vi.fn(async () => respond(OK))
    const { client: c, budget } = client(fetchImpl as never)

    expect(await c.query('{ viewer { login } }')).toMatchObject({ viewer: { login: 'x' } })

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${GITHUB_API_URL}/graphql`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('bearer ghs_test')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(REQUEST_TIMEOUT_MS).toBe(15_000)
    expect(await budget.read('installation:42')).toMatchObject({ spent: 3, remaining: 4990 })
  })

  it('refuses before calling GitHub when the share is spent', async () => {
    const fetchImpl = vi.fn(async () => respond(OK))
    const { client: c, budget } = client(fetchImpl as never, { priority: 'reconcile' })
    await budget.charge('installation:42', 'reconcile', 1500)

    await expect(c.query('{ x }')).rejects.toBeInstanceOf(GitHubRateLimitedError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('waits out a secondary limit and retries', async () => {
    const sleep = vi.fn(async () => {})
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond({ message: 'secondary rate limit' }, { status: 403, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(respond(OK))
    const { client: c } = client(fetchImpl, { sleep })

    await c.query('{ x }')
    expect(sleep).toHaveBeenCalledWith(2000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('gives up after two retries, saying how long to wait', async () => {
    const limited = () => respond({}, { status: 429, headers: { 'retry-after': '5' } })
    const fetchImpl = vi.fn(async () => limited())
    const { client: c } = client(fetchImpl as never)

    await expect(c.query('{ x }')).rejects.toMatchObject({ name: 'GitHubRateLimitedError', retryAfterMs: 5000, reason: 'secondary' })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('a primary limit far in the future is surfaced, not slept through', async () => {
    const reset = String(Math.floor(NOW / 1000) + 600)
    const fetchImpl = vi.fn(async () =>
      respond({}, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } }),
    )
    const sleep = vi.fn(async () => {})
    const { client: c } = client(fetchImpl as never, { sleep })

    await expect(c.query('{ x }')).rejects.toMatchObject({ retryAfterMs: 600_000 })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('a GraphQL RATE_LIMITED error is a rate limit, not a crash', async () => {
    const fetchImpl = vi.fn(async () =>
      respond({ data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }),
    )
    const { client: c } = client(fetchImpl as never)
    await expect(c.query('{ x }')).rejects.toBeInstanceOf(GitHubRateLimitedError)
  })

  it('an HTTP error carries its status and GitHub’s errors', async () => {
    const fetchImpl = vi.fn(async () => respond({ errors: [{ message: 'Bad credentials' }] }, { status: 401 }))
    const { client: c } = client(fetchImpl as never)
    await expect(c.query('{ x }')).rejects.toMatchObject({ name: 'GitHubGraphqlError', status: 401 })
    await expect(c.query('{ x }')).rejects.toBeInstanceOf(GitHubGraphqlError)
  })

  it('resolves a lazy token once per call', async () => {
    const token = vi.fn(async () => 'ghs_lazy')
    const fetchImpl = vi.fn(async () => respond(OK))
    const { client: c } = client(fetchImpl as never, { token })
    await c.query('{ x }')
    expect(token).toHaveBeenCalledTimes(1)
    expect(((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>).authorization).toBe('bearer ghs_lazy')
  })
})
