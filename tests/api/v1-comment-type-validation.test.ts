/**
 * RED for task 87e19910 — POST /api/v1/tasks/:id/comments passes `type`
 * straight into a Postgres enum column with no validation.
 *
 *     type: body.type || 'TEXT'
 *
 * `CommentType` in schema.prisma is TEXT | MARKDOWN | ATTACHMENT. Anything
 * else reaches the Prisma driver, which rejects the unknown label — surfacing
 * as a 500 where the caller deserved a 400 naming the accepted values.
 *
 * This is the SECOND instance of the same shape. POST /api/v1/lists had it for
 * `privacy`, found the same way: by writing the request interface and applying
 * it. The v1 shape file typed `type` as plain `string` even though
 * types/api.ts had carried the correct union for the legacy route all along,
 * so the type was available and simply not used here.
 *
 * Lower-case is covered on purpose: "text" is not "TEXT", and the enum is
 * case-sensitive, so the friendlier-looking spelling fails exactly like a
 * typo would.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { isV1CommentType, V1_COMMENT_TYPE_VALUES } from '@/lib/api-contracts/v1-request-shapes'

vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_opts: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx: unknown) =>
      handler(req, { userId: 'user-1', scopes: ['comments:write'] }, ctx),
}))

const commentCreate = vi.hoisted(() => vi.fn())
const taskFindUnique = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: {
    comment: { create: commentCreate, findFirst: vi.fn(), findMany: vi.fn() },
    task: { findUnique: taskFindUnique },
    secureFile: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    aIAgent: { findUnique: vi.fn() },
  },
}))

describe('V1CommentType guard (task 87e19910)', () => {
  it('accepts exactly the three schema.prisma labels', () => {
    expect(V1_COMMENT_TYPE_VALUES).toEqual(['TEXT', 'MARKDOWN', 'ATTACHMENT'])
    for (const value of V1_COMMENT_TYPE_VALUES) {
      expect(isV1CommentType(value)).toBe(true)
    }
  })

  it('rejects the values that reach the driver as a 500 today', () => {
    // An unknown label, and the lower-case spelling of a real one. The enum is
    // case-sensitive, so the second fails identically to the first.
    expect(isV1CommentType('BANANA')).toBe(false)
    expect(isV1CommentType('text')).toBe(false)
    expect(isV1CommentType('markdown')).toBe(false)
  })

  it('rejects non-strings rather than coercing them', () => {
    // `type: 0` would coerce to falsy and silently become TEXT under the old
    // `body.type || 'TEXT'`; that is a wrong write, not a rejected one.
    expect(isV1CommentType(0)).toBe(false)
    expect(isV1CommentType(null)).toBe(false)
    expect(isV1CommentType(undefined)).toBe(false)
    expect(isV1CommentType(['TEXT'])).toBe(false)
    expect(isV1CommentType({ type: 'TEXT' })).toBe(false)
  })
})

describe('POST /api/v1/tasks/:id/comments validates type (task 87e19910)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskFindUnique.mockResolvedValue({
      id: 'task-1',
      creatorId: 'user-1',
      assigneeId: null,
      isPrivate: false,
      lists: [{ id: 'list-1', privacy: 'PRIVATE', ownerId: 'user-1', listMembers: [] }],
    })
  })

  function post(body: unknown) {
    return new NextRequest('http://localhost/api/v1/tasks/task-1/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('400s on an unknown comment type instead of letting Prisma 500', async () => {
    const { POST } = await import('@/app/api/v1/tasks/[id]/comments/route')

    const response = await POST(post({ content: 'hi', type: 'BANANA' }), {
      params: Promise.resolve({ id: 'task-1' }),
    } as never)

    expect(response.status).toBe(400)
    const body = await response.json()
    // The message must name the accepted values — a bare "invalid type" leaves
    // the caller guessing at a case-sensitive enum.
    expect(body.error).toContain('TEXT')
    expect(commentCreate).not.toHaveBeenCalled()
  })

  it('400s on the lower-case spelling of a real type', async () => {
    const { POST } = await import('@/app/api/v1/tasks/[id]/comments/route')

    const response = await POST(post({ content: 'hi', type: 'text' }), {
      params: Promise.resolve({ id: 'task-1' }),
    } as never)

    expect(response.status).toBe(400)
    expect(commentCreate).not.toHaveBeenCalled()
  })

  it('still defaults to TEXT when type is omitted', async () => {
    commentCreate.mockResolvedValue({
      id: 'c1', content: 'hi', type: 'TEXT', createdAt: new Date(), updatedAt: new Date(),
      authorId: 'user-1', taskId: 'task-1', parentCommentId: null, author: null, secureFiles: [],
    })
    const { POST } = await import('@/app/api/v1/tasks/[id]/comments/route')

    await POST(post({ content: 'hi' }), {
      params: Promise.resolve({ id: 'task-1' }),
    } as never)

    expect(commentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'TEXT' }) })
    )
  })
})
