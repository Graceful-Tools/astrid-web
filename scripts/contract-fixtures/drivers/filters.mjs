// Runs astrid-web's list filters and sort over a case table and prints what they answer.
// Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// Three rules, each the pure function web's list view calls (hooks/useFilterState.ts):
//   - the due-date filter   — lib/date-filter-utils.ts `applyDateFilter`, behind the hook's own
//                             `overdue` guard (below)
//   - the completion filter — lib/recently-completed-window.ts `shouldShowCompletedByFilter`
//   - the sort              — lib/task-sort.ts `sortTasksForList`
//
// THE ONE LINE COPIED FROM THE HOOK. useFilterState is a React hook and cannot be imported, and
// for `overdue` it answers before calling applyDateFilter: `if (!task.dueDateTime ||
// task.completed) return false`. applyDateFilter alone calls a completed past-due task overdue,
// which no list ever shows. That guard is reproduced in `dueDateShown` and nothing else is.
//
// The clock is pinned (applyDateFilter reads `new Date()`), TZ is UTC (set by the exporter), and
// the completion filter takes `now` as an argument, so each of its cases carries its own.
//
// Disputed cases (the follow-iOS rule) are routed to `disputed` by ./disputed.mjs, each naming
// its astrid-core docs/CONTRACTS.md entry.
//
// Usage: node scripts/contract-fixtures/drivers/filters.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'
import { partition } from './disputed.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/filters.mjs <path-to-astrid-web>')
  process.exit(2)
}

// A Wednesday, mid-morning UTC. Every due-date answer is relative to this.
const NOW = '2026-09-09T10:30:00.000Z'
const RealDate = Date
class FixedDate extends RealDate {
  constructor(...args) {
    super(...(args.length === 0 ? [NOW] : args))
  }
  static now() {
    return new RealDate(NOW).getTime()
  }
}
globalThis.Date = FixedDate

registerWebAliases(webRoot)

const load = (rel) => import(pathToFileURL(join(webRoot, rel)).href)
const { applyDateFilter } = await load('lib/date-filter-utils.ts')
const { shouldShowCompletedByFilter } = await load('lib/recently-completed-window.ts')
const { sortTasksForList } = await load('lib/task-sort.ts')

// ── Due date ──────────────────────────────────────────────────────────────────────────────

const allDay = (id, day, extra = {}) => ({
  id, title: id, completed: false, priority: 0, isAllDay: true, dueDateTime: `${day}T00:00:00.000Z`, ...extra,
})
const timed = (id, at, extra = {}) => ({
  id, title: id, completed: false, priority: 0, isAllDay: false, dueDateTime: at, ...extra,
})
const done = { completed: true }

const DUE_TASKS = [
  allDay('ad-last-week', '2026-09-02'),
  allDay('ad-yesterday', '2026-09-08'),
  allDay('ad-yesterday-done', '2026-09-08', done),
  allDay('ad-today', '2026-09-09'),
  allDay('ad-today-done', '2026-09-09', done),
  allDay('ad-tomorrow', '2026-09-10'),
  allDay('ad-saturday', '2026-09-12'),
  allDay('ad-sunday', '2026-09-13'),
  allDay('ad-plus-7', '2026-09-16'),
  allDay('ad-plus-8', '2026-09-17'),
  allDay('ad-sep-30', '2026-09-30'),
  allDay('ad-oct-1', '2026-10-01'),
  allDay('ad-plus-30', '2026-10-09'),
  allDay('ad-plus-31', '2026-10-10'),
  timed('t-yesterday-late', '2026-09-08T23:30:00.000Z'),
  timed('t-earlier-today', '2026-09-09T08:00:00.000Z'),
  timed('t-earlier-today-done', '2026-09-09T08:00:00.000Z', done),
  timed('t-later-today', '2026-09-09T22:00:00.000Z'),
  timed('t-tomorrow', '2026-09-10T09:00:00.000Z'),
  timed('t-saturday-late', '2026-09-12T23:00:00.000Z'),
  timed('t-sunday-early', '2026-09-13T01:00:00.000Z'),
  timed('t-plus-7-late', '2026-09-16T23:59:00.000Z'),
  timed('t-plus-8', '2026-09-17T00:00:00.000Z'),
  timed('t-plus-30', '2026-10-09T12:00:00.000Z'),
  timed('t-plus-31', '2026-10-10T00:00:00.000Z'),
  timed('t-last-week-done', '2026-09-02T12:00:00.000Z', done),
  { id: 'undated', title: 'undated', completed: false, priority: 0, isAllDay: false, dueDateTime: null },
  { id: 'undated-done', title: 'undated-done', completed: true, priority: 0, isAllDay: false, dueDateTime: null },
]

const DUE_FILTERS = [
  'all', 'overdue', 'today', 'tomorrow', 'this_week', 'this_month',
  'this_calendar_week', 'this_calendar_month', 'no_date', 'someday',
]

// useFilterState's due-date branch: its own overdue guard, then applyDateFilter.
function dueDateShown(task, filter) {
  if (filter === 'all') return true
  if (filter === 'overdue') {
    if (!task.dueDateTime || task.completed) return false
    return applyDateFilter(task, 'overdue')
  }
  return applyDateFilter(task, filter)
}

const dueDate = []
for (const filter of DUE_FILTERS) {
  for (const task of DUE_TASKS) {
    dueDate.push({ id: `due/${filter}/${task.id}`, filter, task: task.id, shown: dueDateShown(task, filter) })
  }
}

// ── Completion ────────────────────────────────────────────────────────────────────────────

const WINDOWS = [
  ['none', null],
  ['24h', { kind: 'duration', amount: 24, unit: 'hour' }],
  ['3d', { kind: 'duration', amount: 3, unit: 'day' }],
  ['1w', { kind: 'duration', amount: 1, unit: 'week' }],
  ['1mo', { kind: 'duration', amount: 1, unit: 'month' }],
  ['since-sunday', { kind: 'since-weekday', weekday: 0 }],
  ['since-monday', { kind: 'since-weekday', weekday: 1 }],
  ['since-wednesday', { kind: 'since-weekday', weekday: 3 }],
  ['since-friday', { kind: 'since-weekday', weekday: 5 }],
  ['since-1st', { kind: 'since-day-of-month', day: 1 }],
  ['since-9th', { kind: 'since-day-of-month', day: 9 }],
  ['since-10th', { kind: 'since-day-of-month', day: 10 }],
  ['since-31st', { kind: 'since-day-of-month', day: 31 }],
  ['since-sep-1', { kind: 'since-date', date: '2026-09-01' }],
  ['since-sep-9', { kind: 'since-date', date: '2026-09-09' }],
  ['since-garbage', { kind: 'since-date', date: 'not-a-date' }],
]

// Three clocks: the fixture's Wednesday; 9 October, where "since the 31st" reaches back into a
// September that has no 31st; and 9 March, where it reaches into a February with no 31st.
const NOWS = [NOW, '2026-10-09T10:30:00.000Z', '2026-03-09T10:30:00.000Z']

const completedTask = (id, completedAt, updatedAt = '2026-01-01T00:00:00.000Z') => ({
  id, completed: true, completedAt, updatedAt,
})
const COMPLETION_TASKS = [
  { id: 'open', completed: false, completedAt: null, updatedAt: '2026-09-09T10:00:00.000Z' },
  completedTask('done-1h-ago', '2026-09-09T09:30:00.000Z'),
  completedTask('done-23h-ago', '2026-09-08T11:30:00.000Z'),
  completedTask('done-25h-ago', '2026-09-08T09:30:00.000Z'),
  completedTask('done-sep-7-noon', '2026-09-07T12:00:00.000Z'),
  completedTask('done-sep-6-noon', '2026-09-06T12:00:00.000Z'),
  completedTask('done-sep-1-start', '2026-09-01T00:00:00.000Z'),
  completedTask('done-aug-31-noon', '2026-08-31T12:00:00.000Z'),
  completedTask('done-aug-9-noon', '2026-08-09T12:00:00.000Z'),
  completedTask('done-sep-30-noon', '2026-09-30T12:00:00.000Z'),
  completedTask('done-oct-1-noon', '2026-10-01T12:00:00.000Z'),
  completedTask('done-feb-28-noon', '2026-02-28T12:00:00.000Z'),
  completedTask('done-mar-2-noon', '2026-03-02T12:00:00.000Z'),
  completedTask('done-only-updated-1h-ago', null, '2026-09-09T09:30:00.000Z'),
  { id: 'done-no-stamp', completed: true, completedAt: null, updatedAt: null },
]

const MODES = ['all', 'completed', 'incomplete', 'default']

const completion = []
for (const now of NOWS) {
  for (const [windowName, window] of WINDOWS) {
    for (const mode of MODES) {
      // `all`, `completed` and `incomplete` never read the window; one window is enough for them.
      if (mode !== 'default' && windowName !== 'none') continue
      // The other two clocks exist for the day-of-month windows; the rest are covered at NOW.
      if (now !== NOW && window?.kind !== 'since-day-of-month') continue
      for (const task of COMPLETION_TASKS) {
        completion.push({
          id: `completion/${now.slice(0, 10)}/${windowName}/${mode}/${task.id}`,
          now,
          window: windowName,
          mode,
          task: task.id,
          shown: shouldShowCompletedByFilter(task, mode, window, new RealDate(now)),
        })
      }
    }
  }
}

// ── Sort ──────────────────────────────────────────────────────────────────────────────────

// Distinct creation times, so no answer depends on whether a sort is stable.
const SORT_TASKS = [
  { id: 's1', title: 'Water plants', completed: false, priority: 0, dueDateTime: null, createdAt: '2026-01-01T00:00:00.000Z', assignee: { id: 'u-zed', name: 'Zed' } },
  { id: 's2', title: 'Call bank', completed: false, priority: 3, dueDateTime: '2026-09-20T00:00:00.000Z', isAllDay: true, createdAt: '2026-01-02T00:00:00.000Z', assignee: { id: 'u-amy', name: 'Amy' } },
  { id: 's3', title: 'Book flights', completed: false, priority: 3, dueDateTime: '2026-09-10T09:00:00.000Z', createdAt: '2026-01-03T00:00:00.000Z' },
  { id: 's4', title: 'File taxes', completed: false, priority: 1, dueDateTime: '2026-09-08T00:00:00.000Z', isAllDay: true, createdAt: '2026-01-04T00:00:00.000Z', assignee: { id: 'u-bo', name: 'Bo' } },
  { id: 's5', title: 'Renew passport', completed: false, priority: 2, dueDateTime: null, createdAt: '2026-01-05T00:00:00.000Z' },
  { id: 's6', title: 'Pay rent', completed: true, priority: 3, dueDateTime: '2026-09-01T00:00:00.000Z', isAllDay: true, createdAt: '2026-01-06T00:00:00.000Z', completedAt: '2026-09-02T10:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z' },
  { id: 's7', title: 'Fix bike', completed: true, priority: 0, dueDateTime: null, createdAt: '2026-01-07T00:00:00.000Z', completedAt: '2026-09-08T10:00:00.000Z', updatedAt: '2026-09-08T10:00:00.000Z' },
  { id: 's8', title: 'Old chore', completed: true, priority: 1, dueDateTime: null, createdAt: '2026-01-08T00:00:00.000Z', completedAt: null, updatedAt: '2026-09-05T10:00:00.000Z' },
  { id: 's9', title: 'Plan party', completed: false, priority: 0, dueDateTime: '2026-09-10T09:00:00.000Z', createdAt: '2026-01-09T00:00:00.000Z', assignee: { id: 'u-amy', name: 'Amy' } },
]
const MANUAL_ORDER = ['s5', 's1', 's9', 's2', 's3', 's4', 's6', 's7', 's8']

const SORTS = [null, 'auto', 'priority', 'when', 'assignee', 'completed', 'incomplete', 'completedAt', 'manual', 'createdAt', 'somethingLater']

const sort = SORTS.map((sortBy) => ({
  id: `sort/${sortBy ?? 'null'}`,
  sortBy,
  manualOrder: sortBy === 'manual' ? MANUAL_ORDER : null,
  shown: sortTasksForList(SORT_TASKS, sortBy, sortBy === 'manual' ? MANUAL_ORDER : undefined).map((t) => t.id),
}))

// ── Disputes ──────────────────────────────────────────────────────────────────────────────

const ymd = (iso) => iso.slice(0, 10)
const dueTask = Object.fromEntries(DUE_TASKS.map((t) => [t.id, t]))
const windowNamed = Object.fromEntries(WINDOWS)
const daysInMonth = (year, month0) => new RealDate(RealDate.UTC(year, month0 + 1, 0)).getUTCDate()

const result = partition([...dueDate, ...completion, ...sort], [
  {
    entry: 'D7',
    why: 'an unrecognised due-date filter: web keeps undated tasks, iOS drops them',
    applies: (c) => c.id.startsWith('due/') && c.filter === 'someday' && !dueTask[c.task].dueDateTime,
  },
  {
    entry: 'D34',
    why: 'overdue for a timed task: web compares instants, iOS compares days',
    applies: (c) =>
      c.id.startsWith('due/') && c.filter === 'overdue' && !dueTask[c.task].isAllDay &&
      dueTask[c.task].dueDateTime && ymd(dueTask[c.task].dueDateTime) === ymd(NOW),
  },
  {
    entry: 'D35',
    why: 'tomorrow / this calendar week / this calendar month: windows web has and iOS does not read',
    applies: (c) => c.id.startsWith('due/') && ['tomorrow', 'this_calendar_week', 'this_calendar_month'].includes(c.filter),
  },
  {
    entry: 'D36',
    why: 'recently-completed window edges: "since the Nth" when last month has no Nth (web rolls into this month, iOS clamps), and an unreadable since-date (web hides every completion, iOS counts from now)',
    applies: (c) => {
      const window = c.id.startsWith('completion/') ? windowNamed[c.window] : null
      if (window?.kind === 'since-date' && Number.isNaN(RealDate.parse(window.date))) {
        const task = COMPLETION_TASKS.find((t) => t.id === c.task)
        const stamp = task.completedAt ?? task.updatedAt
        return task.completed && stamp != null && stamp >= c.now
      }
      if (window?.kind !== 'since-day-of-month') return false
      const now = new RealDate(c.now)
      if (now.getUTCDate() >= window.day) return false
      const prevMonth = (now.getUTCMonth() + 11) % 12
      const prevYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
      return window.day > daysInMonth(prevYear, prevMonth)
    },
  },
  {
    entry: 'D33',
    why: 'sort orders: iOS sinks completed tasks under priority, sorts "when" by dueDateTime, has no assignee/completed/incomplete orders, and puts createdAt newest first',
    applies: (c) => c.id.startsWith('sort/') && ['priority', 'when', 'assignee', 'completed', 'incomplete', 'createdAt'].includes(c.sortBy),
  },
])

process.stdout.write(JSON.stringify({
  generatedFrom: 'lib/date-filter-utils.ts, lib/recently-completed-window.ts, lib/task-sort.ts (as hooks/useFilterState.ts calls them)',
  now: NOW,
  // Cases name their task (and window) by id; these are the tables they index.
  dueTasks: DUE_TASKS,
  windows: Object.fromEntries(WINDOWS),
  completionTasks: COMPLETION_TASKS,
  sortTasks: SORT_TASKS,
  ...result,
}))
