/**
 * Run work AFTER the response has been sent, without it being killed.
 *
 * On Vercel a serverless invocation is frozen once its response is flushed, so
 * a naked floating promise is not "background work" — it is work that may or
 * may not happen, depending on how far it got. Before task 9b794349 this
 * codebase had no `waitUntil` or `after` anywhere outside middleware, and used
 * bare `void doThing()` for analytics inserts, stats recalculation, webhook
 * fan-out and — worst — dispatching an AI agent run, which is a full model call
 * launched from a Prisma hook and then abandoned. That is the mechanism behind
 * the stuck workflows the repo keeps a maintenance script around to mop up.
 *
 * `after` from next/server is the platform's own answer: the work is kept
 * alive past the response and still counted against the invocation.
 *
 * This wrapper exists so the pattern is greppable and so a failure in deferred
 * work can never surface as a failed request — the response has already gone.
 *
 * It is NOT a queue. Work that must survive a crash, retry, or take longer than
 * the function's limit belongs in lib/workflow-queue.ts instead.
 */

import { after } from 'next/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('background')

export function runAfterResponse(label: string, work: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await work()
    } catch (error) {
      log.error({ err: error, label }, 'Deferred background work failed')
    }
  }

  try {
    after(run)
  } catch {
    // `after` throws outside a request scope (a cron tick calling into shared
    // code, a script, a test). There is no response to outlive there, so just
    // run it.
    void run()
  }
}
