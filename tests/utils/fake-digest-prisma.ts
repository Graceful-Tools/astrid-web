/**
 * An in-memory Prisma for the digest pass (AWTD-1453, AWTD-1454): it answers `where` clauses
 * against its rows instead of returning canned values, so a test can run the cron minute by
 * minute and see what really goes out. It also counts the statements issued and the rows each
 * read hands back, which is what the query-budget test pins.
 *
 * Every `where` and `select` is checked against the generated schema
 * (tests/utils/prisma-where.ts), so a query on a column the model lacks fails here too.
 */
import { vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { unknownSelectFields, unknownWhereFields } from './prisma-where'

type Row = Record<string, any>

export interface FakeDigestUser {
  id: string
  email: string
  name: string | null
  /** Null: the user has no ReminderSettings row. */
  settings: Row | null
}

export interface FakeTask {
  id: string
  title: string
  dueDateTime: Date
  isAllDay: boolean
  assigneeId: string
  completed: boolean
  lists: { name: string }[]
}

const isRange = (value: unknown): value is Record<string, Date> =>
  !!value && typeof value === 'object' && !(value instanceof Date) && ['gte', 'gt', 'lt', 'lte'].some((k) => k in (value as object))

/** Just enough of Prisma's where semantics: equality, null, date ranges, AND / OR. */
export function matchesWhere(row: Row, where: Row): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue
    if (key === 'OR') {
      if (!(value as Row[]).some((clause) => matchesWhere(row, clause))) return false
      continue
    }
    if (key === 'AND') {
      if (!(value as Row[]).every((clause) => matchesWhere(row, clause))) return false
      continue
    }
    const field = row[key]
    if (value === null) {
      if (field !== null && field !== undefined) return false
    } else if (value instanceof Date) {
      if (!(field instanceof Date) || field.getTime() !== value.getTime()) return false
    } else if (isRange(value)) {
      if (!(field instanceof Date)) return false
      const at = field.getTime()
      if (value.gte && at < value.gte.getTime()) return false
      if (value.gt && at <= value.gt.getTime()) return false
      if (value.lt && at >= value.lt.getTime()) return false
      if (value.lte && at > value.lte.getTime()) return false
    } else if (value && typeof value === 'object' && 'is' in value) {
      // A to-one relation filter: `{ reminderSettings: { is: {...} } }`.
      if (!field || !matchesWhere(field, (value as { is: Row }).is)) return false
    } else if (field !== value) {
      return false
    }
  }
  return true
}

function assertKnown(model: Prisma.ModelName, args: { where?: Row; select?: Row } | undefined) {
  const bad = [
    ...(args?.where ? unknownWhereFields(model, args.where) : []),
    ...(args?.select ? unknownSelectFields(model, args.select) : []),
  ]
  if (bad.length) throw new Error(`${model}: unknown field(s) ${bad.join(', ')}`)
}

function project(row: Row, select: Row | undefined, relations: Record<string, Row | null>): Row {
  if (!select) return { ...row }
  const out: Row = {}
  for (const [key, value] of Object.entries(select)) {
    if (!value) continue
    if (key in relations) {
      const related = relations[key]
      out[key] = related && typeof value === 'object' ? project(related, (value as { select?: Row }).select, {}) : related
    } else {
      out[key] = row[key]
    }
  }
  return out
}

export function fakeDigestPrisma(users: FakeDigestUser[], tasks: FakeTask[]) {
  const stats = { statements: 0, rowsRead: 0, log: [] as string[] }
  const userById = new Map(users.map((u) => [u.id, u]))
  const settingsRows = () => users.flatMap((u) => (u.settings ? [u.settings] : []))
  const read = <T>(name: string, rows: T[]): T[] => {
    stats.statements++
    stats.rowsRead += rows.length
    stats.log.push(`${name} → ${rows.length}`)
    return rows
  }

  const prisma = {
    user: {
      findMany: vi.fn(async (args?: { where?: Row; include?: Row }) => {
        assertKnown('User', args)
        const rows = users
          .map((u) => ({ id: u.id, email: u.email, name: u.name, reminderSettings: u.settings }))
          .filter((u) => !args?.where || matchesWhere(u, args.where))
        return read('user.findMany', rows)
      }),
    },
    reminderSettings: {
      findMany: vi.fn(async (args: { where?: Row; select?: Row; take?: number; orderBy?: Row }) => {
        assertKnown('ReminderSettings', args)
        let rows = settingsRows().filter((s) => !args.where || matchesWhere(s, args.where))
        const order = args.orderBy && Object.entries(args.orderBy)[0]
        if (order) {
          const [field, direction] = order
          rows = [...rows].sort((a, b) => (a[field]?.getTime?.() ?? 0) - (b[field]?.getTime?.() ?? 0))
          if (direction === 'desc') rows.reverse()
        }
        if (args.take !== undefined) rows = rows.slice(0, args.take)
        const projected = rows.map((s) => {
          const user = userById.get(s.userId)!
          return project(s, args.select, { user: { id: user.id, email: user.email, name: user.name } })
        })
        return read('reminderSettings.findMany', projected)
      }),
      updateMany: vi.fn(async (args: { where: Row; data: Row }) => {
        assertKnown('ReminderSettings', args)
        stats.statements++
        stats.log.push('reminderSettings.updateMany')
        let count = 0
        for (const s of settingsRows()) {
          if (matchesWhere(s, args.where)) {
            Object.assign(s, args.data)
            count++
          }
        }
        return { count }
      }),
    },
    task: {
      findMany: vi.fn(async (args: { where: Row }) => {
        assertKnown('Task', { where: args.where })
        return read('task.findMany', tasks.filter((t) => matchesWhere(t, args.where)))
      }),
    },
  }
  return { prisma, stats }
}

export function digestSettings(userId: string, overrides: Row = {}): Row {
  return {
    id: `settings-${userId}`,
    userId,
    enablePushReminders: true,
    enableEmailReminders: true,
    defaultReminderTime: 60,
    enableDailyDigest: true,
    dailyDigestTime: '09:00',
    dailyDigestTimezone: 'UTC',
    enableCalendarSync: false,
    calendarSyncType: 'all',
    quietHoursStart: null,
    quietHoursEnd: null,
    nextDailyDigestAt: null,
    nextWeeklyDigestAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}
