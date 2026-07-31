/**
 * Regression tests for task 51a4b8ff — append-only activity history.
 *
 * The diff is the part worth pinning hardest: it decides what the history
 * says, and (once notifications land) who gets told.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: { taskEvent: { createMany } },
}))

import { diffTaskEvents, recordTaskEvents, coalesceEvents } from '@/lib/task-events'

describe('diffTaskEvents (51a4b8ff)', () => {
  it('reports nothing when nothing changed', () => {
    const snapshot = { title: 'A', completed: false, priority: 1, assigneeId: 'u1' }
    expect(diffTaskEvents(snapshot, snapshot)).toEqual([])
  })

  it('reports a title change with both values', () => {
    expect(diffTaskEvents({ title: 'Old' }, { title: 'New' }))
      .toEqual([{ kind: 'title_changed', from: 'Old', to: 'New' }])
  })

  it('distinguishes completed, closed and reopened', () => {
    // Three outcomes anyone reporting on this wants to tell apart, so they are
    // three kinds rather than one completed_changed.
    expect(diffTaskEvents({ completed: false }, { completed: true }))
      .toEqual([{ kind: 'completed', from: false, to: true }])

    expect(diffTaskEvents({ completed: false }, { completed: true, closedReason: 'canceled' }))
      .toEqual([{ kind: 'closed', from: null, to: 'canceled' }])

    expect(diffTaskEvents({ completed: true }, { completed: false }))
      .toEqual([{ kind: 'reopened', from: true, to: false }])
  })

  it('reports a reclassification from done to won\'t-do', () => {
    const events = diffTaskEvents(
      { completed: true, closedReason: null },
      { completed: true, closedReason: 'canceled' }
    )
    expect(events).toEqual([{ kind: 'closed', from: null, to: 'canceled' }])
  })

  it('distinguishes assignment from unassignment', () => {
    expect(diffTaskEvents({ assigneeId: null }, { assigneeId: 'u2' }))
      .toEqual([{ kind: 'assigned', from: null, to: 'u2' }])
    expect(diffTaskEvents({ assigneeId: 'u2' }, { assigneeId: null }))
      .toEqual([{ kind: 'unassigned', from: 'u2', to: null }])
  })

  it('compares due dates by instant, not by reference', () => {
    const a = new Date('2026-08-01T10:00:00.000Z')
    const b = new Date('2026-08-01T10:00:00.000Z')
    expect(diffTaskEvents({ dueDateTime: a }, { dueDateTime: b })).toEqual([])

    const events = diffTaskEvents({ dueDateTime: a }, { dueDateTime: new Date('2026-08-02T10:00:00.000Z') })
    expect(events[0].kind).toBe('due_changed')
  })

  it('accepts ISO strings for dates as well as Date objects', () => {
    expect(diffTaskEvents(
      { dueDateTime: '2026-08-01T10:00:00.000Z' },
      { dueDateTime: new Date('2026-08-01T10:00:00.000Z') }
    )).toEqual([])
  })

  it('reports list membership as separate add and remove events', () => {
    const events = diffTaskEvents({ listIds: ['a', 'b'] }, { listIds: ['b', 'c'] })
    expect(events).toEqual([
      { kind: 'list_added', to: 'c' },
      { kind: 'list_removed', from: 'a' },
    ])
  })

  it('ignores fields absent from the "after" snapshot', () => {
    // A partial update must not report every unmentioned field as cleared.
    expect(diffTaskEvents({ title: 'A', priority: 3, assigneeId: 'u1' }, { title: 'B' }))
      .toEqual([{ kind: 'title_changed', from: 'A', to: 'B' }])
  })

  it('reports several changes from one update', () => {
    const events = diffTaskEvents(
      { title: 'A', priority: 0, assigneeId: null },
      { title: 'B', priority: 3, assigneeId: 'u1' }
    )
    expect(events.map(e => e.kind)).toEqual(['title_changed', 'priority_changed', 'assigned'])
  })
})

describe('recordTaskEvents (51a4b8ff)', () => {
  beforeEach(() => createMany.mockReset())

  it('writes one row per event', async () => {
    await recordTaskEvents({
      taskId: 't1',
      actorId: 'u1',
      actorType: 'user',
      events: [{ kind: 'completed', from: false, to: true }],
    })

    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ taskId: 't1', actorId: 'u1', actorType: 'user', kind: 'completed' })],
    })
  })

  it('does not touch the database when there is nothing to record', async () => {
    await recordTaskEvents({ taskId: 't1', actorType: 'user', events: [] })
    expect(createMany).not.toHaveBeenCalled()
  })

  it('NEVER throws — a failed history write must not fail the mutation', async () => {
    // Losing someone's task edit because the audit trail failed would be a
    // strictly worse bug than having no audit trail.
    //
    // The failing client is injected directly rather than via the module mock:
    // that keeps the rejection inside this call, where recordTaskEvents' own
    // try/catch is the only thing that can handle it, which is exactly the
    // contract under test.
    const failing = {
      taskEvent: {
        createMany: async () => {
          throw new Error('db exploded')
        },
      },
    } as never

    let threw = false
    try {
      await recordTaskEvents({
        taskId: 't1',
        actorType: 'user',
        events: [{ kind: 'completed' }],
        client: failing,
      })
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
  })

  it('records agent and sync actors distinctly', async () => {
    await recordTaskEvents({ taskId: 't1', actorId: 'agent-1', actorType: 'agent', events: [{ kind: 'completed' }] })
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ actorType: 'agent' })],
    })
  })
})

describe('coalesceEvents (51a4b8ff)', () => {
  it('collapses a burst of edits to the same field by the same actor', () => {
    const collapsed = coalesceEvents([
      { kind: 'priority_changed', actorId: 'u1', from: 0, to: 1 },
      { kind: 'priority_changed', actorId: 'u1', from: 1, to: 2 },
      { kind: 'priority_changed', actorId: 'u1', from: 2, to: 3 },
    ])

    // One intent, not three — and the collapsed event still describes the whole
    // transition, 0 → 3, not just the last hop.
    expect(collapsed).toEqual([{ kind: 'priority_changed', actorId: 'u1', from: 0, to: 3 }])
  })

  it('keeps different actors separate', () => {
    const collapsed = coalesceEvents([
      { kind: 'priority_changed', actorId: 'u1', from: 0, to: 1 },
      { kind: 'priority_changed', actorId: 'u2', from: 1, to: 2 },
    ])
    expect(collapsed).toHaveLength(2)
  })

  it('does not collapse distinct list memberships together', () => {
    // These carry their identity in the value; collapsing by kind alone would
    // silently lose memberships.
    const collapsed = coalesceEvents([
      { kind: 'list_added', actorId: 'u1', to: 'list-a' },
      { kind: 'list_added', actorId: 'u1', to: 'list-b' },
    ])
    expect(collapsed).toHaveLength(2)
  })

  it('preserves order of first appearance', () => {
    const collapsed = coalesceEvents([
      { kind: 'title_changed', actorId: 'u1', to: 'X' },
      { kind: 'priority_changed', actorId: 'u1', to: 2 },
      { kind: 'title_changed', actorId: 'u1', to: 'Y' },
    ])
    expect(collapsed.map(e => e.kind)).toEqual(['title_changed', 'priority_changed'])
    expect(collapsed[0].to).toBe('Y')
  })
})
