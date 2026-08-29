import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  associateFileWithComment,
  createCommentIdempotently,
} from '@/lib/comments/create-comment'
import { prisma } from '@/lib/prisma'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    comment: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    secureFile: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

const include = { author: true } as const
const createArgs = {
  taskId: 'task-1',
  authorId: 'user-1',
  clientRequestId: 'request-12345678',
  data: { content: 'Hello', type: 'TEXT' as const },
  include,
}

describe('createCommentIdempotently', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an existing comment without creating a duplicate', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      id: 'comment-1',
      taskId: 'task-1',
      authorId: 'user-1',
      author: {},
    } as never)

    const result = await createCommentIdempotently(createArgs)

    expect(result.kind).toBe('existing')
    expect(prisma.comment.create).not.toHaveBeenCalled()
  })

  it('creates a comment with the normalized idempotency key', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.comment.create).mockResolvedValue({
      id: 'comment-1',
      taskId: 'task-1',
      authorId: 'user-1',
      author: {},
    } as never)

    const result = await createCommentIdempotently({
      ...createArgs,
      clientRequestId: '  request-12345678  ',
    })

    expect(result.kind).toBe('created')
    expect(prisma.comment.create).toHaveBeenCalledWith({
      data: {
        content: 'Hello',
        type: 'TEXT',
        taskId: 'task-1',
        authorId: 'user-1',
        clientRequestId: 'request-12345678',
      },
      include,
    })
  })

  it('returns the winning comment after a concurrent retry', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    })
    vi.mocked(prisma.comment.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'winner',
        taskId: 'task-1',
        authorId: 'user-1',
        author: {},
      } as never)
    vi.mocked(prisma.comment.create).mockRejectedValue(duplicate)

    const result = await createCommentIdempotently(createArgs)

    expect(result).toMatchObject({ kind: 'existing', comment: { id: 'winner' } })
  })
})

describe('associateFileWithComment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('links an authorized file and returns the refreshed route shape', async () => {
    const file = {
      id: 'file-1',
      uploadedBy: 'user-1',
      chatMessage: null,
    }
    vi.mocked(prisma.secureFile.findUnique).mockResolvedValue(file as never)
    vi.mocked(prisma.secureFile.update).mockResolvedValue({} as never)
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      id: 'comment-1',
      taskId: 'task-1',
      authorId: 'user-1',
      author: {},
    } as never)
    const canLink = vi.fn().mockResolvedValue(true)

    const result = await associateFileWithComment({
      fileId: 'file-1',
      commentId: 'comment-1',
      include,
      canLink,
    })

    expect(canLink).toHaveBeenCalledWith(file)
    expect(prisma.secureFile.update).toHaveBeenCalledWith({
      where: { id: 'file-1' },
      data: { commentId: 'comment-1' },
    })
    expect(result).toMatchObject({ id: 'comment-1' })
  })

  it('does not link a file rejected by the route-specific access rule', async () => {
    vi.mocked(prisma.secureFile.findUnique).mockResolvedValue({
      id: 'file-1',
      uploadedBy: 'other-user',
      chatMessage: null,
    } as never)

    const result = await associateFileWithComment({
      fileId: 'file-1',
      commentId: 'comment-1',
      include,
      canLink: () => false,
    })

    expect(result).toBeNull()
    expect(prisma.secureFile.update).not.toHaveBeenCalled()
  })
})
