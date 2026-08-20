/**
 * Drive a full GitHub sync pass across every importing link (task d8de37c1).
 *
 * The orchestration lives here rather than in the cron route for two reasons:
 * the route stays auth + call (the pattern the prisma-in-routes ratchet exists
 * to protect), and a pass can be triggered from anywhere — a cron, a script, a
 * future "sync now" button — without going through HTTP.
 *
 * CURSOR SAFETY IS THE WHOLE DESIGN. The `since` watermark must never advance
 * past issues nobody imported: those issues would never be offered again, a
 * silent permanent loss that presents as "sync is quiet". So the cursor is
 * committed only after applyPulledIssues returns without throwing — which is
 * also why apply rethrows everything except a concurrent-create.
 *
 * ONE LINK'S FAILURE MUST NOT STOP THE REST. A revoked token or a deleted repo
 * is normal; it costs that link its turn, not everyone else's.
 */

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { githubTokenFor, isValidRepoId } from '@/lib/sync/github'
import { pullIssuesForLink } from '@/lib/sync/github/pull-issues'
import { applyPulledIssues } from '@/lib/sync/github/apply-issues'
import { directionPulls, pushTasksForLink } from '@/lib/sync/github/push-tasks'

const log = createLogger('sync.github.run')

/**
 * How many links one pass will touch.
 *
 * The caller is a cron route with `maxDuration = 60` and each link costs
 * several sequential network round trips, so an unbounded pass is a pass that
 * gets killed partway through (task df728fba). Bounding it makes the cut-off
 * deliberate and, with the staleness ordering below, fair.
 */
export const MAX_LINKS_PER_PASS = 25

export interface SyncRunSummary {
  links: number
  /** True when more links were waiting than this pass would take. */
  capped: boolean
  /** How many links were left for the next pass. */
  remaining: number
  created: number
  updated: number
  skipped: number
  failed: number
  /** Outbound: Astrid edits sent to GitHub. */
  pushed: number
  /** Outbound: links whose push watermark was initialised without pushing. */
  seeded: number
}

export async function syncAllGithubLinks(): Promise<SyncRunSummary> {
  const links = await prisma.externalListLink.findMany({
    where: {
      provider: 'GITHUB_ISSUES',
      // Every direction is fetched now. EXPORT used to be excluded here, which
      // was backwards once there is an outbound leg: EXPORT is precisely the
      // direction that should push. Which legs run is decided per link below.
      // (Jon: "Make it directional.")
    },
    select: {
      id: true,
      userId: true,
      integrationId: true,
      astridListId: true,
      remoteContainerId: true,
      direction: true,
      cursor: true,
    },
    /*
     * STALENEST FIRST, and bounded. Without an orderBy, Postgres returns an
     * unchanging table in a stable order, so a pass killed at 60s dropped the
     * SAME TAIL on every one of the 96 runs a day — those links silently never
     * synced, and the summary still counted them. Never-reconciled links lead;
     * the longest-waiting follow. A run that only gets halfway leaves the rest
     * at the front of the next one, fifteen minutes later.
     */
    orderBy: { lastReconciledAt: { sort: 'asc', nulls: 'first' } },
    take: MAX_LINKS_PER_PASS,
  })

  // One cheap count so "we did not get to everyone" is visible rather than
  // inferred from a log that only mentions the links it reached.
  const totalLinks = await prisma.externalListLink.count({
    where: { provider: 'GITHUB_ISSUES' },
  })

  const summary: SyncRunSummary = {
    links: links.length,
    capped: totalLinks > links.length,
    remaining: Math.max(0, totalLinks - links.length),
    created: 0, updated: 0, skipped: 0, failed: 0, pushed: 0, seeded: 0,
  }

  for (const link of links) {
    try {
      if (!isValidRepoId(link.remoteContainerId)) {
        throw new Error(`invalid repo id: ${link.remoteContainerId}`)
      }

      // The link's OWNER supplies the token — this runs with no session.
      const token = await githubTokenFor(link.userId)
      if (!token) {
        // Not worth alerting on: the user disconnected GitHub. Leave the cursor
        // untouched so nothing is lost if they reconnect.
        log.info({ linkId: link.id }, 'No GitHub token for link owner; skipping')
        continue
      }

      // PUSH FIRST. Pushing bumps the issue's updated_at, so doing it before
      // the pull means a just-pushed change is never re-read in the same pass.
      // The remoteUpdatedAt written by the push is what makes the echo stale.
      const pushedResult = await pushTasksForLink({ link, token })
      summary.pushed += pushedResult.pushed
      summary.seeded += pushedResult.seeded

      if (!directionPulls(link.direction)) {
        log.info(
          { linkId: link.id, direction: link.direction, ...pushedResult },
          'Push-only link; skipping pull',
        )
        continue
      }

      const { items, cursor, truncated } = await pullIssuesForLink({ link, token })
      const applied = await applyPulledIssues({ link, items })

      summary.created += applied.created
      summary.updated += applied.updated
      summary.skipped += applied.skipped

      // Only now is it safe to move the watermark. A truncated listing still
      // commits: the cursor came from the last item we actually SAW, so the
      // next run resumes there rather than skipping the remainder.
      /*
       * lastReconciledAt is written on EVERY completed link, not only when the
       * cursor moved. It is now the sort key, so a link that syncs cleanly with
       * nothing new would otherwise keep a stale timestamp, sit permanently at
       * the front of the queue and starve everyone behind it — the ordering
       * above would make the bug worse rather than better. The cursor itself is
       * still only advanced when it actually changed.
       */
      await prisma.externalListLink.update({
        where: { id: link.id },
        data: {
          lastReconciledAt: new Date(),
          ...(cursor && cursor !== link.cursor ? { cursor } : {}),
        },
      })

      log.info({ linkId: link.id, repo: link.remoteContainerId, ...applied, truncated }, 'Link synced')
    } catch (error) {
      // Deliberately no cursor write on this path — see the header.
      summary.failed++
      log.error({ err: error, linkId: link.id }, 'Link sync failed; cursor left untouched')
    }
  }

  log.info(summary, 'GitHub sync run complete')
  return summary
}
