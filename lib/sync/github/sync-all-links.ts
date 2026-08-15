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

const log = createLogger('sync.github.run')

export interface SyncRunSummary {
  links: number
  created: number
  updated: number
  skipped: number
  failed: number
}

export async function syncAllGithubLinks(): Promise<SyncRunSummary> {
  const links = await prisma.externalListLink.findMany({
    where: {
      provider: 'GITHUB_ISSUES',
      // EXPORT is the push-only direction (Astrid -> GitHub); those links have
      // nothing to apply, and excluding them here keeps a one-way link from
      // costing a GitHub round trip every run.
      direction: { not: 'EXPORT' },
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
  })

  const summary: SyncRunSummary = { links: links.length, created: 0, updated: 0, skipped: 0, failed: 0 }

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

      const { items, cursor, truncated } = await pullIssuesForLink({ link, token })
      const applied = await applyPulledIssues({ link, items })

      summary.created += applied.created
      summary.updated += applied.updated
      summary.skipped += applied.skipped

      // Only now is it safe to move the watermark. A truncated listing still
      // commits: the cursor came from the last item we actually SAW, so the
      // next run resumes there rather than skipping the remainder.
      if (cursor && cursor !== link.cursor) {
        await prisma.externalListLink.update({
          where: { id: link.id },
          data: { cursor, lastReconciledAt: new Date() },
        })
      }

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
