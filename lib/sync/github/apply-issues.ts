/**
 * Apply pulled GitHub issues to Astrid tasks — the server-side half that did
 * not exist. (Task d8de37c1; Jon chose the cron driver over a web sync client.)
 *
 * WHY THIS IS NEW CODE. The proxy at /api/v1/sync/github/issues already pulls
 * provider-neutral items, maps assignees and parents, and computes the cursor
 * watermark. It has never APPLIED anything: iOS owns apply, conflict
 * resolution and the deletion policy, which is why web sync does not exist and
 * why three GitHub links in production are driven entirely from a phone.
 *
 * THE TRAP THIS FILE EXISTS TO AVOID. A driver that pulls and then fails to
 * apply must not advance the `since` watermark: issues nobody imported would
 * never be offered again — silent, permanent data loss that looks like "sync is
 * quiet". So the caller commits the cursor only after this returns without
 * throwing, and this rethrows everything except a concurrent-create.
 *
 * SCOPE: CREATE AND UPDATE ONLY. Deletion is deliberately absent.
 * ------------------------------------------------------------
 * Absence-based deletion — "this issue was not in the listing, so delete its
 * task" — is the one operation that destroys user data when the listing is
 * wrong, and the listing is wrong more often than it looks: a truncated page,
 * a 502 mid-pagination, a repo permission change. iOS carries a whole
 * SyncDeletionPolicy for this and the proxy already exposes a `truncated` flag
 * precisely so clients do not run deletion against an incomplete listing.
 *
 * Reproducing that judgement server-side is its own task with its own tests.
 * Until then this driver can only add and update, which is recoverable in
 * every failure mode.
 */

import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { mapWithConcurrency } from '@/lib/concurrency'
import type { PulledIssue } from '@/lib/sync/github/pull-issues'
import {
  createTaskWithSideEffects,
  updateTaskWithSideEffects,
  type UpdateTaskIntent,
} from '@/services/task.service'

const log = createLogger('sync.github.apply')

/**
 * How many issues are applied at once (task f9ba26b3).
 *
 * Each one costs up to two writes, and `connectionPoolConfig` caps production
 * at ten connections shared with everything else the process is doing. Five
 * leaves headroom while cutting the sequential depth of a 300-issue batch from
 * 600 waits to about 120.
 */
const APPLY_CONCURRENCY = 5

export type { PulledIssue }

export interface ApplyResult {
  created: number
  updated: number
  skipped: number
}

/**
 * `remoteUpdatedAt` is the conflict rule: an item whose remote timestamp is not
 * newer than what we last recorded is skipped rather than re-applied.
 *
 * That matters because the cursor is a `since` watermark on `updated_at`, and
 * GitHub returns items updated AT the boundary — so a steady state re-delivers
 * the same last issue on every run. Without this check every cron tick would
 * rewrite that task and clobber any local edit made in between.
 */
function isStale(item: PulledIssue, existingRemoteUpdatedAt: Date | null): boolean {
  if (!item.remoteUpdatedAt) return false
  if (!existingRemoteUpdatedAt) return false
  return new Date(item.remoteUpdatedAt) <= existingRemoteUpdatedAt
}

type LinkedTaskContent = {
  title: string
  description: string | null
  completed: boolean
  closedReason: string | null
} | null

/**
 * The update intent for an issue against its task as it stands: only fields
 * that differ. `completed` is sent only when it flips, because the service
 * stamps completedAt on every `completed: true` it is given.
 */
function changedFields(task: LinkedTaskContent, item: PulledIssue): UpdateTaskIntent {
  const description = item.notes ?? ''
  const closedReason = item.closedReason ?? null
  const intent: UpdateTaskIntent = {}

  if (!task || task.title !== item.title) intent.title = item.title
  if (!task || (task.description ?? '') !== description) intent.description = description
  if (!task || (task.closedReason ?? null) !== closedReason) intent.closedReason = closedReason
  if (!task || task.completed !== item.completed) {
    intent.completed = item.completed
    if (item.completed) {
      intent.completedSource = 'github'
      if (item.completedAt) intent.completedAt = item.completedAt
    }
  }
  return intent
}

/**
 * One clientRequestId per (user, issue), the same on every run (AWTD-1123).
 *
 * This is what keeps a task and its link together now that the task is
 * created through the service, which takes no transaction. If the link write
 * fails after the task exists, the error propagates and the cursor stays put.
 * The next run offers the issue again, and this id makes the create return the
 * task already made instead of a second one, so the link is written then.
 *
 * It also keeps the service's title-based dedup out of the way. That dedup
 * would merge two different issues with the same title imported within a
 * minute. Hashed because a repo path can exceed the service's 128 characters.
 */
function importRequestId(userId: string, remoteId: string): string {
  const digest = createHash('sha256').update(`${userId}\n${remoteId}`).digest('hex')
  return `github-issue:${digest}`
}

export async function applyPulledIssues(args: {
  link: {
    id: string
    userId: string
    integrationId: string
    astridListId: string
    remoteContainerId: string
    direction: string
  }
  items: PulledIssue[]
}): Promise<ApplyResult> {
  const { link, items } = args
  const result: ApplyResult = { created: 0, updated: 0, skipped: 0 }

  // A link that only pushes must never have remote state written into Astrid.
  //
  // The value is EXPORT (Astrid -> GitHub). Named from Astrid's point of view,
  // so "export" is the push-only direction; there is no PUSH_ONLY member. An
  // earlier draft guarded on that invented name, which made this check dead
  // code and would have let an export-only link be overwritten from GitHub.
  if (link.direction === 'EXPORT') {
    log.info({ linkId: link.id }, 'Link is export-only; nothing to apply')
    return { ...result, skipped: items.length }
  }

  /*
   * ONE LOOKUP FOR THE BATCH, NOT ONE PER ITEM (task f9ba26b3).
   *
   * This used to `findFirst` per issue before doing any work, so 300 changed
   * issues cost 300 sequential existence probes inside a single link's turn of
   * a 60-second pass. `@@unique([provider, remoteId, userId])` means one row
   * per key, so a single `in` query answers the same question exactly.
   *
   * Deduping first is not tidiness. The map is a snapshot taken before the
   * loop, so a `remoteId` appearing twice in one batch would miss it twice and
   * be imported twice — a duplicate the per-item probe could not produce.
   * Dropping the repeat is also the honest reading: two entries for one issue
   * describe one issue.
   */
  const applicable: PulledIssue[] = []
  const seenRemoteIds = new Set<string>()

  for (const item of items) {
    if (!item.remoteId || !item.title) {
      result.skipped++
      continue
    }
    if (seenRemoteIds.has(item.remoteId)) {
      result.skipped++
      continue
    }
    seenRemoteIds.add(item.remoteId)
    applicable.push(item)
  }

  if (applicable.length === 0) return result

  const existingRows = await prisma.externalTaskLink.findMany({
    where: {
      provider: 'GITHUB_ISSUES',
      userId: link.userId,
      remoteId: { in: applicable.map(item => item.remoteId) },
    },
    select: {
      id: true,
      astridTaskId: true,
      remoteUpdatedAt: true,
      remoteId: true,
      // Still one query: the linked task's current content, so an issue that
      // changed nothing writes nothing (AWTD-1093).
      task: { select: { title: true, description: true, completed: true, closedReason: true } },
    },
  })

  const existingByRemoteId = new Map(existingRows.map(row => [row.remoteId, row]))

  type Outcome = 'created' | 'updated' | 'skipped'

  const outcomes = await mapWithConcurrency(
    applicable,
    APPLY_CONCURRENCY,
    async (item): Promise<Outcome> => {
      const existing = existingByRemoteId.get(item.remoteId)

      if (existing) {
        if (isStale(item, existing.remoteUpdatedAt)) return 'skipped'

        // Through the task service, and only for what actually changed. A raw
        // write completed tasks with no completedSource, left the board lane on
        // a done task, never promoted the tasks it was blocking and broadcast
        // nothing; and writing unchanged content bumped updatedAt, which push
        // then read as a local edit (AWTD-1093).
        const intent = changedFields(existing.task, item)
        if (Object.keys(intent).length > 0) {
          const outcome = await updateTaskWithSideEffects({
            taskId: existing.astridTaskId,
            actorId: link.userId,
            intent,
          })
          // Propagate, like every other failure here: the caller must not
          // commit the cursor past an issue that was not applied.
          if (!outcome.ok) throw new Error(`Applying ${item.remoteId} failed: ${outcome.error}`)
        }

        // After the task, not alongside it: if the task write fails, the
        // watermark must not advance.
        await prisma.externalTaskLink.update({
          where: { id: existing.id },
          data: {
            remoteUpdatedAt: item.remoteUpdatedAt ? new Date(item.remoteUpdatedAt) : undefined,
            lastSyncedAt: new Date(),
          },
        })
        return 'updated'
      }

      // New issue. Through the task service, so it gets its identifier,
      // reminders, manual-sort entry and broadcast like any other create
      // (AWTD-1123). A task with no link would be re-imported as a duplicate on
      // the next run; importRequestId says how that is prevented without a
      // transaction.
      const created = await createTaskWithSideEffects({
        actorId: link.userId,
        input: {
          title: item.title,
          description: item.notes ?? '',
          listIds: [link.astridListId],
          // '' means no assignee resolved to an Astrid user. null, not
          // undefined: undefined would hand the task to the list's default.
          assigneeId: item.metadata.assigneeUserId || null,
          completed: item.completed,
          completedAt: item.completedAt ?? null,
          completedSource: item.completed ? 'github' : null,
          closedReason: item.closedReason ?? null,
          clientRequestId: importRequestId(link.userId, item.remoteId),
        },
      })
      // Propagate: the caller must not commit the cursor past this issue.
      if (!created.ok) throw new Error(`Importing ${item.remoteId} failed: ${created.error}`)

      try {
        await prisma.externalTaskLink.create({
          data: {
            integrationId: link.integrationId,
            userId: link.userId,
            astridTaskId: created.task.id,
            provider: 'GITHUB_ISSUES',
            remoteId: item.remoteId,
            remoteContainerId: link.remoteContainerId,
            remoteUpdatedAt: item.remoteUpdatedAt ? new Date(item.remoteUpdatedAt) : null,
            lastSyncedAt: new Date(),
          },
        })
        return 'created'
      } catch (error) {
        // ONLY a unique violation is safe to absorb: it means another run linked
        // the same issue concurrently. That run got the same task from the
        // create above, so the desired end state already holds.
        //
        // Everything else MUST propagate. The caller commits the cursor when this
        // returns without throwing, so swallowing a real failure here (DB down,
        // constraint violation, bad data) would advance the watermark past an
        // issue that was never imported — the exact silent loss this module is
        // built to prevent. A failed run that retries is always the cheaper bug.
        if ((error as { code?: string })?.code !== 'P2002') throw error

        log.warn({ remoteId: item.remoteId }, 'Concurrent create; treating as skip')
        return 'skipped'
      }
    },
  )

  for (const outcome of outcomes) result[outcome]++

  return result
}
