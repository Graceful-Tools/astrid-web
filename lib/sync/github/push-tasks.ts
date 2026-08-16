/**
 * Push Astrid task edits out to their linked GitHub issues (task d8de37c1).
 *
 * Jon: "Make it directional." So direction now decides both legs rather than
 * only the inbound one:
 *
 *   IMPORT        pull + apply only          (GitHub is the source of truth)
 *   EXPORT        push only                  (Astrid is the source of truth)
 *   BIDIRECTIONAL both, push before pull
 *
 * Until now EXPORT links were skipped by the cron entirely, which was exactly
 * backwards: EXPORT is the direction that should push.
 *
 * THE FEEDBACK LOOP, AND WHY THIS TERMINATES
 * ------------------------------------------
 * Pushing bumps the issue's `updated_at` on GitHub. A naive implementation
 * then sees that as a newer remote change on the next pull and applies it back
 * inbound — harmless when the text matches, but it burns a write every cycle,
 * and any normalization difference (a trailing newline, CRLF) makes it
 * oscillate forever.
 *
 * The fix is to write the PATCH response's own `updated_at` straight into
 * `remoteUpdatedAt`. The echo then arrives already stale, so the existing
 * staleness check in apply-issues drops it with no special-casing and no
 * content comparison. The caller runs push BEFORE pull for the same reason, so
 * a just-pushed change is never re-read in the same pass.
 *
 * WHAT IT DOES NOT DO: CREATE ISSUES
 * ----------------------------------
 * Only tasks that ALREADY have an ExternalTaskLink are pushed. Creating GitHub
 * issues for unlinked Astrid tasks would mean a first run mass-creating one
 * issue per task in the list — irreversible from Astrid's side, and a very
 * different decision from "keep the descriptions in step". The task asks for
 * descriptions to sync; that is what this does.
 *
 * FIRST RUN SEEDS, IT DOES NOT PUSH
 * ---------------------------------
 * `astridUpdatedAt` is null on every link written by the inbound leg, since it
 * has never pushed. Treating null as "push it" would overwrite GitHub with
 * Astrid's copy for every previously-imported task on the first run — a mass
 * clobber of content nobody edited. Instead the first pass records the current
 * timestamp as a baseline and pushes nothing, so only genuine later edits go
 * out.
 */

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { githubRequest } from '@/lib/sync/github'
import { toGithubStateReason } from '@/lib/closed-reason'

const log = createLogger('sync.github.push')

export interface PushResult {
  pushed: number
  /** Links whose watermark was initialised without pushing — see the header. */
  seeded: number
  skipped: number
}

/** Directions that send Astrid changes to GitHub. */
export function directionPushes(direction: string): boolean {
  return direction === 'EXPORT' || direction === 'BIDIRECTIONAL'
}

/** Directions that bring GitHub changes into Astrid. */
export function directionPulls(direction: string): boolean {
  return direction === 'IMPORT' || direction === 'BIDIRECTIONAL'
}

export async function pushTasksForLink(args: {
  link: {
    id: string
    userId: string
    astridListId: string
    remoteContainerId: string
    direction: string
  }
  token: string
}): Promise<PushResult> {
  const { link, token } = args
  const result: PushResult = { pushed: 0, seeded: 0, skipped: 0 }

  if (!directionPushes(link.direction)) return result

  const links = await prisma.externalTaskLink.findMany({
    where: {
      provider: 'GITHUB_ISSUES',
      userId: link.userId,
      remoteContainerId: link.remoteContainerId,
    },
    select: {
      id: true,
      remoteId: true,
      astridUpdatedAt: true,
      task: {
        select: {
          id: true,
          title: true,
          description: true,
          completed: true,
          closedReason: true,
          updatedAt: true,
        },
      },
    },
  })

  for (const etl of links) {
    const task = etl.task
    if (!task) {
      result.skipped++
      continue
    }

    // Never pushed before: record where we are and send nothing. See the
    // header — pushing here would overwrite GitHub for every imported task.
    if (!etl.astridUpdatedAt) {
      await prisma.externalTaskLink.update({
        where: { id: etl.id },
        data: { astridUpdatedAt: task.updatedAt },
      })
      result.seeded++
      continue
    }

    if (task.updatedAt <= etl.astridUpdatedAt) {
      result.skipped++
      continue
    }

    const number = etl.remoteId.split('#').pop()
    if (!number || !/^\d+$/.test(number)) {
      result.skipped++
      continue
    }

    const { status, json } = await githubRequest(
      token,
      'PATCH',
      `/repos/${link.remoteContainerId}/issues/${number}`,
      {
        title: task.title,
        body: task.description ?? '',
        state: task.completed ? 'closed' : 'open',
        // GitHub rejects state_reason on an open issue, so only when closing.
        ...(task.completed ? { state_reason: toGithubStateReason(task.closedReason) } : {}),
      },
    )

    if (status !== 200) {
      // One task's failure must not cost the rest of the link its turn, and it
      // must not advance any watermark — the next run retries it.
      log.error({ remoteId: etl.remoteId, status }, 'Push failed; leaving watermarks untouched')
      result.skipped++
      continue
    }

    await prisma.externalTaskLink.update({
      where: { id: etl.id },
      data: {
        astridUpdatedAt: task.updatedAt,
        // The loop-closer: our own echo is now already stale to the pull.
        remoteUpdatedAt: json?.updated_at ? new Date(json.updated_at) : undefined,
        lastSyncedAt: new Date(),
      },
    })
    result.pushed++
  }

  return result
}
