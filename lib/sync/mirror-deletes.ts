import { prisma } from '@/lib/prisma'
import { githubRequest, githubTokenFor } from '@/lib/sync/github'
import { googleRequest, googleTokenFor } from '@/lib/sync/google'
import { createLogger } from '@/lib/logger'

const log = createLogger('sync.mirror-deletes')

const TOMBSTONE_CAP = 500

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
  for (const link of links) {
    const integration = await prisma.integration.findUnique({ where: { id: link.integrationId } })
    if (!integration || integration.revokedAt) continue

    const meta = (integration.metadata as Record<string, string> | null) || {}
    const tombstones = String(meta.tombstonedRemoteIds || '').split(',').filter(Boolean)
    if (!tombstones.includes(link.remoteId)) {
      tombstones.push(link.remoteId)
      await prisma.integration.update({
        where: { id: integration.id },
        data: { metadata: { ...meta, tombstonedRemoteIds: tombstones.slice(-TOMBSTONE_CAP).join(',') } },
      })
    }

    try {
      if (link.provider === 'GITHUB_ISSUES') {
        const token = await githubTokenFor(integration.userId)
        const number = link.remoteId.split('#').pop()
        if (token && number) {
          await githubRequest(token, 'PATCH', `/repos/${link.remoteContainerId}/issues/${number}`, { state: 'closed' })
        }
      } else if (link.provider === 'GOOGLE_TASKS') {
        const token = await googleTokenFor(integration.userId)
        const gid = link.remoteId.split(':').pop()
        if (token && gid) {
          await googleRequest(
            token, 'DELETE',
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
