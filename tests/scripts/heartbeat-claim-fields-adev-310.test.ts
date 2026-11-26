/**
 * ADEV-310: the claim heartbeat never renewed a lease.
 *
 * scripts/heartbeat-held-claims.ts reads the board through `GET /api/v1/tasks`
 * (SDK getBoardTasks). That route's select, `v1TaskListSelect`, did not carry
 * `claimHolderId`, `claimLeaseExpiresAt` or `claimHeartbeatAt`, so every row
 * reached `claimsToRenew` with them undefined and it renewed nothing. Leases
 * lapsed after 15 minutes, the task went back to Ready, and a cloud worker
 * built a duplicate (#1015/#1016, #1018/#1020).
 *
 * These tests run a full Task row through the route's own select and shaper,
 * then through JSON (dates become strings, as on the wire), and hand the
 * result to the consumers.
 */
import { describe, expect, it } from 'vitest'
import { shapeV1ListPageTask, v1TaskListSelect } from '@/lib/tasks/v1-task-shape'
import { claimsToRenew, type HeldClaimTask } from '../../scripts/lib/held-claims'
import { hasLiveClaimLease, type DoingTask } from '../../scripts/lib/doing-release'

const runStartedAt = new Date('2026-11-26T08:00:00Z')
const now = new Date('2026-11-26T08:10:00Z')

/** A Task row as Prisma holds it: every scalar, dates as Date. */
const dbRow = {
  id: 'task-1',
  title: 'A claimed task',
  description: 'text',
  assigneeId: 'ai-agent-claude',
  assigneeIds: ['ai-agent-claude'],
  creatorId: 'jon',
  statusRole: 'doing',
  completed: false,
  identifier: 'ADEV-310',
  sequence: 310,
  createdAt: new Date('2026-11-26T07:00:00Z'),
  updatedAt: new Date('2026-11-26T08:05:00Z'),
  claimHolderId: 'ai-agent-claude',
  claimLeaseExpiresAt: new Date('2026-11-26T08:20:00Z'),
  claimHeartbeatAt: new Date('2026-11-26T08:05:00Z'),
  handoffReturnAssigneeId: null,
  remoteNodeId: null,
  remoteKind: null,
  remoteVersion: null,
  syncState: null,
  lists: [{ id: 'board', ownerId: 'jon', name: 'Board', color: '#000', githubRepositoryId: null }],
}

/** What Prisma returns for a `select`: the top-level scalar keys the select names. */
function applySelect(row: Record<string, unknown>, select: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(select)) {
    if (value === true && key in row) out[key] = row[key]
    else if (value && typeof value === 'object' && key in row) out[key] = row[key]
  }
  return out
}

/** One row of `GET /api/v1/tasks`, as a client receives it. */
function listRouteRow() {
  const select = v1TaskListSelect({
    omit: new Set(['description']),
    leanListMembers: true,
    includeComments: false,
    includeFields: false,
  })
  const shaped = shapeV1ListPageTask(applySelect(dbRow, select) as Parameters<typeof shapeV1ListPageTask>[0])
  return JSON.parse(JSON.stringify(shaped)) as Record<string, unknown>
}

describe('GET /api/v1/tasks carries the claim lease (ADEV-310)', () => {
  it('v1TaskListSelect selects claimHolderId, claimLeaseExpiresAt and claimHeartbeatAt', () => {
    const select = v1TaskListSelect({
      omit: new Set(),
      leanListMembers: false,
      includeComments: false,
      includeFields: false,
    }) as Record<string, unknown>
    expect(select.claimHolderId).toBe(true)
    expect(select.claimLeaseExpiresAt).toBe(true)
    expect(select.claimHeartbeatAt).toBe(true)
  })

  it('a list-route row carries the three fields on the wire', () => {
    const row = listRouteRow()
    expect(row.claimHolderId).toBe('ai-agent-claude')
    expect(row.claimLeaseExpiresAt).toBe('2026-11-26T08:20:00.000Z')
    expect(row.claimHeartbeatAt).toBe('2026-11-26T08:05:00.000Z')
  })
})

describe('the consumers see a live lease in a list-route row (ADEV-310)', () => {
  it('claimsToRenew picks up a live Doing claim this run holds', () => {
    const row = listRouteRow() as unknown as HeldClaimTask
    expect(claimsToRenew([row], { agentId: 'ai-agent-claude', runStartedAt, now })).toEqual(['task-1'])
  })

  it('hasLiveClaimLease reads the lease as live', () => {
    // release-stuck-doing.ts picks its candidates from this route and then reads each
    // through GET /api/v1/tasks/:id, which always carried the fields; either shape must do.
    const row = listRouteRow() as unknown as DoingTask
    expect(hasLiveClaimLease(row, now)).toBe(true)
  })
})

describe('the heartbeat says when it renews nothing (ADEV-310)', () => {
  it('counts Doing tasks and the ones this agent holds', async () => {
    const { nothingToRenewLine } = await import('../../scripts/lib/held-claims')
    const tasks = [
      { id: 'a', statusRole: 'doing', claimHolderId: 'ai-agent-claude' },
      { id: 'b', statusRole: 'Doing', claimHolderId: 'ai-agent-codex' },
      { id: 'c', statusRole: 'ready', claimHolderId: null },
    ]
    expect(nothingToRenewLine(tasks, 'ai-agent-claude')).toBe('HEARTBEAT: nothing to renew (2 doing, 1 mine)')
  })

  it('heartbeat-held-claims.ts prints that line when claimsToRenew is empty', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('scripts/heartbeat-held-claims.ts', 'utf8')
    expect(src).toMatch(/if \(ids\.length === 0\) console\.log\(nothingToRenewLine\(/)
  })
})
