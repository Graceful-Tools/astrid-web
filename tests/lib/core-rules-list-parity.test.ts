// @vitest-environment node
/**
 * AWTD-1583: web's list rules give astrid-core's answers — including the 351 cases the clients
 * used to dispute (D7, D25, D33–D37, all resolved toward iOS in astrid-core docs/CONTRACTS.md).
 *
 * The fixtures are core's own, vendored at the pinned revision (packages/astrid-rules/fixtures):
 * filters.json, my-tasks.json, manual-order.json and reminders.json. They were generated from web
 * BEFORE it adopted iOS's rules, so their `disputed` arrays carry web's old answer, not the core's.
 * The core's answer for each disputed case is the one its own contract tests assert
 * (crates/astrid-rules/tests/*_contract.rs), restated below per entry. Every one of the 351 was
 * also checked against the core itself when this was written (a throwaway Rust run over the same
 * fixtures), and the rules below reproduce all of them.
 *
 * Each case runs through the same pure function web's list view calls, the way the fixture
 * drivers in scripts/contract-fixtures/drivers/ do: the suite runs in UTC (vitest.config.ts) at
 * the fixture's pinned clock.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { reminderQueue: { findUnique: vi.fn(), update: vi.fn() } } }))

import { prisma } from '@/lib/prisma'
import { applyDateFilter } from '@/lib/date-filter-utils'
import { myTasksShows } from '@/lib/my-tasks-scope'
import { shouldShowCompletedByFilter, type RecentlyCompletedWindow } from '@/lib/recently-completed-window'
import { snoozeReminder } from '@/lib/reminder-snooze'
import { sortTasksForList } from '@/lib/task-sort'
import type { Task } from '@/types/task'

const FIXTURES = path.join(process.cwd(), 'packages', 'astrid-rules', 'fixtures')
type Json = any
const read = (name: string): Json => JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'))

const filters = read('filters')
const myTasks = read('my-tasks')
const manualOrder = read('manual-order')
const reminders = read('reminders')

// ── How web answers, per fixture (as the drivers ask it) ──────────────────────────────────────

const dueTask = Object.fromEntries(filters.dueTasks.map((t: Json) => [t.id, t]))
const completionTask = Object.fromEntries(filters.completionTasks.map((t: Json) => [t.id, t]))

/** useFilterState's due-date branch: its own overdue guard, then applyDateFilter. */
function dueDateShown(task: Task, filter: string): boolean {
  if (filter === 'all') return true
  if (filter === 'overdue') {
    if (!task.dueDateTime || task.completed) return false
    return applyDateFilter(task, 'overdue')
  }
  return applyDateFilter(task, filter)
}

function webFilters(c: Json): unknown {
  if (c.id.startsWith('due/')) {
    vi.setSystemTime(new Date(filters.now))
    return dueDateShown(dueTask[c.task], c.filter)
  }
  if (c.id.startsWith('completion/')) {
    return shouldShowCompletedByFilter(completionTask[c.task], c.mode, filters.windows[c.window], new Date(c.now))
  }
  return sortTasksForList(filters.sortTasks, c.sortBy, c.manualOrder ?? undefined).map((t) => t.id)
}

const myTasksTask = Object.fromEntries(myTasks.tasks.map((t: Json) => [t.id, t]))
const webMyTasks = (c: Json) =>
  myTasksShows(myTasksTask[c.task], c.reader, { filterPriority: c.filterPriority, filterAssignee: c.filterAssignee })

const webDisplay = (c: Json) => sortTasksForList(c.tasks, 'manual', c.manualOrder).map((t) => t.id)

// ── The core's answer to each disputed case ──────────────────────────────────────────────────

const AUTO = ['s3', 's2', 's5', 's4', 's9', 's1', 's6', 's8', 's7']
const NEWEST_FIRST = ['s9', 's8', 's7', 's6', 's5', 's4', 's3', 's2', 's1']

/** recently_completed::cutoff for the two D36 edges, in UTC (the fixture's zone). */
function iosCutoff(window: RecentlyCompletedWindow, now: Date): number {
  if (window.kind === 'since-date') return now.getTime() // unreadable: count from now
  if (window.kind !== 'since-day-of-month') throw new Error('not a D36 window')
  const [y, m, d] = [now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()]
  if (d >= window.day) return Date.UTC(y, m, window.day)
  const lastOfPrevious = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Date.UTC(y, m - 1, Math.min(window.day, lastOfPrevious)) // clamps, as iOS's Calendar does
}

function coreFilters(c: Json): unknown {
  switch (c.entry) {
    case 'D7': // an unknown due-date filter drops undated tasks
    case 'D34': // a timed task due earlier today is not overdue until its day has passed
      return false
    case 'D35': // tomorrow / calendar week / calendar month read as unknown values: dated tasks only
      return dueTask[c.task].dueDateTime != null
    case 'D36': {
      const task = completionTask[c.task]
      if (!task.completed) return true
      const stamp = task.completedAt ?? task.updatedAt
      return stamp != null && new Date(stamp).getTime() >= iosCutoff(filters.windows[c.window], new Date(c.now))
    }
    case 'D33':
      return c.sortBy === 'createdAt' ? NEWEST_FIRST : AUTO
  }
  throw new Error(`no core answer for ${c.entry}`)
}

/** D25: assigned to the reader (the nested assignee standing in for a missing id); filterAssignee ignored. */
function coreMyTasks(c: Json): boolean {
  const task = myTasksTask[c.task]
  const assignee = task.assigneeId ?? task.assignee?.id ?? null
  const priorityOk = c.filterPriority.length === 0 || c.filterPriority.includes(task.priority ?? 0)
  return c.reader != null && assignee === c.reader && priorityOk
}

/** D33 (manual): the arranged tasks in their order, then the unarranged newest first. */
function coreDisplay(c: Json): string[] {
  const named = c.manualOrder.filter((id: string) => c.tasks.some((t: Json) => t.id === id))
  const rest = c.tasks
    .filter((t: Json) => !c.manualOrder.includes(t.id))
    .sort((a: Json, b: Json) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((t: Json) => t.id)
  return [...named, ...rest]
}

// ── The cases ────────────────────────────────────────────────────────────────────────────────

const named = (cases: Json[]) => cases.map((c) => [c.id as string, c] as const)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('AWTD-1583 filters.json', () => {
  it.each(named(filters.cases))('agreed: %s', (_id, c) => expect(webFilters(c)).toEqual(c.shown))
  it.each(named(filters.disputed))('formerly disputed, now the core: %s', (_id, c) => expect(webFilters(c)).toEqual(coreFilters(c)))
})

describe('AWTD-1583 my-tasks.json', () => {
  it.each(named(myTasks.cases))('agreed: %s', (_id, c) => expect(webMyTasks(c)).toBe(c.shown))
  it.each(named(myTasks.disputed))('formerly disputed, now the core: %s', (_id, c) => expect(webMyTasks(c)).toBe(coreMyTasks(c)))
})

describe('AWTD-1583 manual-order.json (display)', () => {
  const display = (cases: Json[]) => named(cases.filter((c) => c.id.startsWith('display/')))
  it.each(display(manualOrder.cases))('agreed: %s', (_id, c) => expect(webDisplay(c)).toEqual(c.shown))
  it.each(display(manualOrder.disputed))('formerly disputed, now the core: %s', (_id, c) => expect(webDisplay(c)).toEqual(coreDisplay(c)))
})

describe('AWTD-1583 reminders.json: a reminder snoozes as often as asked (D37)', () => {
  it('answers every step of every sequence, the sixth snooze included', async () => {
    const rows = new Map<string, Json>()
    const queue = vi.mocked(prisma, true).reminderQueue
    queue.findUnique.mockImplementation((async ({ where }: Json) => rows.get(where.id) ?? null) as never)
    queue.update.mockImplementation((async ({ where, data }: Json) => {
      const row = { ...rows.get(where.id), ...data }
      rows.set(where.id, row)
      return row
    }) as never)

    const all = [...reminders.cases, ...reminders.disputed].sort((a: Json, b: Json) => a.id.localeCompare(b.id, 'en', { numeric: true }))
    expect(all).toHaveLength(10)
    for (const c of all) {
      const sequence = c.id.split('/')[1]
      if (c.step === 1) rows.set(sequence, { id: sequence, userId: 'u1', scheduledFor: new Date('2026-09-09T09:00:00.000Z'), retryCount: 0, data: {} })
      vi.setSystemTime(new Date(c.now))
      const result = await snoozeReminder({ reminderId: sequence, userId: 'u1', minutes: c.minutes })
      const expected = new Date(Date.parse(c.now) + c.minutes * 60_000).toISOString()
      expect(result, c.id).toMatchObject({ ok: true, snoozeCount: c.step })
      if (result.ok) expect(result.scheduledFor.toISOString(), c.id).toBe(expected)
    }
  })
})

describe('AWTD-1583: the 351 cases the clients disputed', () => {
  // astrid-core a1a8df5 regenerated these fixtures after web adopted the iOS rules, so the 351
  // formerly disputed cases now sit in `cases` with the core's answer (and pass above); no
  // `disputed` entry is left at the revision pinned since the Waiting rules (core 1c2adfd).
  it('are resolved: the pinned fixtures carry no disputed case', () => {
    const disputed = [filters, myTasks, manualOrder, reminders].reduce((sum, fixture) => sum + (fixture.disputed?.length ?? 0), 0)
    expect(disputed).toBe(0)
  })
})
