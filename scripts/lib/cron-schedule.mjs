/**
 * Five-field cron expressions, for running the schedule off Vercel (AWTD-1286).
 *
 * `vercel.json` is the one place the jobs and their schedules are written down.
 * On Vercel the platform reads it; a self-hosted deployment runs
 * scripts/cron-runner.mjs, which reads the same file and asks this module
 * which jobs are due. Evaluated in UTC, as Vercel does.
 *
 * Supports what crontab(5) does for these fields: `*`, numbers, `a-b` ranges,
 * `/step` on either, comma lists, and 7 as Sunday. When both day-of-month and
 * day-of-week are restricted, either matching is enough, as in Vixie cron.
 *
 * `.mjs` so the runner needs no TypeScript toolchain inside the image. Tests:
 * tests/scripts/cron-schedule.test.ts.
 */

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
]

function parseField(text, { name, min, max }) {
  const values = new Set()
  for (const part of text.split(',')) {
    const match = part.match(/^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/)
    if (!match) throw new Error(`Invalid ${name} field "${text}"`)
    const [, whole, from, to, stepText] = match
    const step = stepText ? Number(stepText) : 1
    const start = whole === '*' ? min : Number(from)
    const end = whole === '*' ? max : to !== undefined ? Number(to) : stepText ? max : start
    if (step < 1 || start < min || end > max || start > end) {
      throw new Error(`Invalid ${name} field "${text}"`)
    }
    for (let v = start; v <= end; v += step) values.add(v)
  }
  return values
}

/** Parse an expression once; throws on anything crontab would reject. */
export function parseCron(expression) {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Expected 5 fields in "${expression}"`)
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.map((part, i) => parseField(part, FIELDS[i]))
  if (dayOfWeek.has(7)) dayOfWeek.add(0)
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    domRestricted: parts[2] !== '*',
    dowRestricted: parts[4] !== '*',
  }
}

/** Whether `expression` fires in the UTC minute containing `date`. */
export function cronMatches(expression, date) {
  const cron = typeof expression === 'string' ? parseCron(expression) : expression
  if (!cron.minute.has(date.getUTCMinutes())) return false
  if (!cron.hour.has(date.getUTCHours())) return false
  if (!cron.month.has(date.getUTCMonth() + 1)) return false
  const dom = cron.dayOfMonth.has(date.getUTCDate())
  const dow = cron.dayOfWeek.has(date.getUTCDay())
  if (cron.domRestricted && cron.dowRestricted) return dom || dow
  return dom && dow
}

/** The `crons` array of a parsed vercel.json, validated. */
export function cronJobs(vercelConfig) {
  const jobs = vercelConfig?.crons
  if (!Array.isArray(jobs) || jobs.length === 0) throw new Error('vercel.json has no crons')
  return jobs.map(job => {
    if (typeof job?.path !== 'string' || !job.path.startsWith('/')) throw new Error(`Invalid cron path ${job?.path}`)
    return { path: job.path, schedule: job.schedule, cron: parseCron(job.schedule) }
  })
}

/** One crontab(5) line per job, for operators who use the system scheduler instead. */
export function crontabLines(jobs, baseUrl) {
  return jobs.map(
    job => `${job.schedule} curl -fsS -m 900 -H "Authorization: Bearer $CRON_SECRET" ${baseUrl}${job.path} >/dev/null`
  )
}
