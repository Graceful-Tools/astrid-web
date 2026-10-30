/**
 * @vitest-environment node
 *
 * SSE Dedup Comprehensive Tests
 *
 * Tests the dedup logic the agent events endpoint (app/api/v1/agent/events/route.ts)
 * uses: fingerprinting, TTL expiry, and pruning. These are the real functions
 * from lib/agent-protocol — this file used to test an in-file copy whose
 * mapEventType had already drifted from the app's (AWTD-1422).
 */
import { describe, it, expect, vi } from 'vitest'

// agent-protocol pulls in prisma and the auth middleware; dedup needs neither.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI: vi.fn(),
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/oauth/oauth-scopes', () => ({
  hasRequiredScopes: vi.fn().mockReturnValue(true),
}))

import {
  AGENT_EVENT_DEDUP_TTL_MS,
  agentEventFingerprint,
  createAgentEventDedup,
} from '@/lib/agent-protocol'

describe('SSE Dedup — agentEventFingerprint', () => {
  it('should produce correct fingerprint for task.assigned', () => {
    const fp = agentEventFingerprint({
      type: 'task_assigned',
      data: { taskId: 'task-1' },
    })
    expect(fp).toBe('task.assigned:task-1:')
  })

  it('should produce same fingerprint for task_assigned and task_created with same taskId', () => {
    const fp1 = agentEventFingerprint({ type: 'task_assigned', data: { taskId: 'task-1' } })
    const fp2 = agentEventFingerprint({ type: 'task_created', data: { taskId: 'task-1' } })
    expect(fp1).toBe(fp2)
  })

  it('should produce different fingerprints for different taskIds', () => {
    const fp1 = agentEventFingerprint({ type: 'task_assigned', data: { taskId: 'task-1' } })
    const fp2 = agentEventFingerprint({ type: 'task_assigned', data: { taskId: 'task-2' } })
    expect(fp1).not.toBe(fp2)
  })

  it('should include commentId in fingerprint for comment events', () => {
    const fp = agentEventFingerprint({
      type: 'comment_created',
      data: { taskId: 'task-1', comment: { id: 'comment-1' } },
    })
    expect(fp).toBe('task.commented:task-1:comment-1')
  })

  it('should fall back to data.commentId when there is no comment object', () => {
    const fp = agentEventFingerprint({
      type: 'agent_task_comment',
      data: { taskId: 'task-1', commentId: 'c-9' },
    })
    expect(fp).toBe('task.commented:task-1:c-9')
  })

  it('should handle missing data gracefully', () => {
    expect(agentEventFingerprint({ type: 'task_assigned' })).toBe('task.assigned::')
  })

  it('should map comment_added to task.commented', () => {
    const fp = agentEventFingerprint({
      type: 'comment_added',
      data: { taskId: 'task-1', comment: { id: 'c-1' } },
    })
    expect(fp).toBe('task.commented:task-1:c-1')
  })

  it('should keep the raw type for internal events with no agent mapping', () => {
    // mapEventType returns null for these; the fingerprint must not collapse
    // every unmapped type onto one key.
    expect(agentEventFingerprint({ type: 'list_updated', data: { taskId: 't' } })).toBe('list_updated:t:')
    expect(agentEventFingerprint({})).toBe('::')
  })
})

describe('SSE Dedup — createAgentEventDedup', () => {
  it('defaults to a 5-minute window', () => {
    expect(AGENT_EVENT_DEDUP_TTL_MS).toBe(5 * 60_000)
    const dedup = createAgentEventDedup()
    const now = 1_000_000
    dedup.isDuplicate('fp', now)
    expect(dedup.isDuplicate('fp', now + AGENT_EVENT_DEDUP_TTL_MS - 1)).toBe(true)
    expect(dedup.isDuplicate('fp', now + 2 * AGENT_EVENT_DEDUP_TTL_MS)).toBe(false)
  })

  it('should return false for first occurrence', () => {
    const dedup = createAgentEventDedup()
    expect(dedup.isDuplicate('task.assigned:task-1:')).toBe(false)
  })

  it('should return true for same fingerprint within TTL', () => {
    const dedup = createAgentEventDedup()
    const now = Date.now()
    dedup.isDuplicate('task.assigned:task-1:', now)
    expect(dedup.isDuplicate('task.assigned:task-1:', now + 1000)).toBe(true)
  })

  it('should use the real clock when no time is passed', () => {
    vi.useFakeTimers()
    try {
      const dedup = createAgentEventDedup(5_000)
      expect(dedup.isDuplicate('fp')).toBe(false)
      vi.advanceTimersByTime(1_000)
      expect(dedup.isDuplicate('fp')).toBe(true)
      vi.advanceTimersByTime(10_000)
      expect(dedup.isDuplicate('fp')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should return false after TTL expiry', () => {
    const dedup = createAgentEventDedup(5_000)
    const now = Date.now()
    dedup.isDuplicate('task.assigned:task-1:', now)
    expect(dedup.isDuplicate('task.assigned:task-1:', now + 6_000)).toBe(false)
  })

  it('should not dedup different fingerprints', () => {
    const dedup = createAgentEventDedup()
    dedup.isDuplicate('task.assigned:task-1:')
    expect(dedup.isDuplicate('task.assigned:task-2:')).toBe(false)
  })

  it('should keep separate state per checker (one per SSE connection)', () => {
    const a = createAgentEventDedup()
    const b = createAgentEventDedup()
    a.isDuplicate('fp')
    expect(b.isDuplicate('fp')).toBe(false)
  })

  it('should prune expired entries when map exceeds 100', () => {
    const dedup = createAgentEventDedup(100) // 100ms TTL
    const baseTime = Date.now()

    for (let i = 0; i < 101; i++) {
      dedup.isDuplicate(`fp:${i}:`, baseTime)
    }
    expect(dedup.size).toBe(101)

    // One more after TTL triggers pruning: every old entry goes, the new one stays
    dedup.isDuplicate('fp:new:', baseTime + 200)
    expect(dedup.size).toBe(1)
  })

  it('should not prune at or below 100 entries', () => {
    const dedup = createAgentEventDedup(100)
    const baseTime = Date.now()
    for (let i = 0; i < 100; i++) {
      dedup.isDuplicate(`fp:${i}:`, baseTime)
    }
    dedup.isDuplicate('fp:new:', baseTime + 200)
    expect(dedup.size).toBe(101)
  })
})
