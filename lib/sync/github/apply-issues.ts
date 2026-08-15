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

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import type { PulledIssue } from '@/lib/sync/github/pull-issues'

const log = createLogger('sync.github.apply')

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

  for (const item of items) {
    if (!item.remoteId || !item.title) {
      result.skipped++
      continue
    }

    const existing = await prisma.externalTaskLink.findFirst({
      where: { provider: 'GITHUB_ISSUES', remoteId: item.remoteId, userId: link.userId },
      select: { id: true, astridTaskId: true, remoteUpdatedAt: true },
    })

    if (existing) {
      if (isStale(item, existing.remoteUpdatedAt)) {
        result.skipped++
        continue
      }

      await prisma.task.update({
        where: { id: existing.astridTaskId },
        data: {
          title: item.title,
          description: item.notes ?? '',
          completed: item.completed,
          completedAt: item.completedAt ? new Date(item.completedAt) : null,
          closedReason: item.closedReason ?? null,
        },
      })
      await prisma.externalTaskLink.update({
        where: { id: existing.id },
        data: {
          remoteUpdatedAt: item.remoteUpdatedAt ? new Date(item.remoteUpdatedAt) : undefined,
          lastSyncedAt: new Date(),
        },
      })
      result.updated++
      continue
    }

    // New issue. The task and its link are written together: a task with no
    // link would be re-imported as a duplicate on the very next run, which is
    // the failure mode that makes naive importers unusable.
    try {
      await prisma.$transaction(async tx => {
        const task = await tx.task.create({
          data: {
            title: item.title,
            description: item.notes ?? '',
            completed: item.completed,
            completedAt: item.completedAt ? new Date(item.completedAt) : null,
            closedReason: item.closedReason ?? null,
            creatorId: link.userId,
            // '' means no assignee resolved to an Astrid user — leave it unset
            // rather than writing an empty string into a relation.
            assigneeId: item.metadata.assigneeUserId || undefined,
            lists: { connect: { id: link.astridListId } },
          },
        })
        await tx.externalTaskLink.create({
          data: {
            integrationId: link.integrationId,
            userId: link.userId,
            astridTaskId: task.id,
            provider: 'GITHUB_ISSUES',
            remoteId: item.remoteId,
            remoteContainerId: link.remoteContainerId,
            remoteUpdatedAt: item.remoteUpdatedAt ? new Date(item.remoteUpdatedAt) : null,
            lastSyncedAt: new Date(),
          },
        })
      })
      result.created++
    } catch (error) {
      // ONLY a unique violation is safe to absorb: it means another run created
      // the same issue concurrently, so the desired end state already holds.
      //
      // Everything else MUST propagate. The caller commits the cursor when this
      // returns without throwing, so swallowing a real failure here (DB down,
      // constraint violation, bad data) would advance the watermark past an
      // issue that was never imported — the exact silent loss this module is
      // built to prevent. A failed run that retries is always the cheaper bug.
      if ((error as { code?: string })?.code !== 'P2002') throw error

      log.warn({ remoteId: item.remoteId }, 'Concurrent create; treating as skip')
      result.skipped++
    }
  }

  return result
}
