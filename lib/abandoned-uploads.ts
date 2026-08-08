/**
 * Reclaiming composer uploads that were never sent. (Task 276b3086)
 *
 * Attach a photo to a comment and close the tab without sending it: the
 * SecureFile row and its blob stay in storage forever. Task ded31696 stopped
 * those from masquerading as task attachments and made an explicit chip
 * removal delete the file, but a tab that simply closes never runs the client,
 * so nothing reclaims the blob. There is no user-visible symptom — it is a
 * slow storage leak, and blobs are billed by volume.
 *
 * The risk runs entirely one way: this deletes files, and a file someone can
 * still see must never be touched. Two guards do that work.
 *
 * **The discriminator.** Only `attachTarget = 'message'` is eligible. A
 * task-form upload has the same null `commentId`, and rows written before
 * ded31696 have `attachTarget` null and are indistinguishable from real task
 * attachments — sweeping either would delete files users currently see.
 *
 * **The grace period.** A composer upload sits in exactly this state for as
 * long as the user is still typing. Sweeping without a generous window would
 * pull the photo out from under someone mid-sentence, and they would watch the
 * thumbnail vanish. Hours, not minutes: a draft can legitimately sit open all
 * day.
 */

import { createLogger } from "@/lib/logger"

const log = createLogger("abandoned-uploads")

/**
 * How long an unsent upload is left alone. A day is comfortably longer than
 * any real composing session, and this is a storage leak — there is nothing to
 * gain from sweeping aggressively.
 */
export const ABANDONED_UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000

/**
 * Ceiling on one run, so a first sweep over a long-accumulated backlog deletes
 * a bounded amount before anyone reads the log line saying what it did. The
 * next run picks up the remainder.
 */
export const ABANDONED_UPLOAD_BATCH = 500

export interface AbandonedUploadWhere {
  attachTarget: string
  commentId: null
  chatMessageId: null
  createdAt: { lt: Date }
}

/** Exactly the rows that are safe to reclaim — see the guards above. */
export function abandonedUploadWhere(now: Date): AbandonedUploadWhere {
  return {
    attachTarget: "message",
    commentId: null,
    chatMessageId: null,
    createdAt: { lt: new Date(now.getTime() - ABANDONED_UPLOAD_GRACE_MS) },
  }
}

export interface SweepResult {
  rowsDeleted: number
  blobsDeleted: number
  blobFailures: number
}

/**
 * Just enough of the Prisma client to run the sweep, so tests can pass a plain
 * double instead of a real client. Loosely typed on purpose — Prisma's generated
 * signatures are generic and will not structurally satisfy a narrow interface.
 */
export interface SweepPrisma {
  secureFile: {
    findMany: (...args: any[]) => Promise<any>
    delete: (...args: any[]) => Promise<any>
    count: (...args: any[]) => Promise<number>
  }
}

export interface SweepDeps {
  prisma: SweepPrisma
  deleteFile: (blobUrl: string) => Promise<void>
  now: Date
}

/**
 * Delete abandoned uploads, row and blob.
 *
 * The row goes first, matching DELETE /api/secure-files: an orphaned blob is a
 * storage cost, whereas a row pointing at a deleted blob is a broken
 * attachment. A blob that refuses to delete is counted and stepped over rather
 * than aborting the run — one unreachable file must not strand every row
 * behind it.
 */
export async function sweepAbandonedUploads(deps: SweepDeps): Promise<SweepResult> {
  const { prisma, deleteFile, now } = deps

  const abandoned: Array<{ id: string; blobUrl: string }> = await prisma.secureFile.findMany({
    where: abandonedUploadWhere(now),
    select: { id: true, blobUrl: true },
    take: ABANDONED_UPLOAD_BATCH,
  })

  const result: SweepResult = { rowsDeleted: 0, blobsDeleted: 0, blobFailures: 0 }

  for (const file of abandoned) {
    try {
      await prisma.secureFile.delete({ where: { id: file.id } })
      result.rowsDeleted += 1
    } catch (error) {
      // Already gone, or a concurrent send just claimed it. Either way the
      // blob is no longer ours to delete.
      log.warn({ err: error, fileId: file.id }, "Could not delete abandoned upload row")
      continue
    }

    try {
      await deleteFile(file.blobUrl)
      result.blobsDeleted += 1
    } catch (error) {
      result.blobFailures += 1
      log.warn({ err: error, blobUrl: file.blobUrl }, "Row deleted but blob remains")
    }
  }

  return result
}


/**
 * Rows written before the discriminator existed that cannot be classified.
 *
 * `attachTarget` null with `commentId` null is exactly the shape of a task-form
 * upload, and since task b4a362f1 those render as task attachments — so they
 * cannot be swept without deleting files people can currently see. There is no
 * signal that separates "abandoned draft" from "attached to the task" for a row
 * written before the intent was recorded.
 *
 * Counting them is the honest alternative to leaving it as a caveat in a task
 * comment: the backlog becomes a number in the cron log that someone can act
 * on, or watch stay flat and stop worrying about.
 */
export function ambiguousLegacyWhere() {
  return { attachTarget: null, commentId: null, chatMessageId: null }
}

export async function countAmbiguousLegacyUploads(prisma: SweepPrisma): Promise<number> {
  return prisma.secureFile.count({ where: ambiguousLegacyWhere() })
}
