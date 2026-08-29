import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  findCommentByClientRequestId,
  isDuplicateClientRequestId,
  parseClientRequestId,
} from '@/lib/comment-idempotency'

type CommentPayload<TInclude extends Prisma.CommentInclude> =
  Prisma.CommentGetPayload<{ include: TInclude }>

export type CreateCommentResult<TInclude extends Prisma.CommentInclude> =
  | { kind: 'created'; comment: CommentPayload<TInclude> }
  | { kind: 'existing'; comment: CommentPayload<TInclude> }
  | { kind: 'invalid'; error: string }
  | { kind: 'conflict'; error: string }

export async function createCommentIdempotently<TInclude extends Prisma.CommentInclude>(
  args: {
    taskId: string
    authorId: string
    clientRequestId: unknown
    data: Omit<
      Prisma.CommentUncheckedCreateInput,
      'taskId' | 'authorId' | 'clientRequestId'
    >
    include: TInclude
  },
): Promise<CreateCommentResult<TInclude>> {
  const parsed = parseClientRequestId(args.clientRequestId)
  if (!parsed.ok) return { kind: 'invalid', error: parsed.error }

  const clientRequestId = parsed.clientRequestId
  if (clientRequestId) {
    const existing = await findCommentByClientRequestId({
      clientRequestId,
      taskId: args.taskId,
      authorId: args.authorId,
      include: args.include,
    })
    if (existing) return { kind: 'existing', comment: existing }
  }

  try {
    const comment = await prisma.comment.create({
      data: {
        ...args.data,
        taskId: args.taskId,
        authorId: args.authorId,
        clientRequestId,
      },
      include: args.include,
    })
    return { kind: 'created', comment }
  } catch (error) {
    if (!clientRequestId || !isDuplicateClientRequestId(error)) throw error

    const existing = await findCommentByClientRequestId({
      clientRequestId,
      taskId: args.taskId,
      authorId: args.authorId,
      include: args.include,
    })
    if (existing) return { kind: 'existing', comment: existing }
    return {
      kind: 'conflict',
      error: 'clientRequestId already used by another request',
    }
  }
}

export interface LinkableCommentFile {
  id: string
  uploadedBy: string
  chatMessage: { channelId: string } | null
}

export async function associateFileWithComment<TInclude extends Prisma.CommentInclude>(
  args: {
    fileId: string
    commentId: string
    include: TInclude
    canLink: (file: LinkableCommentFile) => boolean | Promise<boolean>
  },
): Promise<CommentPayload<TInclude> | null> {
  const file = await prisma.secureFile.findUnique({
    where: { id: args.fileId },
    select: {
      id: true,
      uploadedBy: true,
      chatMessage: { select: { channelId: true } },
    },
  })
  if (!file || !(await args.canLink(file))) return null

  await prisma.secureFile.update({
    where: { id: args.fileId },
    data: { commentId: args.commentId },
  })
  return prisma.comment.findUnique({
    where: { id: args.commentId },
    include: args.include,
  })
}
