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
 *
 * THE SCAN IS BOUNDED AND ROTATES (task f9ba26b3)
 * ----------------------------------------------
 * This used to load every ExternalTaskLink for the container, joined to its
 * task, with no `take`, and then PATCH without a cap. `MAX_LINKS_PER_PASS` in
 * sync-all-links bounds how many LINKS a pass touches, not the work inside one
 * of them, so a repo with thousands of linked issues could spend the entire
 * 60-second budget on its own.
 *
 * Adding a `take` alone would have been worse than the unbounded version. With
 * no rotating order Postgres returns the same prefix every time, so all 96 runs
 * a day would examine the same head and the tail would never sync at all —
 * exactly the failure sync-all-links documents in its own `orderBy`. So the
 * pass stamps `lastSyncedAt` on every link it LOOKED at, not only on the ones
 * it changed, and orders by that stamp. An unchanged link therefore rotates to
 * the back instead of occupying the front forever.
 *
 * `lastSyncedAt` is safe to use for this because nothing reads it — the
 * watermarks that decide behaviour are `astridUpdatedAt` and `remoteUpdatedAt`,
 * and a failed push still leaves both untouched.
 */

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { mapWithConcurrency } from '@/lib/concurrency'
import { githubRequest } from '@/lib/sync/github'
import { toGithubStateReason } from '@/lib/closed-reason'

const log = createLogger('sync.github.push')

/**
 * How many links one pass will READ for a single container.
 *
 * Bounds the query and the memory it materialises. Most rows cost nothing
 * beyond the read — they are unchanged and only get their rotation stamp — so
 * this can be far larger than the network cap below.
 */
export const MAX_LINKS_SCANNED_PER_PASS = 200

/**
 * How many GitHub round trips one link may spend in a single pass.
 *
 * sync-all-links gives 25 links a shared 60 seconds, so roughly two seconds
 * each, and a PATCH costs a few hundred milliseconds. Ten keeps one busy
 * container from starving the other twenty-four; at 96 runs a day it still
 * clears nearly a thousand edits.
 */
export const MAX_PUSHES_PER_PASS = 10

/** Seeding is database-only, so it can run in parallel — unlike the PATCHes. */
const SEED_CONCURRENCY = 5

export interface PushResult {
  pushed: number
  /** Links whose watermark was initialised without pushing — see the header. */
  seeded: number
  skipped: number
  /** True when the push cap stopped the pass before it examined every link. */
  capped: boolean
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
  const result: PushResult = { pushed: 0, seeded: 0, skipped: 0, capped: false }

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
    // Staleest first — see the header. The id is a tie-break so a page of rows
    // sharing a timestamp (everything seeded in one pass) still has a total
    // order and cannot oscillate between runs.
    orderBy: [{ lastSyncedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    take: MAX_LINKS_SCANNED_PER_PASS,
  })

  /*
   * Every link this pass RESOLVED, whether or not anything was written to
   * GitHub. These rotate to the back of the next scan. Links left unexamined
   * because the push cap hit are deliberately absent: stamping them would move
   * them behind the ones just handled and strand them exactly as the missing
   * `take` did.
   */
  const examined: string[] = []
  const seeds: { id: string; astridUpdatedAt: Date }[] = []

  for (const etl of links) {
    const task = etl.task
    if (!task) {
      result.skipped++
      examined.push(etl.id)
      continue
    }

    // Never pushed before: record where we are and send nothing. See the
    // header — pushing here would overwrite GitHub for every imported task.
    // Costs no network, so it is collected and run in parallel below rather
    // than spending a slot of the push budget.
    if (!etl.astridUpdatedAt) {
      seeds.push({ id: etl.id, astridUpdatedAt: task.updatedAt })
      examined.push(etl.id)
      continue
    }

    if (task.updatedAt <= etl.astridUpdatedAt) {
      result.skipped++
      examined.push(etl.id)
      continue
    }

    const number = etl.remoteId.split('#').pop()
    if (!number || !/^\d+$/.test(number)) {
      result.skipped++
      examined.push(etl.id)
      continue
    }

    // Out of network budget. Stop rather than skip: the links after this one
    // keep their old stamp and lead the next pass.
    if (result.pushed >= MAX_PUSHES_PER_PASS) {
      result.capped = true
      break
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
      // must not advance any watermark — the next run retries it. It DOES get
      // a rotation stamp, or a permanently failing issue would re-consume the
      // push budget at the front of every pass and starve everything behind it.
      log.error({ remoteId: etl.remoteId, status }, 'Push failed; leaving watermarks untouched')
      result.skipped++
      examined.push(etl.id)
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
    examined.push(etl.id)
  }

  // Each seed carries its own task timestamp, so this cannot be one updateMany.
  // It is database-only, so it parallelises safely — the PATCHes above do not,
  // because concurrent writes to one repo invite GitHub's secondary rate limit.
  await mapWithConcurrency(seeds, SEED_CONCURRENCY, async seed => {
    await prisma.externalTaskLink.update({
      where: { id: seed.id },
      data: { astridUpdatedAt: seed.astridUpdatedAt },
    })
    result.seeded++
  })

  // One query for the whole page's rotation, rather than a write per row.
  if (examined.length > 0) {
    await prisma.externalTaskLink.updateMany({
      where: { id: { in: examined } },
      data: { lastSyncedAt: new Date() },
    })
  }

  return result
}
