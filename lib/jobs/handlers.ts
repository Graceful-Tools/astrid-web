/**
 * What each job kind does (AWTD-1460). One entry per kind in lib/jobs/kinds.ts;
 * the record type makes a kind without a handler a compile error.
 *
 * Imports are lazy so that enqueuing — which every comment write does — never
 * loads the model runtime.
 */

import type { JobKind, JobPayloads } from '@/lib/jobs/kinds'

export type JobHandler<K extends JobKind = JobKind> = (payload: JobPayloads[K]) => Promise<void>

export type JobHandlers = { [K in JobKind]: JobHandler<K> }

export const JOB_HANDLERS: JobHandlers = {
  'astrid-handoff': async payload => {
    const { processAstridMessage } = await import('@/lib/astrid-agent-runtime')
    await processAstridMessage(payload)
  },
  'astrid-comment-reply': async payload => {
    const { processAstridComment } = await import('@/lib/astrid-agent-runtime')
    await processAstridComment(payload)
  },
  'task-updated': async payload => {
    const { runTaskUpdatedJob } = await import('@/services/task-update-deferred-effects')
    await runTaskUpdatedJob(payload)
  },
}
