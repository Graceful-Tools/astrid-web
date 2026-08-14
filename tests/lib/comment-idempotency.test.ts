/**
 * Task e0613ae5 — comment retry safety, shared by /api/tasks/:id/comments and
 * its v1 twin.
 *
 * The ownership scoping is the part worth pinning: clientRequestId is unique
 * globally, so a lookup that trusted it alone would hand a caller someone
 * else's comment.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { comment: { findUnique: vi.fn() } },
}))

import {
  parseClientRequestId,
  findCommentByClientRequestId,
  isDuplicateClientRequestId,
} from '@/lib/comment-idempotency'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

const mockPrisma = vi.mocked(prisma)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseClientRequestId (task e0613ae5)', () => {
  it('accepts a plausible id and trims it', () => {
    expect(parseClientRequestId('  abcdefgh  ')).toEqual({ ok: true, clientRequestId: 'abcdefgh' })
  })

  it('treats an absent id as opting out, not as an error', () => {
    expect(parseClientRequestId(undefined)).toEqual({ ok: true, clientRequestId: null })
    expect(parseClientRequestId(null)).toEqual({ ok: true, clientRequestId: null })
    expect(parseClientRequestId(42)).toEqual({ ok: true, clientRequestId: null })
  })

  it('rejects an id too short to be unique', () => {
    // A 7-character id would collide between unrelated clients, and a collision
    // here means returning someone else's comment.
    expect(parseClientRequestId('abcdefg').ok).toBe(false)
  })

  it('rejects an id longer than the column will index', () => {
    expect(parseClientRequestId('x'.repeat(129)).ok).toBe(false)
  })

  it('accepts exactly the boundary lengths', () => {
    expect(parseClientRequestId('x'.repeat(8)).ok).toBe(true)
    expect(parseClientRequestId('x'.repeat(128)).ok).toBe(true)
  })

  it('treats a whitespace-only id as too short, not as absent', () => {
    // It trims to '', which is a client that sent something wrong rather than
    // a client that sent nothing.
    expect(parseClientRequestId('        ').ok).toBe(false)
  })
})

describe('findCommentByClientRequestId (task e0613ae5)', () => {
  const args = {
    clientRequestId: 'abcdefgh',
    taskId: 'task-1',
    authorId: 'user-1',
    include: { author: true },
  }

  it('returns the existing comment on a genuine retry', async () => {
    mockPrisma.comment.findUnique.mockResolvedValue(
      { id: 'c1', taskId: 'task-1', authorId: 'user-1' } as never
    )

    expect(await findCommentByClientRequestId(args)).toMatchObject({ id: 'c1' })
  })

  it('returns null when nothing matches the id', async () => {
    mockPrisma.comment.findUnique.mockResolvedValue(null as never)

    expect(await findCommentByClientRequestId(args)).toBeNull()
  })

  it('refuses a row belonging to a DIFFERENT author', async () => {
    // clientRequestId is globally unique, so without this check a replayed or
    // guessed id would return another user's comment.
    mockPrisma.comment.findUnique.mockResolvedValue(
      { id: 'c1', taskId: 'task-1', authorId: 'someone-else' } as never
    )

    expect(await findCommentByClientRequestId(args)).toBeNull()
  })

  it('refuses a row on a different task', async () => {
    mockPrisma.comment.findUnique.mockResolvedValue(
      { id: 'c1', taskId: 'other-task', authorId: 'user-1' } as never
    )

    expect(await findCommentByClientRequestId(args)).toBeNull()
  })
})

describe('isDuplicateClientRequestId (task e0613ae5)', () => {
  it('recognises a unique-constraint violation', () => {
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    })

    expect(isDuplicateClientRequestId(err)).toBe(true)
  })

  it('does not swallow other Prisma errors', () => {
    const err = new Prisma.PrismaClientKnownRequestError('missing', {
      code: 'P2025',
      clientVersion: 'test',
    })

    expect(isDuplicateClientRequestId(err)).toBe(false)
  })

  it('does not swallow ordinary errors', () => {
    expect(isDuplicateClientRequestId(new Error('boom'))).toBe(false)
    expect(isDuplicateClientRequestId(null)).toBe(false)
  })
})
