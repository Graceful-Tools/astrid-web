/**
 * One wrapper for every scheduled route, so a cron run leaves a record of what
 * it actually did (task f74c9370).
 *
 * The reported symptom was that only the first log line of
 * /api/cron/reminders ever reached the logs. The filed hypothesis — pino
 * buffering and losing the last line before the response — is disproven: pino
 * 10 writes to stdout synchronously, and 502 of 502 lines survive an immediate
 * process.exit through a pipe, which is a harder stop than a frozen
 * invocation.
 *
 * What actually fits "first line present, everything after it absent" is an
 * early return at requireCronSecret, which logged nothing on either path. So
 * the logs could not distinguish a job that ran from a job that was turned
 * away — and could not say how much work it did either way, because the
 * services all returned void and the summary was an interpolated string.
 *
 * This fixes the observability directly rather than betting on a mechanism:
 *   - one structured summary per run, with duration and the job's own counts;
 *   - the SAME counts in the response body, so a canary can read them without
 *     depending on any log line surviving at all.
 */

import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron')

/** Whatever the job wants to report. Numbers are the useful case. */
export type CronSummary = Record<string, number | string | boolean>

/**
 * Run a scheduled job, logging a structured summary and returning it in the
 * body. Never throws: a cron route answering 500 with a named job is more
 * useful than an unhandled rejection.
 */
export async function runCronJob(
  job: string,
  work: () => Promise<CronSummary | void>
): Promise<NextResponse> {
  const startedAt = Date.now()

  try {
    const summary = (await work()) ?? {}
    const durationMs = Date.now() - startedAt

    // Structured, not interpolated: a count you can query and alert on rather
    // than a sentence you have to parse.
    log.info({ job, durationMs, ...summary }, `cron ${job} completed`)

    return NextResponse.json({
      success: true,
      job,
      durationMs,
      ...summary,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const durationMs = Date.now() - startedAt
    log.error({ err, job, durationMs }, `cron ${job} FAILED`)

    return NextResponse.json(
      {
        success: false,
        job,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

/**
 * Sum the fulfilled numeric results of a Promise.allSettled batch, and count
 * how many rejected.
 *
 * The reminder route runs its work through allSettled, which swallows
 * rejections by design — so without this a failing sub-job is invisible in
 * both the logs and the response.
 */
export function tallySettled(
  results: PromiseSettledResult<number | void>[]
): { completed: number; failed: number; total: number } {
  let total = 0
  let failed = 0

  for (const result of results) {
    if (result.status === 'rejected') {
      failed++
      continue
    }
    if (typeof result.value === 'number') total += result.value
  }

  return { completed: results.length - failed, failed, total }
}
