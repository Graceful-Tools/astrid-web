// Runs astrid-web's reminder snooze rule over scripted sequences and prints what it answers.
// Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// What web and the core both decide about a snooze is WHEN IT COMES BACK: now plus the minutes
// (lib/reminder-snooze.ts; the core's `reminders::snooze_until`), within the bounds the v1 route
// accepts (1 minute to a week, read from its zod schema below). Those are the cases.
//
// What they do not share is D24's and D37's: web snoozes a server reminder-queue row and refuses
// a sixth snooze; iOS — and so the core — moves the task's due date and has no limit. The
// refused sixth step is therefore `disputed` (D37). Web's in-browser reminder manager
// (lib/reminder-manager.ts) decides nothing a client could share — its check loop is a stub — so
// the core's `due_now` has no web counterpart to lock and stays covered by its unit tests.
//
// Runs the real rule against an in-memory reminder queue (stubs/prisma-reminder-queue.mjs) under a
// clock the script moves.
//
// Usage: node scripts/contract-fixtures/drivers/reminders.mjs <path-to-astrid-web>

import { join, dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'
import { partition } from './disputed.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/reminders.mjs <path-to-astrid-web>')
  process.exit(2)
}

const here = dirname(fileURLToPath(import.meta.url))
const queueStub = join(here, 'stubs', 'prisma-reminder-queue.mjs')

let now = '2026-09-09T09:00:00.000Z'
const RealDate = Date
class MovableDate extends RealDate {
  constructor(...args) {
    super(...(args.length === 0 ? [now] : args))
  }
  static now() {
    return new RealDate(now).getTime()
  }
}
globalThis.Date = MovableDate

registerWebAliases(webRoot, { '@/lib/prisma': queueStub })

const { snoozeReminder, MAX_SNOOZE_COUNT } = await import(pathToFileURL(join(webRoot, 'lib/reminder-snooze.ts')).href)
const { reminderRows } = await import(pathToFileURL(queueStub).href)

// The route's accepted range, read rather than retyped.
const route = readFileSync(join(webRoot, 'app/api/v1/reminders/[id]/snooze/route.ts'), 'utf8')
const bounds = route.match(/minutes:\s*z\.number\(\)\.min\((\d+)\)\.max\((\d+)\)/)
if (!bounds) throw new Error('snooze bounds not found in app/api/v1/reminders/[id]/snooze/route.ts')

const SEQUENCES = {
  'six-snoozes': [
    ['2026-09-09T09:01:00.000Z', 15],
    ['2026-09-09T09:16:30.000Z', 60],
    ['2026-09-09T10:20:00.000Z', 1440],
    ['2026-09-10T10:20:00.000Z', 10080],
    ['2026-09-17T10:21:00.000Z', 1],
    ['2026-09-17T10:22:00.000Z', 15],
  ],
  'across-a-month-end': [
    ['2026-09-30T23:50:00.000Z', 15],
    ['2026-10-01T00:05:00.000Z', 10080],
  ],
  'across-a-year-end': [
    ['2026-12-31T23:59:59.000Z', 1],
    ['2026-12-31T23:59:59.000Z', 1440],
  ],
}

const cases = []
for (const [name, steps] of Object.entries(SEQUENCES)) {
  reminderRows.set(name, {
    id: name,
    userId: 'u1',
    taskId: 't1',
    scheduledFor: new RealDate('2026-09-09T09:00:00.000Z'),
    retryCount: 0,
    status: 'pending',
    data: { taskTitle: 'Water plants' },
  })
  for (const [index, [at, minutes]] of steps.entries()) {
    now = at
    const result = await snoozeReminder({ reminderId: name, userId: 'u1', minutes })
    cases.push({
      id: `snooze/${name}/${index + 1}`,
      step: index + 1,
      now: at,
      minutes,
      ok: result.ok,
      ...(result.ok
        ? { scheduledFor: result.scheduledFor.toISOString(), snoozeCount: result.snoozeCount }
        : { error: result.error }),
    })
  }
}

const result = partition(cases, [
  {
    entry: 'D37',
    why: 'web refuses a snooze after the fifth; iOS and the core have no limit',
    applies: (c) => c.step > MAX_SNOOZE_COUNT,
  },
])

process.stdout.write(JSON.stringify({
  generatedFrom: 'lib/reminder-snooze.ts, app/api/v1/reminders/[id]/snooze/route.ts (bounds)',
  minutes: { min: Number(bounds[1]), max: Number(bounds[2]) },
  maxSnoozeCount: MAX_SNOOZE_COUNT,
  ...result,
}))
