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
  ABANDONED_UPLOAD_SCAN_PAGES,
  abandonedUploadWhere,
  ambiguousLegacyWhere,
  countAmbiguousLegacyUploads,
  sweepAbandonedUploads,
} from '@/lib/abandoned-uploads'

describe('abandonedUploadWhere (Task 276b3086)', () => {
  const now = new Date('2026-08-04T12:00:00Z')

  it('only ever matches reclaimable upload purposes', () => {
    // A task-form upload has the same null commentId. Without the
    // discriminator these are indistinguishable, which is the whole reason
    // ded31696 added it.
    expect(abandonedUploadWhere(now).OR).toEqual([
      { attachTarget: 'message' },
      { attachTarget: 'list-image', listId: null },
    ])
  })

  it('only matches files that never reached a comment or a chat message', () => {
    const where = abandonedUploadWhere(now)

    expect(where.commentId).toBeNull()
    expect(where.chatMessageId).toBeNull()
  })

  it('leaves a grace period long enough to survive someone still typing', () => {
    const where = abandonedUploadWhere(now)

    expect(where.updatedAt.lt.getTime()).toBe(now.getTime() - ABANDONED_UPLOAD_GRACE_MS)
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
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      taskList: {
        findMany: vi.fn().mockResolvedValue([]),
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

  it('reclaims unlinked list images', async () => {
    prisma.secureFile.findMany.mockResolvedValue([
      { id: 'replaced', blobUrl: 'https://blob/replaced', attachTarget: 'list-image' },
    ])

    const result = await sweepAbandonedUploads({ prisma, deleteFile, now: new Date() })

    expect(prisma.secureFile.deleteMany).toHaveBeenCalledWith({
      where: { id: 'replaced', listId: null },
    })
    expect(deleteFile).toHaveBeenCalledWith('https://blob/replaced')
    expect(result).toMatchObject({ rowsDeleted: 1, blobsDeleted: 1 })
  })

  it('protects and postpones a legacy image that a list still references', async () => {
    prisma.secureFile.findMany.mockResolvedValueOnce([
      { id: 'legacy', blobUrl: 'https://blob/legacy', attachTarget: 'list-image' },
    ])
    prisma.taskList.findMany.mockResolvedValueOnce([
      { id: 'list-1', imageUrl: 'https://blob/legacy' },
    ])

    const result = await sweepAbandonedUploads({ prisma, deleteFile, now: new Date() })

    expect(prisma.secureFile.updateMany).toHaveBeenCalledWith({
      where: { id: 'legacy', listId: null },
      data: { updatedAt: expect.any(Date) },
    })
    expect(deleteFile).not.toHaveBeenCalled()
    expect(result).toMatchObject({ rowsDeleted: 0, blobsDeleted: 0 })
  })

  it('paginates past a full page of referenced legacy images', async () => {
    const referenced = Array.from({ length: 500 }, (_, index) => ({
      id: `active-${index.toString().padStart(3, '0')}`,
      blobUrl: `https://blob/active-${index}`,
      attachTarget: 'list-image',
    }))
    prisma.secureFile.findMany
      .mockResolvedValueOnce(referenced)
      .mockResolvedValueOnce([
        { id: 'abandoned', blobUrl: 'https://blob/abandoned', attachTarget: 'list-image' },
      ])
    prisma.taskList.findMany
      .mockResolvedValueOnce(referenced.map((file, index) => ({
        id: `list-${index}`,
        imageUrl: file.blobUrl,
      })))
      .mockResolvedValueOnce([])

    const result = await sweepAbandonedUploads({ prisma, deleteFile, now: new Date() })

    expect(prisma.secureFile.findMany).toHaveBeenCalledTimes(2)
    expect(deleteFile).toHaveBeenCalledWith('https://blob/abandoned')
    expect(result).toMatchObject({ rowsDeleted: 1, blobsDeleted: 1 })
  })

  it('caps legacy backfill scanning per run', async () => {
    const referenced = Array.from({ length: 500 }, (_, index) => ({
      id: `active-${index.toString().padStart(3, '0')}`,
      blobUrl: `https://blob/active-${index}`,
      attachTarget: 'list-image',
    }))
    prisma.secureFile.findMany.mockResolvedValue(referenced)
    prisma.taskList.findMany.mockResolvedValue(
      referenced.map((file, index) => ({
        id: `list-${index}`,
        imageUrl: file.blobUrl,
      })),
    )

    await sweepAbandonedUploads({ prisma, deleteFile, now: new Date() })

    expect(prisma.secureFile.findMany).toHaveBeenCalledTimes(ABANDONED_UPLOAD_SCAN_PAGES)
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('excludes linked list images before applying the batch limit', async () => {
    await sweepAbandonedUploads({ prisma, deleteFile, now: new Date() })

    expect(prisma.secureFile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { attachTarget: 'message' },
            { attachTarget: 'list-image', listId: null },
          ],
        }),
      }),
    )
  })

  it('does not delete a blob when a concurrent list update claims its row', async () => {
    prisma.secureFile.findMany.mockResolvedValue([
      { id: 'claimed', blobUrl: 'https://blob/claimed', attachTarget: 'list-image' },
    ])
    prisma.secureFile.deleteMany.mockResolvedValue({ count: 0 })

    const result = await sweepAbandonedUploads({ prisma, deleteFile, now: new Date() })

    expect(prisma.secureFile.deleteMany).toHaveBeenCalledWith({
      where: { id: 'claimed', listId: null },
    })
    expect(deleteFile).not.toHaveBeenCalled()
    expect(result).toMatchObject({ rowsDeleted: 0, blobsDeleted: 0 })
  })
})


describe('ambiguousLegacyWhere (Task 276b3086)', () => {
  it('matches only rows written before the discriminator existed', () => {
    expect(ambiguousLegacyWhere()).toEqual({
      attachTarget: null,
      commentId: null,
      chatMessageId: null,
    })
  })

  it('never overlaps the set the sweep deletes', () => {
    // The whole point: these are counted, never swept. A row cannot be both
    // attachTarget 'message' and attachTarget null.
    const sweepable = abandonedUploadWhere(new Date())
    expect(sweepable.OR).not.toContainEqual(expect.objectContaining({ attachTarget: null }))
    expect(ambiguousLegacyWhere().attachTarget).toBeNull()
  })

  it('counts them without touching anything', async () => {
    const count = vi.fn().mockResolvedValue(41)
    const prisma = {
      secureFile: { count, findMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    } as never

    expect(await countAmbiguousLegacyUploads(prisma)).toBe(41)
    expect(count).toHaveBeenCalledWith({ where: ambiguousLegacyWhere() })
  })
})
