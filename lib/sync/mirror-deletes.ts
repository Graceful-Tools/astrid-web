import { prisma } from '@/lib/prisma'
import { githubRequest, githubTokenFor } from '@/lib/sync/github'
import { googleRequest, googleTokenFor } from '@/lib/sync/google'
import { createLogger } from '@/lib/logger'

const log = createLogger('sync.mirror-deletes')

const TOMBSTONE_CAP = 2000 // raised: GitHub twins are only closed (not deleted),
// so an evicted tombstone can resurrect a deleted task via completed-backfill

/**
 * A mirrored task is being deleted: its ExternalTaskLink rows cascade away
 * with the row, so any client that didn't perform the delete would re-import
 * the surviving remote twin on its next pull. Called from the task DELETE
 * routes BEFORE the cascade:
 *
 * 1. Tombstones the remoteId on each affected user's Integration.metadata
 *    (clients merge these into their local ledgers on refresh).
 * 2. Best-effort mirrors the deletion outward — closes the GitHub issue /
 *    deletes the Google task — since the deleting client (e.g. web) has no
 *    sync worker of its own.
 */
export async function mirrorExternalDeletesForTask(taskId: string) {
  const links = await prisma.externalTaskLink.findMany({ where: { astridTaskId: taskId } })
  if (links.length === 0) return

  const integrationIds = Array.from(new Set(links.map(link => link.integrationId)))
  const integrations = await prisma.integration.findMany({
    where: { id: { in: integrationIds } },
  })
  const linksByIntegration = new Map<string, typeof links>()
  for (const link of links) {
    const grouped = linksByIntegration.get(link.integrationId) || []
    grouped.push(link)
    linksByIntegration.set(link.integrationId, grouped)
  }

  for (const integration of integrations) {
    if (!integration || integration.revokedAt) continue
    const integrationLinks = linksByIntegration.get(integration.id) || []

    const meta = (integration.metadata as Record<string, string> | null) || {}
    const tombstones = String(meta.tombstonedRemoteIds || '').split(',').filter(Boolean)
    const tombstoneSet = new Set(tombstones)
    for (const link of integrationLinks) {
      tombstoneSet.add(link.remoteId)
    }
    const nextTombstones = Array.from(tombstoneSet)
    if (nextTombstones.length !== tombstones.length) {
      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          metadata: {
            ...meta,
            tombstonedRemoteIds: nextTombstones.slice(-TOMBSTONE_CAP).join(','),
          },
        },
      })
    }

    let githubToken: string | null | undefined
    let googleToken: string | null | undefined
    let githubTokenLoaded = false
    let googleTokenLoaded = false
    for (const link of integrationLinks) {
      try {
        if (link.provider === 'GITHUB_ISSUES') {
          if (!githubTokenLoaded) {
            githubToken = await githubTokenFor(integration.userId)
            githubTokenLoaded = true
          }
          const number = link.remoteId.split('#').pop()
          if (githubToken && number) {
            await githubRequest(githubToken, 'PATCH', `/repos/${link.remoteContainerId}/issues/${number}`, { state: 'closed' })
          }
        } else if (link.provider === 'GOOGLE_TASKS') {
          if (!googleTokenLoaded) {
            googleToken = await googleTokenFor(integration.userId)
            googleTokenLoaded = true
          }
          const gid = link.remoteId.split(':').pop()
          if (googleToken && gid) {
            await googleRequest(
              googleToken, 'DELETE',
              `/lists/${encodeURIComponent(link.remoteContainerId)}/tasks/${encodeURIComponent(gid)}`
            )
          }
        }
      } catch (err) {
        // Best-effort: the tombstone alone prevents resurrection; a client's
        // sync pass can finish the remote cleanup later.
        log.warn({ err, remoteId: link.remoteId }, 'remote delete mirror failed')
      }
    }
  }
}
