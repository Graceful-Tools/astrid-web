/**
 * SSE Dedup Comprehensive Tests
 *
 * Tests the server-side dedup logic in the agent events endpoint.
 * Validates fingerprinting, TTL expiry, and pruning behavior.
 */
import { describe, it, expect } from 'vitest'

// ── Extracted dedup logic for testing ──────────────────────────────────
// These are pure functions extracted from app/api/v1/agent/events/route.ts
// to test the dedup algorithm without needing an SSE stream.

function mapEventType(type: string): string {
  switch (type) {
    case 'task_assigned':
    case 'task_created':
      return 'task.assigned'
    case 'task_updated':
      return 'task.updated'
    case 'task_completed':
      return 'task.completed'
    case 'task_deleted':
      return 'task.deleted'
    case 'comment_created':
    case 'comment_added':
    case 'agent_task_comment':
      return 'task.commented'
    default:
      return type
  }
}

function eventFingerprint(event: { type?: string; data?: { taskId?: string; commentId?: string; comment?: { id?: string } } }) {
  const agentType = mapEventType(event.type || '') || event.type || ''
  const taskId = event.data?.taskId || ''
  const commentId = event.data?.comment?.id || event.data?.commentId || ''
  return `${agentType}:${taskId}:${commentId}`
}

function createDedupChecker(ttlMs: number) {
  const deliveredEvents = new Map<string, number>()

  return {
    isDuplicate(fp: string, now = Date.now()): boolean {
      if (deliveredEvents.size > 100) {
        for (const [key, ts] of deliveredEvents) {
          if (now - ts > ttlMs) deliveredEvents.delete(key)
        }
      }
      if (deliveredEvents.has(fp)) {
        const age = now - deliveredEvents.get(fp)!
        if (age < ttlMs) return true
      }
      deliveredEvents.set(fp, now)
      return false
    },
    get size() { return deliveredEvents.size },
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('SSE Dedup — eventFingerprint', () => {
  it('should produce correct fingerprint for task.assigned', () => {
    const fp = eventFingerprint({
      type: 'task_assigned',
      data: { taskId: 'task-1' },
    })
    expect(fp).toBe('task.assigned:task-1:')
  })

  it('should produce same fingerprint for task_assigned and task_created with same taskId', () => {
    const fp1 = eventFingerprint({
      type: 'task_assigned',
      data: { taskId: 'task-1' },
    })
    const fp2 = eventFingerprint({
      type: 'task_created',
      data: { taskId: 'task-1' },
    })
    expect(fp1).toBe(fp2)
  })

  it('should produce different fingerprints for different taskIds', () => {
    const fp1 = eventFingerprint({
      type: 'task_assigned',
      data: { taskId: 'task-1' },
    })
    const fp2 = eventFingerprint({
      type: 'task_assigned',
      data: { taskId: 'task-2' },
    })
    expect(fp1).not.toBe(fp2)
  })

  it('should include commentId in fingerprint for comment events', () => {
    const fp = eventFingerprint({
      type: 'comment_created',
      data: { taskId: 'task-1', comment: { id: 'comment-1' } },
    })
    expect(fp).toBe('task.commented:task-1:comment-1')
  })

  it('should handle missing data gracefully', () => {
    const fp = eventFingerprint({ type: 'task_assigned' })
    expect(fp).toBe('task.assigned::')
  })

  it('should map comment_added to task.commented', () => {
    const fp = eventFingerprint({
      type: 'comment_added',
      data: { taskId: 'task-1', comment: { id: 'c-1' } },
    })
    expect(fp).toBe('task.commented:task-1:c-1')
  })
})

describe('SSE Dedup — isDuplicate', () => {
  it('should return false for first occurrence', () => {
    const dedup = createDedupChecker(5 * 60_000)
    expect(dedup.isDuplicate('task.assigned:task-1:')).toBe(false)
  })

  it('should return true for same fingerprint within TTL', () => {
    const dedup = createDedupChecker(5 * 60_000)
    const now = Date.now()
    dedup.isDuplicate('task.assigned:task-1:', now)
    expect(dedup.isDuplicate('task.assigned:task-1:', now + 1000)).toBe(true)
  })

  it('should return false after TTL expiry', () => {
    const dedup = createDedupChecker(5_000) // 5 second TTL for test
    const now = Date.now()
    dedup.isDuplicate('task.assigned:task-1:', now)
    // After TTL expiry
    expect(dedup.isDuplicate('task.assigned:task-1:', now + 6_000)).toBe(false)
  })

  it('should not dedup different fingerprints', () => {
    const dedup = createDedupChecker(5 * 60_000)
    dedup.isDuplicate('task.assigned:task-1:')
    expect(dedup.isDuplicate('task.assigned:task-2:')).toBe(false)
  })

  it('should prune expired entries when map exceeds 100', () => {
    const dedup = createDedupChecker(100) // 100ms TTL
    const baseTime = Date.now()

    // Add 101 entries at baseTime
    for (let i = 0; i < 101; i++) {
      dedup.isDuplicate(`fp:${i}:`, baseTime)
    }
    expect(dedup.size).toBe(101)

    // Check one more after TTL — should trigger pruning
    dedup.isDuplicate('fp:new:', baseTime + 200)
    // Pruning happened — old entries removed, new one added
    expect(dedup.size).toBeLessThanOrEqual(2) // only the new entry (and maybe 101th)
  })
})
