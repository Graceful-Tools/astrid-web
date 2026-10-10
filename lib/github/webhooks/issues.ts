/**
 * `issues` / `issue_comment` → nudge the clients of everyone with a list linked
 * to that repo (AWTD-1113, spec §7.4 "Webhooks").
 *
 * NOT a sync engine: clients pull on `external_sync_refresh`, the SSE payload
 * iOS already consumes — {provider:'GITHUB_ISSUES', container: 'owner/repo'}.
 * One implementation for both entry points: the GitHub App's webhook, which
 * arrives for every repo the App is installed on, and the per-repo hook
 * (/api/webhooks/github-issues) that needed a secret set by hand on each repo
 * and is retired once the App path has shipped.
 */

import { prisma } from '@/lib/prisma'
import { sendEventToUser } from '@/lib/sse-utils'
import { hasCapability } from '@/lib/brand/capabilities'
import { isRedisAvailable, RedisCache } from '@/lib/redis'
import { createLogger } from '@/lib/logger'

const log = createLogger('github.webhooks.issues')

/** Long enough to cover GitHub's redelivery window for a burst. */
const DELIVERY_TTL_SECONDS = 60 * 60

/** Nudge every user linked to `repo`; returns how many were nudged. */
export async function nudgeIssuesSubscribers(repo: string, event: string): Promise<number> {
  const links = await prisma.externalListLink.findMany({
    where: { provider: 'GITHUB_ISSUES', remoteContainerId: repo },
    select: { userId: true, id: true },
  })
  const userIds = [...new Set(links.map(link => link.userId))]
  for (const userId of userIds) {
    sendEventToUser(userId, {
      type: 'external_sync_refresh',
      data: { provider: 'GITHUB_ISSUES', container: repo },
    } as never)
  }
  log.info({ repo, users: userIds.length, event }, 'GitHub issues webhook → SSE nudge')
  return userIds.length
}

/**
 * True unless this delivery was already handled. With Redis down it answers
 * true: a duplicate nudge costs one extra pull, a dropped one leaves a client
 * stale until its next poll.
 */
async function firstDelivery(deliveryId: string | undefined): Promise<boolean> {
  if (!deliveryId || deliveryId === 'unknown') return true
  if (!(await isRedisAvailable())) return true
  return RedisCache.claimOnce(`github:delivery:${deliveryId}`, DELIVERY_TTL_SECONDS)
}

/** The App webhook's handler for `issues` and `issue_comment`. */
export async function handleIssuesWebhook(
  event: 'issues' | 'issue_comment',
  payload: { repository?: { full_name?: string } },
  deliveryId?: string,
): Promise<void> {
  if (!hasCapability('syncGithubIssues')) return
  const repo = payload.repository?.full_name
  if (!repo) return
  if (!(await firstDelivery(deliveryId))) {
    log.info({ deliveryId, event, repo }, 'Duplicate GitHub delivery ignored')
    return
  }
  await nudgeIssuesSubscribers(repo, event)
}
