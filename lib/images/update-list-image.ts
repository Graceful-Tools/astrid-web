import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export class ListImageClaimError extends Error {
  constructor() {
    super('Generated image is already attached to another list')
    this.name = 'ListImageClaimError'
  }
}

type ListUpdateClient = Pick<
  Prisma.TransactionClient,
  'taskList' | 'listMember' | 'task'
>
type ListDeleteClient = Pick<Prisma.TransactionClient, 'taskList'>
type ListCreateClient = Pick<Prisma.TransactionClient, 'taskList'>

interface UpdateListImageInput<T> {
  listId: string
  previousImageUrl: string | null
  nextImageUrl: string | null | undefined
  userId: string
  update: (client: ListUpdateClient) => Promise<T>
}

function isStoredGeneratedImageUrl(imageUrl: string): boolean {
  try {
    return /\/uploads\/[^/]+\/generated-[0-9a-f-]{36}\.[a-z0-9]+$/i.test(
      new URL(imageUrl).pathname,
    )
  } catch {
    return false
  }
}

/**
 * Keep generated-image ownership and the list update atomic. The sweep uses a
 * conditional delete on listId=null, so either this claim wins or the update
 * fails before a list can point at a deleted blob.
 */
export async function updateListWithImageOwnership<T>({
  listId,
  previousImageUrl,
  nextImageUrl,
  userId,
  update,
}: UpdateListImageInput<T>): Promise<T> {
  if (nextImageUrl === undefined) {
    return prisma.$transaction(tx => update(tx))
  }

  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "TaskList" WHERE "id" = ${listId} FOR UPDATE`
    const currentList = await tx.taskList.findUnique({
      where: { id: listId },
      select: { imageUrl: true },
    })
    if (currentList?.imageUrl === nextImageUrl) {
      return update(tx)
    }

    const generatedImage = nextImageUrl
      ? await tx.secureFile.findUnique({
          where: { blobUrl: nextImageUrl },
          select: { id: true, uploadedBy: true, attachTarget: true, listId: true },
        })
      : null

    if (nextImageUrl && !generatedImage && isStoredGeneratedImageUrl(nextImageUrl)) {
      throw new ListImageClaimError()
    }
    if (
      generatedImage?.attachTarget === 'list-image' &&
      (generatedImage.uploadedBy !== userId ||
        (generatedImage.listId !== null && generatedImage.listId !== listId))
    ) {
      throw new ListImageClaimError()
    }

    if (generatedImage?.attachTarget === 'list-image') {
      const claimed = await tx.secureFile.updateMany({
        where: { id: generatedImage.id, OR: [{ listId: null }, { listId }] },
        data: { listId },
      })
      if (claimed.count === 0) throw new ListImageClaimError()
    }

    const updated = await update(tx)

    await tx.secureFile.updateMany({
      where: {
        listId,
        attachTarget: 'list-image',
        ...(generatedImage?.attachTarget === 'list-image'
          ? { id: { not: generatedImage.id } }
          : {}),
      },
      data: { listId: null },
    })

    return updated
  })
}

export async function createListWithImageOwnership<T extends { id: string }>(
  imageUrl: string | null | undefined,
  userId: string,
  create: (client: ListCreateClient) => Promise<T>,
): Promise<T> {
  if (!imageUrl || !isStoredGeneratedImageUrl(imageUrl)) {
    return create(prisma)
  }

  const generatedImage = await prisma.secureFile.findUnique({
    where: { blobUrl: imageUrl },
    select: { id: true, uploadedBy: true, attachTarget: true, listId: true },
  })
  if (
    !generatedImage ||
    generatedImage.attachTarget !== 'list-image' ||
    generatedImage.uploadedBy !== userId ||
    generatedImage.listId !== null
  ) {
    throw new ListImageClaimError()
  }

  return prisma.$transaction(async tx => {
    const list = await create(tx)
    const claimed = await tx.secureFile.updateMany({
      where: { id: generatedImage.id, listId: null },
      data: { listId: list.id },
    })
    if (claimed.count === 0) throw new ListImageClaimError()
    return list
  })
}

export async function deleteListWithImageRelease<T>(
  listId: string,
  remove: (client: ListDeleteClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "TaskList" WHERE "id" = ${listId} FOR UPDATE`
    await tx.secureFile.updateMany({
      where: { listId, attachTarget: 'list-image' },
      data: { listId: null },
    })
    return remove(tx)
  })
}

export async function deleteListsWithImageRelease(
  where: Prisma.TaskListWhereInput,
): Promise<Prisma.BatchPayload> {
  return prisma.$transaction(async tx => {
    const lists = await tx.taskList.findMany({ where, select: { id: true } })
    if (lists.length === 0) return { count: 0 }
    const listIds = lists.map(list => list.id)
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "TaskList" WHERE "id" IN (${Prisma.join(listIds)}) FOR UPDATE`,
    )
    const confirmedLists = await tx.taskList.findMany({
      where: { AND: [where, { id: { in: listIds } }] },
      select: { id: true },
    })
    const confirmedListIds = confirmedLists.map(list => list.id)
    if (confirmedListIds.length === 0) return { count: 0 }
    await tx.secureFile.updateMany({
      where: {
        attachTarget: 'list-image',
        listId: { in: confirmedListIds },
      },
      data: { listId: null },
    })
    return tx.taskList.deleteMany({
      where: { AND: [where, { id: { in: confirmedListIds } }] },
    })
  })
}
