/**
 * List insights (AWTD-1329). The computation is pure, so every number the API returns — and every
 * platform renders — is pinned here against hand-built history.
 */
import { describe, it, expect } from 'vitest'
import {
  computeListInsights,
  dayKey,
  median,
  windowDays,
  windowQueryStart,
  type InsightEvent,
  type InsightTask,
  type ListInsightsInput,
} from '@/lib/list-insights'

const NOW = new Date('2026-10-22T18:00:00Z')
const HOUR = 60 * 60 * 1000

function task(overrides: Partial<InsightTask> & { id: string }): InsightTask {
  return {
    createdAt: new Date('2026-10-20T12:00:00Z'),
    creatorId: 'jon',
    completed: false,
    completedAt: null,
    repeating: 'never',
    ...overrides,
  }
}

function event(overrides: Partial<InsightEvent> & { taskId: string; kind: string; createdAt: Date }): InsightEvent {
  return { actorId: 'jon', from: null, to: null, ...overrides }
}

function input(overrides: Partial<ListInsightsInput> = {}): ListInsightsInput {
  return {
    now: NOW,
    days: 7,
    timeZone: 'UTC',
    tasks: [],
    events: [],
    comments: [],
    users: [
      { id: 'jon', name: 'Jon', image: null, isAIAgent: false },
      { id: 'claude', name: 'Claude', image: null, isAIAgent: true },
    ],
    lanes: null,
    ...overrides,
  }
}

describe('the window', () => {
  it('is the last N calendar days in the zone, ending today', () => {
    expect(windowDays(NOW, 3, 'UTC')).toEqual(['2026-10-20', '2026-10-21', '2026-10-22'])
  })

  it('uses the viewer\'s calendar, not UTC', () => {
    // 02:00 UTC on the 23rd is still the 22nd in Los Angeles.
    const lateEvening = new Date('2026-10-23T02:00:00Z')
    expect(dayKey(lateEvening, 'America/Los_Angeles')).toBe('2026-10-22')
    expect(windowDays(lateEvening, 1, 'America/Los_Angeles')).toEqual(['2026-10-22'])
  })

  it('does not skip or repeat a day across a DST change', () => {
    // US DST ended 2026-11-01.
    const keys = windowDays(new Date('2026-11-03T12:00:00Z'), 5, 'America/New_York')
    expect(keys).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'])
  })

  it('queries from a day before the window so every zone\'s first day is covered', () => {
    expect(windowQueryStart(NOW, 7, 'UTC').toISOString()).toBe('2026-10-15T00:00:00.000Z')
  })
})

describe('median', () => {
  it('is null for nothing, not zero', () => {
    expect(median([])).toBeNull()
  })
  it('takes the middle, or the mean of the two middles', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})

describe('new and completed over time', () => {
  it('counts tasks created in the window by day, and ignores older ones', () => {
    const result = computeListInsights(input({
      tasks: [
        task({ id: 'a', createdAt: new Date('2026-10-22T09:00:00Z') }),
        task({ id: 'b', createdAt: new Date('2026-10-22T10:00:00Z') }),
        task({ id: 'old', createdAt: new Date('2026-09-01T10:00:00Z') }),
      ],
    }))
    expect(result.series).toHaveLength(7)
    expect(result.series.at(-1)).toEqual({ date: '2026-10-22', created: 2, completed: 0 })
    expect(result.totals.created).toBe(2)
  })

  it('counts each completion of a repeating task from its events', () => {
    const result = computeListInsights(input({
      tasks: [task({ id: 'r', repeating: 'daily', createdAt: new Date('2026-01-01T00:00:00Z') })],
      events: [
        event({ taskId: 'r', kind: 'completed', createdAt: new Date('2026-10-20T08:00:00Z') }),
        event({ taskId: 'r', kind: 'completed', createdAt: new Date('2026-10-21T08:00:00Z') }),
      ],
    }))
    expect(result.totals.completed).toBe(2)
  })

  it('falls back to completedAt for a task completed before events existed, without double counting', () => {
    const done = new Date('2026-10-21T08:00:00Z')
    const result = computeListInsights(input({
      tasks: [
        task({ id: 'legacy', completed: true, completedAt: done }),
        task({ id: 'evented', completed: true, completedAt: done }),
      ],
      events: [event({ taskId: 'evented', kind: 'completed', createdAt: done })],
    }))
    expect(result.series.find(day => day.date === '2026-10-21')?.completed).toBe(2)
  })

  it('ignores events on tasks that are not on the list', () => {
    const result = computeListInsights(input({
      events: [event({ taskId: 'elsewhere', kind: 'completed', createdAt: new Date('2026-10-21T08:00:00Z') })],
    }))
    expect(result.totals.completed).toBe(0)
    expect(result.contributors).toEqual([])
  })
})

describe('create → complete', () => {
  it('is the median over one-off tasks completed in the window', () => {
    const created = new Date('2026-10-20T00:00:00Z')
    const result = computeListInsights(input({
      tasks: [
        task({ id: 'a', createdAt: created, completed: true, completedAt: new Date(created.getTime() + 2 * HOUR) }),
        task({ id: 'b', createdAt: created, completed: true, completedAt: new Date(created.getTime() + 4 * HOUR) }),
        task({ id: 'c', createdAt: created, completed: true, completedAt: new Date(created.getTime() + 30 * HOUR) }),
        // Repeating: createdAt is the series' birth, not this occurrence's.
        task({ id: 'r', repeating: 'weekly', createdAt: new Date('2025-01-01T00:00:00Z'), completed: true, completedAt: new Date('2026-10-21T00:00:00Z') }),
        // Completed before the window.
        task({ id: 'old', createdAt: new Date('2026-01-01T00:00:00Z'), completed: true, completedAt: new Date('2026-02-01T00:00:00Z') }),
      ],
    }))
    expect(result.createToComplete).toEqual({ medianMs: 4 * HOUR, sampleSize: 3 })
  })

  it('reports no median rather than zero when nothing finished', () => {
    expect(computeListInsights(input()).createToComplete).toEqual({ medianMs: null, sampleSize: 0 })
  })
})

describe('time in each lane (boards)', () => {
  const lanes = [
    { role: 'inbox', name: 'Inbox' },
    { role: 'ready', name: 'Ready' },
    { role: 'doing', name: 'Doing' },
    { role: 'waiting', name: 'Waiting' },
  ]
  const t0 = new Date('2026-10-20T09:00:00Z')
  const at = (hours: number) => new Date(t0.getTime() + hours * HOUR)

  it('times a stay from the move into a lane to the move out, or to completion', () => {
    const result = computeListInsights(input({
      lanes,
      tasks: [task({ id: 'a' })],
      events: [
        event({ taskId: 'a', kind: 'status_changed', from: null, to: 'ready', createdAt: at(0) }),
        event({ taskId: 'a', kind: 'status_changed', from: 'ready', to: 'doing', createdAt: at(3) }),
        event({ taskId: 'a', kind: 'completed', createdAt: at(8) }),
      ],
    }))
    const byRole = Object.fromEntries(result.lanes!.map(lane => [lane.role, lane]))
    expect(byRole.ready).toMatchObject({ medianMs: 3 * HOUR, sampleSize: 1 })
    expect(byRole.doing).toMatchObject({ medianMs: 5 * HOUR, sampleSize: 1 })
    expect(byRole.waiting).toMatchObject({ medianMs: null, sampleSize: 0 })
  })

  it('times Inbox when a card is moved back to it', () => {
    const result = computeListInsights(input({
      lanes,
      tasks: [task({ id: 'a' })],
      events: [
        event({ taskId: 'a', kind: 'status_changed', from: 'doing', to: null, createdAt: at(0) }),
        event({ taskId: 'a', kind: 'status_changed', from: null, to: 'ready', createdAt: at(2) }),
      ],
    }))
    expect(result.lanes!.find(lane => lane.role === 'inbox')).toMatchObject({ medianMs: 2 * HOUR, sampleSize: 1 })
  })

  it('does not time a stay still in progress, or invent one before the first recorded move', () => {
    const result = computeListInsights(input({
      lanes,
      tasks: [task({ id: 'a', createdAt: at(-100) })],
      events: [event({ taskId: 'a', kind: 'status_changed', from: 'ready', to: 'doing', createdAt: at(0) })],
    }))
    expect(result.lanes!.every(lane => lane.sampleSize === 0)).toBe(true)
  })

  it('is null for a list that is not a board', () => {
    expect(computeListInsights(input()).lanes).toBeNull()
  })
})

describe('top contributors', () => {
  it('credits creates, edits, comments and completions to whoever did them', () => {
    const day = new Date('2026-10-21T10:00:00Z')
    const result = computeListInsights(input({
      tasks: [task({ id: 'a', creatorId: 'jon', createdAt: day }), task({ id: 'b', creatorId: 'claude', createdAt: day })],
      events: [
        event({ taskId: 'a', kind: 'priority_changed', actorId: 'claude', createdAt: day }),
        event({ taskId: 'a', kind: 'status_changed', actorId: 'claude', createdAt: day }),
        event({ taskId: 'a', kind: 'completed', actorId: 'claude', createdAt: day }),
        // Not an edit: its birth.
        event({ taskId: 'a', kind: 'created', actorId: 'jon', createdAt: day }),
        // System change, no actor.
        event({ taskId: 'b', kind: 'title_changed', actorId: null, createdAt: day }),
      ],
      comments: [{ authorId: 'jon', createdAt: day }, { authorId: null, createdAt: day }],
    }))
    expect(result.contributors).toEqual([
      { userId: 'claude', name: 'Claude', image: null, isAIAgent: true, created: 1, edited: 2, commented: 0, completed: 1, total: 4 },
      { userId: 'jon', name: 'Jon', image: null, isAIAgent: false, created: 1, edited: 0, commented: 1, completed: 0, total: 2 },
    ])
  })

  it('counts only activity inside the window', () => {
    const result = computeListInsights(input({
      tasks: [task({ id: 'a', createdAt: new Date('2026-01-01T00:00:00Z') })],
      comments: [{ authorId: 'jon', createdAt: new Date('2026-01-02T00:00:00Z') }],
    }))
    expect(result.contributors).toEqual([])
  })

  it('shows at most ten', () => {
    const day = new Date('2026-10-21T10:00:00Z')
    const tasks = Array.from({ length: 12 }, (_, i) => task({ id: `t${i}`, creatorId: `u${i}`, createdAt: day }))
    expect(computeListInsights(input({ tasks })).contributors).toHaveLength(10)
  })
})
