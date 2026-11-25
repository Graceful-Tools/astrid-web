/**
 * AWTD-1688 — the pure lease rules: when a lease has run out, and what an
 * expired one does to its task.
 */
import { describe, expect, it } from 'vitest'
import {
  claimLeaseExpiry,
  claimsOnBehalfOfAgent,
  decideExpiredLease,
  expiredLeaseComment,
  hasCurrentHandoffMarker,
  isClaimLeaseExpired,
  parseAgentTaskClaimRequest,
} from '@/lib/agent-task-claim'

const NOW = new Date('2026-11-16T00:00:00.000Z')
const held = {
  statusRole: 'doing', completed: false, assigneeId: 'agent-1', assigneeIds: ['agent-1', 'human-1'],
  claimHolderId: 'agent-1', enrolled: false,
}

describe('claim lease rules (AWTD-1688)', () => {
  it('a lease runs out at its end, not before; no lease never runs out', () => {
    const end = claimLeaseExpiry(NOW, 60)
    expect(end.toISOString()).toBe('2026-11-16T00:01:00.000Z')
    expect(claimLeaseExpiry(NOW).getTime() - NOW.getTime()).toBe(900_000)
    expect(isClaimLeaseExpired({ claimLeaseExpiresAt: end }, new Date(end.getTime() - 1))).toBe(false)
    expect(isClaimLeaseExpired({ claimLeaseExpiresAt: end }, end)).toBe(true)
    expect(isClaimLeaseExpired({ claimLeaseExpiresAt: null }, NOW)).toBe(false)
  })

  it('releases a task its holder still has in Doing, keeping the assignment on a board that is not enrolled', () => {
    expect(decideExpiredLease(held)).toEqual({ kind: 'release', assigneeId: 'agent-1', assigneeIds: ['agent-1', 'human-1'] })
  })

  it('unassigns the holder on an enrolled board, so the task goes back to the pool', () => {
    expect(decideExpiredLease({ ...held, enrolled: true })).toEqual({ kind: 'release', assigneeId: 'human-1', assigneeIds: ['human-1'] })
    expect(decideExpiredLease({ ...held, assigneeIds: ['agent-1'], enrolled: true }))
      .toEqual({ kind: 'release', assigneeId: null, assigneeIds: [] })
  })

  it.each([
    ['completed', { completed: true }],
    ['moved out of Doing', { statusRole: 'waiting' }],
    ['reassigned to someone else', { assigneeId: 'human-1' }],
    ['no holder recorded', { claimHolderId: null }],
  ])('only clears the lease on a task that was %s', (_label, change) => {
    expect(decideExpiredLease({ ...held, ...change })).toEqual({ kind: 'clear' })
  })

  it('ADEV-266: finished work awaiting its deploy or merge keeps its claim and Doing; only the lease clears', () => {
    expect(decideExpiredLease({ ...held, awaitingHandoff: true })).toEqual({ kind: 'clear' })
    expect(decideExpiredLease({ ...held, enrolled: true, awaitingHandoff: true })).toEqual({ kind: 'clear' })
  })

  it('ADEV-266: a handoff marker counts until a completion, release or rework supersedes it', () => {
    const marker = { content: 'Done.\nAWAITING-MERGE: Graceful-Tools/astrid-core#122 ' + 'a'.repeat(40), createdAt: '2026-11-25T04:13:00Z' }
    expect(hasCurrentHandoffMarker([marker])).toBe(true)
    expect(hasCurrentHandoffMarker([{ content: 'AWAITING-DEPLOY: ' + 'b'.repeat(40), createdAt: '2026-11-25T04:13:00Z' }])).toBe(true)
    expect(hasCurrentHandoffMarker([{ content: 'no marker', createdAt: '2026-11-25T04:13:00Z' }])).toBe(false)
    expect(hasCurrentHandoffMarker([marker, { content: '🔁 Released from Doing by the scheduled /fixall loop. x', createdAt: '2026-11-25T04:20:00Z' }])).toBe(false)
    expect(hasCurrentHandoffMarker([marker, { content: '🛠️ Sent back by the ship workflow', createdAt: '2026-11-25T04:20:00Z' }])).toBe(false)
    expect(hasCurrentHandoffMarker([marker, { content: '🔁 Returned to Ready: lease', createdAt: '2026-11-25T04:25:00Z' }])).toBe(true)
  })

  it('says why the task is back in Ready', () => {
    const text = expiredLeaseComment(new Date('2026-11-15T23:45:00.000Z'), NOW)
    expect(text).toContain('claim lease expired at 2026-11-16T00:00:00.000Z')
    expect(text).toContain('no heartbeat since 2026-11-15T23:45:00.000Z')
  })

  it('accepts heartbeat and leaseSeconds; refuses anything else', () => {
    expect(parseAgentTaskClaimRequest({ action: 'heartbeat', leaseSeconds: 600 })).toEqual({ action: 'heartbeat', leaseSeconds: 600 })
    expect(() => parseAgentTaskClaimRequest({ action: 'resume', leaseSeconds: 600 })).toThrow()
    expect(() => parseAgentTaskClaimRequest({ action: 'claim', leaseSeconds: '600' })).toThrow()
    expect(() => parseAgentTaskClaimRequest({ action: 'claim', lease: 600 })).toThrow()
  })

  it('a person\'s token may name the agent it claims for; an agent\'s token and a browser session may not', () => {
    expect(claimsOnBehalfOfAgent({ source: 'oauth', isAIAgent: false, agentUser: null })).toBe(true)
    expect(claimsOnBehalfOfAgent({ source: 'legacy_mcp', isAIAgent: false, agentUser: null })).toBe(true)
    expect(claimsOnBehalfOfAgent({ source: 'session', isAIAgent: false, agentUser: null })).toBe(false)
    expect(claimsOnBehalfOfAgent({ source: 'oauth', isAIAgent: true, agentUser: null })).toBe(false)
    expect(claimsOnBehalfOfAgent({
      source: 'oauth', isAIAgent: false, agentUser: { id: 'a', email: 'a@x', name: null, isAIAgent: true },
    })).toBe(false)
  })
})
