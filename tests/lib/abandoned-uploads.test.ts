/**
 * Sweeping composer uploads that were never sent (Task 276b3086).
 *
 * The danger here is deleting a file someone can still see, so almost all of
 * these tests are about what the sweep must NOT touch. The one thing it may
 * delete is narrow: a file uploaded for a message (`attachTarget = 'message'`)
 * that never got attached to one, and only after a grace period long enough
 * that nobody is still typing the message it belongs to.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ABANDONED_UPLOAD_GRACE_MS,
  abandonedUploadWhere,
  sweepAbandonedUploads,
} from '@/lib/abandoned-uploads'

describe('abandonedUploadWhere (Task 276b3086)', () => {
  const now = new Date('2026-08-04T12:00:00Z')

  it('only ever matches uploads declared as being for a message', () => {
    // A task-form upload has the same null commentId. Without the
    // discriminator these are indistinguishable, which is the whole reason
    // ded31696 added it.
    expect(abandonedUploadWhere(now).attachTarget).toBe('message')
  })

  it('only matches files that never reached a comment or a chat message', () => {
    const where = abandonedUploadWhere(now)

    expect(where.commentId).toBeNull()
    expect(where.chatMessageId).toBeNull()
  })

  it('leaves a grace period long enough to survive someone still typing', () => {
    const where = abandonedUploadWhere(now)

    expect(where.createdAt.lt.getTime()).toBe(now.getTime() - ABANDONED_UPLOAD_GRACE_MS)
    // Hours, not minutes: a draft can legitimately sit open all day.
    expect(ABANDONED_UPLOAD_GRACE_MS).toBeGreaterThanOrEqual(12 * 60 * 60 * 1000)
  })
})

describe('sweepAbandonedUploads (Task 276b3086)', () => {
  let prisma: any
  let deleteFile: any

  beforeEach(() => {
    prisma = {
      secureFile: {
        findMany: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue({}),
      },
    }
    deleteFile = vi.fn().mockResolvedValue(undefined)
  })

  it('deletes the row and the blob for each abandoned upload', async () => {
    prisma.secureFile.findMany.mockResolvedValue([
      { id: 'f1', blobUrl: 'https://blob/f1' },
      { id: 'f2', blobUrl: 'https://blob/f2' },
    ])

    const result = await sweepAbandonedUploads({ prisma, deleteFile, now: new Date() })

    expect(prisma.secureFile.delete).toHaveBeenCalledTimes(2)
    expect(deleteFile).toHaveBeenCalledWith('https://blob/f1')
    expect(deleteFile).toHaveBeenCalledWith('https://blob/f2')
    expect(result).toMatchObject({ rowsDeleted: 2, blobsDeleted: 2 })
  })

  it('keeps going when one blob delete fails, and says so', async () => {
    // One unreachable blob must not strand every later row in the sweep.
    prisma.secureFile.findMany.mockResolvedValue([
      { id: 'f1', blobUrl: 'https://blob/f1' },
      { id: 'f2', blobUrl: 'https://blob/f2' },
    ])
    deleteFile.mockRejectedValueOnce(new Error('gone'))

    const result = await sweepAbandonedUploads({ prisma, deleteFile, now: new Date() })

    expect(prisma.secureFile.delete).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ rowsDeleted: 2, blobsDeleted: 1, blobFailures: 1 })
  })

  it('does nothing, loudly, when there is nothing to sweep', async () => {
    const result = await sweepAbandonedUploads({ prisma, deleteFile, now: new Date() })

    expect(prisma.secureFile.delete).not.toHaveBeenCalled()
    expect(deleteFile).not.toHaveBeenCalled()
    expect(result).toMatchObject({ rowsDeleted: 0, blobsDeleted: 0 })
  })

  it('asks the database only for the narrow abandoned set', async () => {
    const now = new Date('2026-08-04T12:00:00Z')

    await sweepAbandonedUploads({ prisma, deleteFile, now })

    expect(prisma.secureFile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: abandonedUploadWhere(now) }),
    )
  })

  it('caps how much one run will delete', async () => {
    // A runaway first run should not delete unboundedly before anyone sees the
    // log line saying what it did.
    await sweepAbandonedUploads({ prisma, deleteFile, now: new Date() })

    const args = prisma.secureFile.findMany.mock.calls[0][0]
    expect(args.take).toBeGreaterThan(0)
  })
})
