import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  taskList: {
    update: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  secureFile: { findUnique: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import {
  createListWithImageOwnership,
  deleteListWithImageRelease,
  deleteListsWithImageRelease,
  ListImageClaimError,
  updateListWithImageOwnership,
} from '@/lib/images/update-list-image'

describe('updateListWithImageOwnership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.taskList.update.mockResolvedValue({ id: 'list-1' })
    mockPrisma.taskList.create.mockResolvedValue({ id: 'list-1' })
    mockPrisma.taskList.findUnique.mockResolvedValue({ imageUrl: null })
    mockPrisma.taskList.findMany.mockResolvedValue([])
    mockPrisma.taskList.deleteMany.mockResolvedValue({ count: 0 })
    mockPrisma.secureFile.findUnique.mockResolvedValue(null)
    mockPrisma.secureFile.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.$transaction.mockImplementation(
      (operation: (client: typeof mockPrisma) => unknown) => operation(mockPrisma),
    )
    update.mockClear()
  })

  const update = vi.fn((client: typeof mockPrisma) =>
    client.taskList.update({
      where: { id: 'list-1' },
      data: { imageUrl: 'https://blob/new' },
    }),
  )

  it('claims a generated image before updating the list', async () => {
    mockPrisma.secureFile.findUnique.mockResolvedValue({
      id: 'file-1',
      uploadedBy: 'user-1',
      attachTarget: 'list-image',
      listId: null,
    })

    await updateListWithImageOwnership({
      listId: 'list-1',
      previousImageUrl: null,
      nextImageUrl: 'https://blob/new',
      userId: 'user-1',
      update,
    })

    expect(mockPrisma.secureFile.updateMany).toHaveBeenCalledWith({
      where: { id: 'file-1', OR: [{ listId: null }, { listId: 'list-1' }] },
      data: { listId: 'list-1' },
    })
    expect(mockPrisma.secureFile.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(mockPrisma.taskList.update.mock.invocationCallOrder[0])
  })

  it('claims a generated image in the list creation transaction', async () => {
    const imageUrl =
      'https://store.public.blob.vercel-storage.com/uploads/user-1/generated-123e4567-e89b-12d3-a456-426614174000.png'
    mockPrisma.secureFile.findUnique.mockResolvedValue({
      id: 'file-1',
      uploadedBy: 'user-1',
      attachTarget: 'list-image',
      listId: null,
    })

    await createListWithImageOwnership(
      imageUrl,
      'user-1',
      client => client.taskList.create({ data: { name: 'List', ownerId: 'user-1' } }),
    )

    expect(mockPrisma.secureFile.updateMany).toHaveBeenCalledWith({
      where: { id: 'file-1', listId: null },
      data: { listId: 'list-1' },
    })
  })

  it('releases every stale image claim after updating the list', async () => {
    await updateListWithImageOwnership({
      listId: 'list-1',
      previousImageUrl: 'https://blob/old',
      nextImageUrl: '/images/default.png',
      userId: 'user-1',
      update,
    })

    expect(mockPrisma.secureFile.updateMany).toHaveBeenCalledWith({
      where: {
        listId: 'list-1',
        attachTarget: 'list-image',
      },
      data: { listId: null },
    })
  })

  it('rejects a generated image owned by another user or list', async () => {
    mockPrisma.secureFile.findUnique.mockResolvedValue({
      id: 'file-1',
      uploadedBy: 'other-user',
      attachTarget: 'list-image',
      listId: null,
    })

    await expect(
      updateListWithImageOwnership({
        listId: 'list-1',
        previousImageUrl: null,
        nextImageUrl: 'https://blob/new',
        userId: 'user-1',
        update,
      }),
    ).rejects.toBeInstanceOf(ListImageClaimError)
    expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
  })

  it('allows a copied list to retain its unchanged shared image', async () => {
    const sharedUrl =
      'https://store.public.blob.vercel-storage.com/uploads/source/generated-123e4567-e89b-12d3-a456-426614174000.png'
    mockPrisma.taskList.findUnique.mockResolvedValue({ imageUrl: sharedUrl })

    await updateListWithImageOwnership({
      listId: 'copy-list',
      previousImageUrl: sharedUrl,
      nextImageUrl: sharedUrl,
      userId: 'copy-owner',
      update,
    })

    expect(mockPrisma.secureFile.findUnique).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalled()
  })

  it('rejects a generated blob whose row was concurrently swept', async () => {
    await expect(
      updateListWithImageOwnership({
        listId: 'list-1',
        previousImageUrl: null,
        nextImageUrl:
          'https://store.public.blob.vercel-storage.com/uploads/user-1/generated-123e4567-e89b-12d3-a456-426614174000.png',
        userId: 'user-1',
        update,
      }),
    ).rejects.toBeInstanceOf(ListImageClaimError)
    expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
  })

  it('keeps only the winning generated image claim', async () => {
    mockPrisma.secureFile.findUnique.mockResolvedValue({
      id: 'file-new',
      uploadedBy: 'user-1',
      attachTarget: 'list-image',
      listId: null,
    })

    await updateListWithImageOwnership({
      listId: 'list-1',
      previousImageUrl: 'https://blob/stale-snapshot',
      nextImageUrl: 'https://blob/new',
      userId: 'user-1',
      update,
    })

    expect(mockPrisma.secureFile.updateMany).toHaveBeenLastCalledWith({
      where: {
        listId: 'list-1',
        attachTarget: 'list-image',
        id: { not: 'file-new' },
      },
      data: { listId: null },
    })
  })

  it('keeps non-image mutations transactional', async () => {
    await updateListWithImageOwnership({
      listId: 'list-1',
      previousImageUrl: 'https://blob/same',
      nextImageUrl: 'https://blob/same',
      userId: 'user-1',
      update,
    })

    expect(mockPrisma.$transaction).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith(mockPrisma)
  })

  it('releases generated images before deleting their list', async () => {
    const remove = vi.fn((client: typeof mockPrisma) =>
      client.taskList.update({ where: { id: 'list-1' }, data: {} }),
    )

    await deleteListWithImageRelease('list-1', remove)

    expect(mockPrisma.secureFile.updateMany).toHaveBeenCalledWith({
      where: { listId: 'list-1', attachTarget: 'list-image' },
      data: { listId: null },
    })
    expect(mockPrisma.secureFile.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(remove.mock.invocationCallOrder[0])
  })

  it('releases generated images before bulk list deletion', async () => {
    const where = { ownerId: 'user-1', isVirtual: true }
    mockPrisma.taskList.findMany
      .mockResolvedValueOnce([{ id: 'list-1' }, { id: 'list-2' }])
      .mockResolvedValueOnce([{ id: 'list-1' }, { id: 'list-2' }])
    mockPrisma.taskList.deleteMany.mockResolvedValue({ count: 2 })

    await deleteListsWithImageRelease(where)

    expect(mockPrisma.secureFile.updateMany).toHaveBeenCalledWith({
      where: {
        attachTarget: 'list-image',
        listId: { in: ['list-1', 'list-2'] },
      },
      data: { listId: null },
    })
    expect(mockPrisma.taskList.deleteMany).toHaveBeenCalledWith({
      where: {
        AND: [
          where,
          { id: { in: ['list-1', 'list-2'] } },
        ],
      },
    })
  })
})
