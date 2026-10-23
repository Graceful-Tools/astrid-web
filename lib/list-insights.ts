/**
 * List insights (AWTD-1329): what a list has been doing — new and completed tasks over time, how
 * long work takes, how long cards sit in each board lane, and who contributes.
 *
 * ONE COMPUTATION, RENDERED PER PLATFORM. The inputs are server-only history — `TaskEvent` rows,
 * every comment, every task on the list including ones a device never synced — so this runs on
 * the server (`GET /api/v1/lists/:id/insights`) and the {@link ListInsights} shape is the contract
 * every client renders. Pure: no database, no clock, so the route and the tests feed it the same
 * way and the numbers cannot depend on who asks.
 *
 * DAYS ARE THE VIEWER'S. A task completed at 23:30 in Los Angeles belongs to that day there, not
 * to the next UTC day, so every bucket is keyed in the requested IANA zone.
 */

/** The event kinds that count as an edit — a change to the task that is not its birth or end. */
export const INSIGHT_EDIT_KINDS: ReadonlySet<string> = new Set([
  'title_changed',
  'priority_changed',
  'due_changed',
  'assigned',
  'unassigned',
  'status_changed',
  'list_added',
  'list_removed',
  'blocker_added',
  'blocker_removed',
])

/** Windows the UI offers. The API accepts these and nothing else, so every client asks alike. */
export const INSIGHT_WINDOW_DAYS = [7, 30, 90] as const
export type InsightWindowDays = (typeof INSIGHT_WINDOW_DAYS)[number]
export const DEFAULT_INSIGHT_WINDOW_DAYS: InsightWindowDays = 30

/** Contributors shown, most active first. */
export const INSIGHT_TOP_CONTRIBUTORS = 10

/** Inbox is the lane a board card sits in with no status (`statusRole` null). */
export const INBOX_LANE = 'inbox'

export interface InsightTask {
  id: string
  createdAt: Date
  creatorId: string | null
  completed: boolean
  completedAt: Date | null
  repeating: string | null
}

export interface InsightEvent {
  taskId: string
  actorId: string | null
  kind: string
  from: unknown
  to: unknown
  createdAt: Date
}

export interface InsightComment {
  authorId: string | null
  createdAt: Date
}

export interface InsightUser {
  id: string
  name: string | null
  image: string | null
  isAIAgent: boolean
}

export interface InsightLane {
  /** `inbox`, a default role (`ready` / `doing` / `waiting`) or a custom role. */
  role: string
  name: string
}

export interface ListInsightsInput {
  now: Date
  days: InsightWindowDays
  timeZone: string
  tasks: InsightTask[]
  /** Events on those tasks. Status events from before the window are used to time stays that end in it. */
  events: InsightEvent[]
  /** Authored comments on those tasks within the window (system comments have no author). */
  comments: InsightComment[]
  users: InsightUser[]
  /** The board's lanes in column order, or null when the list is not a board. */
  lanes: InsightLane[] | null
}

export interface InsightDay {
  /** `YYYY-MM-DD` in the window's zone. */
  date: string
  created: number
  completed: number
}

export interface InsightDuration {
  /** Null when there is nothing to take a median of — not zero, which would read as "instant". */
  medianMs: number | null
  sampleSize: number
}

export interface InsightContributor {
  userId: string
  name: string | null
  image: string | null
  isAIAgent: boolean
  created: number
  edited: number
  commented: number
  completed: number
  total: number
}

export interface ListInsights {
  window: { days: InsightWindowDays; timeZone: string; start: string; end: string }
  series: InsightDay[]
  totals: { created: number; completed: number }
  createToComplete: InsightDuration
  /** Null when the list is not a board. */
  lanes: Array<InsightLane & InsightDuration> | null
  contributors: InsightContributor[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Whether `timeZone` is an IANA zone this runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/** `YYYY-MM-DD` for an instant, in a zone. en-CA formats dates in exactly that order. */
export function dayKey(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/** The window's day keys, oldest first, ending with `now`'s day in the zone. */
export function windowDays(now: Date, days: number, timeZone: string): string[] {
  // Step back from noon UTC of the zone's calendar date rather than from `now`: whole-day steps
  // from a mid-day instant cannot be knocked onto a neighbouring date by a DST change.
  const [year, month, day] = dayKey(now, timeZone).split('-').map(Number)
  const noon = Date.UTC(year, month - 1, day, 12)
  const keys: string[] = []
  for (let back = days - 1; back >= 0; back--) {
    keys.push(new Date(noon - back * DAY_MS).toISOString().slice(0, 10))
  }
  return keys
}

/**
 * The earliest instant any event in the window can have, for the route's query: a day before the
 * window's first UTC midnight covers every zone's offset.
 */
export function windowQueryStart(now: Date, days: number, timeZone: string): Date {
  const first = windowDays(now, days, timeZone)[0]
  return new Date(new Date(`${first}T00:00:00Z`).getTime() - DAY_MS)
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const laneOf = (value: unknown): string => (typeof value === 'string' && value ? value : INBOX_LANE)

const byTime = (a: InsightEvent, b: InsightEvent) => a.createdAt.getTime() - b.createdAt.getTime()

export function computeListInsights(input: ListInsightsInput): ListInsights {
  const { now, days, timeZone } = input
  const keys = windowDays(now, days, timeZone)
  const inWindow = new Set(keys)
  const dayOf = (instant: Date) => dayKey(instant, timeZone)
  const counts = new Map(keys.map(key => [key, { created: 0, completed: 0 }]))

  const contributors = new Map<string, Omit<InsightContributor, 'name' | 'image' | 'isAIAgent' | 'total'>>()
  const credit = (userId: string | null, field: 'created' | 'edited' | 'commented' | 'completed') => {
    if (!userId) return
    const row = contributors.get(userId) ?? { userId, created: 0, edited: 0, commented: 0, completed: 0 }
    row[field] += 1
    contributors.set(userId, row)
  }

  const taskIds = new Set(input.tasks.map(task => task.id))
  const events = input.events.filter(event => taskIds.has(event.taskId)).sort(byTime)

  for (const task of input.tasks) {
    const day = dayOf(task.createdAt)
    if (!inWindow.has(day)) continue
    counts.get(day)!.created += 1
    credit(task.creatorId, 'created')
  }

  // Completions: one per `completed` event, so each completion of a repeating task counts. A task
  // completed before events were recorded has none, and is counted from its completedAt instead.
  const completedInWindowByEvent = new Set<string>()
  for (const event of events) {
    if (event.kind === 'completed') {
      const day = dayOf(event.createdAt)
      if (!inWindow.has(day)) continue
      counts.get(day)!.completed += 1
      completedInWindowByEvent.add(event.taskId)
      credit(event.actorId, 'completed')
    } else if (INSIGHT_EDIT_KINDS.has(event.kind) && inWindow.has(dayOf(event.createdAt))) {
      credit(event.actorId, 'edited')
    }
  }
  for (const task of input.tasks) {
    if (!task.completed || !task.completedAt || completedInWindowByEvent.has(task.id)) continue
    const day = dayOf(task.completedAt)
    if (inWindow.has(day)) counts.get(day)!.completed += 1
  }

  for (const comment of input.comments) {
    if (inWindow.has(dayOf(comment.createdAt))) credit(comment.authorId, 'commented')
  }

  // Create → complete, for one-off tasks finished in the window. A repeating task's createdAt is
  // the series' birth, so its "cycle" would only measure how long the series has existed.
  const cycles = input.tasks
    .filter(task => task.completed && task.completedAt && (task.repeating ?? 'never') === 'never')
    .filter(task => inWindow.has(dayOf(task.completedAt!)))
    .map(task => task.completedAt!.getTime() - task.createdAt.getTime())
    .filter(ms => ms >= 0)

  const series = keys.map(date => ({ date, ...counts.get(date)! }))
  const users = new Map(input.users.map(user => [user.id, user]))

  return {
    window: { days, timeZone, start: keys[0], end: keys[keys.length - 1] },
    series,
    totals: {
      created: series.reduce((sum, day) => sum + day.created, 0),
      completed: series.reduce((sum, day) => sum + day.completed, 0),
    },
    createToComplete: { medianMs: median(cycles), sampleSize: cycles.length },
    lanes: input.lanes ? laneDurations(events, input.lanes, inWindow, dayOf) : null,
    contributors: [...contributors.values()]
      .map(row => {
        const user = users.get(row.userId)
        return {
          ...row,
          name: user?.name ?? null,
          image: user?.image ?? null,
          isAIAgent: user?.isAIAgent ?? false,
          total: row.created + row.edited + row.commented + row.completed,
        }
      })
      .sort((a, b) => b.total - a.total || (a.name ?? '').localeCompare(b.name ?? '') || a.userId.localeCompare(b.userId))
      .slice(0, INSIGHT_TOP_CONTRIBUTORS),
  }
}

/**
 * Median stay in each lane, from recorded moves only. A stay is timed from the `status_changed`
 * that entered the lane to whatever ended it — the next move, a completion, a close — and counts
 * when it ENDS in the window. A stay still in progress is not timed (its length is not known yet),
 * and nothing is inferred from before the first recorded move: lane moves were not recorded until
 * AWTD-1329, and a guessed start would invent history.
 */
function laneDurations(
  events: InsightEvent[],
  lanes: InsightLane[],
  inWindow: Set<string>,
  dayOf: (instant: Date) => string,
): Array<InsightLane & InsightDuration> {
  const stays = new Map(lanes.map(lane => [lane.role, [] as number[]]))
  const open = new Map<string, { lane: string; since: Date }>()

  for (const event of events) {
    const current = open.get(event.taskId)
    const ends = event.kind === 'status_changed' || event.kind === 'completed' || event.kind === 'closed'
    if (current && ends) {
      if (inWindow.has(dayOf(event.createdAt))) {
        stays.get(current.lane)?.push(event.createdAt.getTime() - current.since.getTime())
      }
      open.delete(event.taskId)
    }
    if (event.kind === 'status_changed') {
      open.set(event.taskId, { lane: laneOf(event.to), since: event.createdAt })
    }
  }

  return lanes.map(lane => {
    const values = stays.get(lane.role) ?? []
    return { ...lane, medianMs: median(values), sampleSize: values.length }
  })
}
