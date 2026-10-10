/**
 * AWTD-1113 (P3c): the GitHub App's webhook handles `issues` and
 * `issue_comment`, nudging every user with a list linked to that repo exactly
 * as the per-repo hook (/api/webhooks/github-issues) does — the SSE payload iOS
 * consumes is unchanged: external_sync_refresh {provider:'GITHUB_ISSUES', container}.
 *
 * The per-repo hook needed a secret set up by hand on every repo; the App's
 * webhook arrives for every repo it is installed on. GitHub redelivers, and
 * during the transition a repo may be on both, so the App side de-duplicates
 * on X-GitHub-Delivery.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import crypto from 'node:crypto'

const { SECRET, sendEventToUser, claimOnce, isRedisAvailable, capabilityState } = vi.hoisted(() => {
  process.env.GITHUB_WEBHOOK_SECRET = 'app-webhook-secret'
  return {
    SECRET: 'app-webhook-secret',
    sendEventToUser: vi.fn(),
    claimOnce: vi.fn(),
    isRedisAvailable: vi.fn(),
    capabilityState: { syncGithubIssues: true },
  }
})

vi.mock('@/lib/sse-utils', () => ({ sendEventToUser }))
vi.mock('@/lib/redis', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/redis')>()
  return { ...actual, isRedisAvailable, RedisCache: { ...actual.RedisCache, claimOnce } }
})
vi.mock('@/lib/brand/capabilities', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/brand/capabilities')>()
  return {
    ...actual,
    hasCapability: (key: string) =>
      key === 'syncGithubIssues' ? capabilityState.syncGithubIssues : actual.hasCapability(key as never),
  }
})

import { mockPrisma } from '../setup'
import { POST } from '@/app/api/github/webhooks/route'

function signed(event: string, payload: unknown, delivery: string = crypto.randomUUID()) {
  const body = JSON.stringify(payload)
  const signature = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex')
  const headers = new Map([
    ['x-hub-signature-256', signature],
    ['x-github-event', event],
    ['x-github-delivery', delivery],
  ])
  return { text: async () => body, headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null } } as any
}

const ISSUE_EVENT = {
  action: 'edited',
  issue: { number: 7, title: 'x' },
  repository: { full_name: 'acme/api' },
  installation: { id: 111 },
}

describe('App webhook: issues and issue_comment nudge linked users (AWTD-1113)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capabilityState.syncGithubIssues = true
    isRedisAvailable.mockResolvedValue(true)
    claimOnce.mockResolvedValue(true)
    mockPrisma.externalListLink.findMany.mockResolvedValue([
      { id: 'l1', userId: 'u1' },
      { id: 'l2', userId: 'u1' },
      { id: 'l3', userId: 'u2' },
    ])
  })

  it('an issues event nudges each linked user once, with the payload iOS already consumes', async () => {
    const res = await POST(signed('issues', ISSUE_EVENT))

    expect(res.status).toBe(200)
    expect(mockPrisma.externalListLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider: 'GITHUB_ISSUES', remoteContainerId: 'acme/api' } }),
    )
    expect(sendEventToUser).toHaveBeenCalledTimes(2)
    expect(sendEventToUser).toHaveBeenCalledWith('u1', {
      type: 'external_sync_refresh',
      data: { provider: 'GITHUB_ISSUES', container: 'acme/api' },
    })
  })

  it('an issue_comment event nudges too', async () => {
    await POST(signed('issue_comment', { ...ISSUE_EVENT, action: 'created', comment: { body: 'hi' } }))

    expect(sendEventToUser).toHaveBeenCalledWith('u2', expect.objectContaining({ type: 'external_sync_refresh' }))
  })

  it('a redelivered event (same X-GitHub-Delivery) nudges nobody the second time', async () => {
    claimOnce.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await POST(signed('issues', ISSUE_EVENT, 'delivery-1'))
    await POST(signed('issues', ISSUE_EVENT, 'delivery-1'))

    expect(claimOnce).toHaveBeenCalledWith('github:delivery:delivery-1', expect.any(Number))
    expect(sendEventToUser).toHaveBeenCalledTimes(2) // first delivery only
  })

  it('still nudges when Redis is down: a duplicate nudge is harmless, a lost one is not', async () => {
    isRedisAvailable.mockResolvedValue(false)

    await POST(signed('issues', ISSUE_EVENT))

    expect(sendEventToUser).toHaveBeenCalledTimes(2)
  })

  it('does nothing for Issues sync on a deployment that has it switched off', async () => {
    capabilityState.syncGithubIssues = false

    await POST(signed('issues', ISSUE_EVENT))

    expect(sendEventToUser).not.toHaveBeenCalled()
  })
})
