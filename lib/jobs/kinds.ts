/**
 * The durable job queue's kinds and rules (AWTD-1460).
 *
 * Pure, so the retry policy is table-tested; lib/jobs/queue.ts does the
 * claiming and running. Modelled on lib/github/projects/jobs.ts, which is the
 * same queue specialised for GitHub.
 *
 *   - A kind names one piece of deferred work and its payload shape.
 *   - Backoff doubles from the kind's base to an hour; after the kind's
 *     maxAttempts the job is dead-lettered (done, deadAt set, error kept).
 *   - A claim holds a job for the kind's lock. A drainer killed mid-run (a
 *     frozen Vercel function, a restarted container) leaves the lock to
 *     expire, and the next drain — the minute cron at the latest — runs it.
 */

export interface AstridHandoffPayload {
  userMessage: string
  userId: string
  userName: string
  channelId: string
  listId: string | null
  locale?: string
  /** The reply's unique clientRequestId: a re-run cannot post a second reply. */
  replyClientRequestId: string
}

export interface AstridCommentReplyPayload {
  commentContent: string
  userId: string
  userName: string
  taskId: string
  taskTitle: string
  listId: string | null
}

/** A task's reminder-relevant columns, as JSON (dates are ISO strings after a round trip). */
export interface TaskUpdatedReminderFields {
  id: string
  title: string
  completed: boolean
  assigneeId: string | null
  creatorId: string | null
  dueDateTime: string | Date | null
  reminderTime?: string | Date | null
  reminderType?: string | null
}

/**
 * What one task edit still has to do after its response (AWTD-1462). Each
 * section is present only when the edit has that work; services/
 * task-update-deferred-effects.ts builds and runs it.
 */
export interface TaskUpdatedPayload {
  taskId: string
  actorId: string
  actorType: 'user' | 'agent'
  /** Names this edit. Notification ids derive from it, so a re-run cannot notify twice. */
  editKey: string
  reminders?: { before: TaskUpdatedReminderFields; after: TaskUpdatedReminderFields }
  /** The blocker's completion after the edit; its dependents' lanes follow it. */
  dependents?: { blockerCompleted: boolean }
  notifications?: {
    kinds: string[]
    audience: { assigneeId: string | null; creatorId: string | null; commenterIds: string[] }
  }
  statsUserIds?: string[]
}

export interface JobPayloads {
  /** Astrid's server-side chat reply, handed off by a client (lib/astrid-handoff.ts). */
  'astrid-handoff': AstridHandoffPayload
  /** Astrid's reply to a comment that @-mentions her (lib/comments/post-comment-side-effects.ts). */
  'astrid-comment-reply': AstridCommentReplyPayload
  /** A task edit's notifications, reminders, stats and dependents (services/task.service.ts). */
  'task-updated': TaskUpdatedPayload
}

export type JobKind = keyof JobPayloads

export interface JobPolicy {
  maxAttempts: number
  /** First retry delay; doubles per attempt, capped at an hour. */
  baseBackoffMs: number
  /** How long a claim is ours before another drainer may take the job. */
  lockMs: number
}

/**
 * The two Astrid kinds run a model call with a tool loop — seconds normally,
 * over a minute when the token window makes it wait — so their lock is long:
 * a second drainer must never start a reply the first is still writing. They
 * get few attempts because the runtime already answers its own failures (a
 * missing key gets a setup prompt, a model error is logged); what a retry is
 * for is a run that was killed before it finished.
 */
export const JOB_POLICIES: Record<JobKind, JobPolicy> = {
  'astrid-handoff': { maxAttempts: 3, baseBackoffMs: 30_000, lockMs: 10 * 60_000 },
  'astrid-comment-reply': { maxAttempts: 3, baseBackoffMs: 30_000, lockMs: 10 * 60_000 },
  // A handful of short statements. Each step guards itself, so a retry is for
  // a run that was killed, and a short lock lets the next drain take it soon.
  'task-updated': { maxAttempts: 5, baseBackoffMs: 30_000, lockMs: 2 * 60_000 },
}

/** An unknown kind (a row from a newer deploy, a typo) still has to back off and die. */
export const DEFAULT_POLICY: JobPolicy = { maxAttempts: 5, baseBackoffMs: 30_000, lockMs: 2 * 60_000 }

export function policyFor(kind: string): JobPolicy {
  return (JOB_POLICIES as Record<string, JobPolicy>)[kind] ?? DEFAULT_POLICY
}

export function backoffMs(kind: string, attempts: number): number {
  return Math.min(policyFor(kind).baseBackoffMs * 2 ** Math.max(0, attempts - 1), 3_600_000)
}

/** How long a finished job is kept for inspection before the hourly purge. */
export const DONE_RETENTION_MS = 7 * 24 * 60 * 60_000
/** Dead jobs are what someone needs to look at; they are kept longer. */
export const DEAD_RETENTION_MS = 30 * 24 * 60 * 60_000
