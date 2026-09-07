/**
 * RED for task cb1581e0 — "comments from Mac aren't always showing up on web
 * and sometimes get deleted with repeat refreshing."
 *
 * The comment merge rules lived inline in components/task-detail.tsx (1,571
 * lines) and components/task-detail/CommentSection.tsx, where they could not be
 * tested and had drifted into three separate bugs:
 *
 *  1. Every SSE handler filtered on `event.data.userId !== currentUser.id`
 *     ("the author already sees it optimistically"). That is a ONE-DEVICE
 *     assumption. Commenting on Mac and reading on web is the same user id on
 *     two devices, so the web session dropped its own events on the floor.
 *  2. The server returns comments FLAT (a `parentCommentId` on each row; the
 *     Prisma include has no `replies`), but the renderer walks `comment.replies`
 *     and does not filter parented rows out of the top level. So a reply that
 *     was optimistically nested under its parent jumped to the top of the
 *     thread on the next refresh — the "comments move/disappear when I refresh"
 *     half of the report.
 *  3. With the author back in the SSE audience, an echo can beat the POST
 *     response home, so swapping the optimistic row in by id alone leaves the
 *     server comment in the list twice.
 *
 * These are pure list transforms, so they are unit-tested here rather than
 * through a React tree.
 */

import { describe, it, expect } from 'vitest'
import {
  nestComments,
  upsertComment,
  updateComment,
  removeComment,
  settleOptimisticComment,
} from '@/lib/comment-stream'
import type { Comment } from '@/types/task'

const comment = (over: Partial<Comment> & { id: string }): Comment => ({
  content: `content-${over.id}`,
  type: 'TEXT',
  author: { id: 'u1', name: 'Jon', email: 'jon@example.com' } as never,
  authorId: 'u1',
  taskId: 'task-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
})

const at = (iso: string) => new Date(iso)

describe('nestComments (task cb1581e0)', () => {
  it('nests a flat server reply under its parent instead of leaving it top-level', () => {
    const flat = [
      comment({ id: 'c1', createdAt: at('2026-01-01T00:00:00Z') }),
      comment({ id: 'r1', parentCommentId: 'c1', createdAt: at('2026-01-01T00:01:00Z') }),
    ]

    const nested = nestComments(flat)

    expect(nested.map(c => c.id)).toEqual(['c1'])
    expect(nested[0].replies?.map(r => r.id)).toEqual(['r1'])
  })

  it('sorts top-level comments and replies oldest-first', () => {
    const flat = [
      comment({ id: 'c2', createdAt: at('2026-01-02T00:00:00Z') }),
      comment({ id: 'c1', createdAt: at('2026-01-01T00:00:00Z') }),
      comment({ id: 'r2', parentCommentId: 'c1', createdAt: at('2026-01-01T00:05:00Z') }),
      comment({ id: 'r1', parentCommentId: 'c1', createdAt: at('2026-01-01T00:02:00Z') }),
    ]

    const nested = nestComments(flat)

    expect(nested.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(nested[0].replies?.map(r => r.id)).toEqual(['r1', 'r2'])
  })

  it('is idempotent: re-nesting an already-nested list changes nothing', () => {
    const flat = [
      comment({ id: 'c1' }),
      comment({ id: 'r1', parentCommentId: 'c1', createdAt: at('2026-01-01T00:01:00Z') }),
    ]

    const once = nestComments(flat)
    const twice = nestComments(once)

    expect(twice.map(c => c.id)).toEqual(['c1'])
    expect(twice[0].replies?.map(r => r.id)).toEqual(['r1'])
  })

  it('keeps an orphan reply visible at the top level rather than dropping it', () => {
    // The parent can be missing: the 500-row response cap can cut it off, and a
    // reply that outlives a deleted parent is still someone's message. Hiding
    // it would be the data loss this task is about.
    const nested = nestComments([comment({ id: 'r1', parentCommentId: 'gone' })])

    expect(nested.map(c => c.id)).toEqual(['r1'])
  })

  it('does not mutate the input array or its comments', () => {
    const parent = comment({ id: 'c1' })
    const reply = comment({ id: 'r1', parentCommentId: 'c1' })
    const flat = [parent, reply]

    nestComments(flat)

    expect(flat).toHaveLength(2)
    expect(parent.replies).toBeUndefined()
  })
})

describe('upsertComment (task cb1581e0)', () => {
  it('adds a comment that arrived over SSE from the same user on another device', () => {
    // The Mac case. Nothing about the author is consulted — only the id.
    const existing = [comment({ id: 'c1' })]

    const merged = upsertComment(existing, comment({ id: 'mac-1', createdAt: at('2026-01-02T00:00:00Z') }))

    expect(merged.map(c => c.id)).toEqual(['c1', 'mac-1'])
  })

  it('does not duplicate a comment already in the list', () => {
    const existing = [comment({ id: 'c1' })]

    const merged = upsertComment(existing, comment({ id: 'c1', content: 'echo' }))

    expect(merged).toHaveLength(1)
  })

  it('nests an incoming reply under its parent', () => {
    const existing = nestComments([comment({ id: 'c1' })])

    const merged = upsertComment(existing, comment({ id: 'r1', parentCommentId: 'c1' }))

    expect(merged).toHaveLength(1)
    expect(merged[0].replies?.map(r => r.id)).toEqual(['r1'])
  })

  it('does not duplicate a reply that is already nested', () => {
    const existing = nestComments([
      comment({ id: 'c1' }),
      comment({ id: 'r1', parentCommentId: 'c1' }),
    ])

    const merged = upsertComment(existing, comment({ id: 'r1', parentCommentId: 'c1' }))

    expect(merged[0].replies).toHaveLength(1)
  })

  it('keeps top-level comments ordered oldest-first after an insert', () => {
    const existing = [
      comment({ id: 'c1', createdAt: at('2026-01-01T00:00:00Z') }),
      comment({ id: 'c3', createdAt: at('2026-01-03T00:00:00Z') }),
    ]

    const merged = upsertComment(existing, comment({ id: 'c2', createdAt: at('2026-01-02T00:00:00Z') }))

    expect(merged.map(c => c.id)).toEqual(['c1', 'c2', 'c3'])
  })
})

describe('updateComment (task cb1581e0)', () => {
  it('applies an edit made on another device', () => {
    const existing = [comment({ id: 'c1', content: 'before' })]

    const merged = updateComment(existing, { id: 'c1', content: 'after' } as never)

    expect(merged[0].content).toBe('after')
  })

  it('applies an edit to a nested reply', () => {
    // task-detail.tsx only ever mapped the top level, so a reply edited on
    // another device stayed stale until a full refresh.
    const existing = nestComments([
      comment({ id: 'c1' }),
      comment({ id: 'r1', parentCommentId: 'c1', content: 'before' }),
    ])

    const merged = updateComment(existing, { id: 'r1', content: 'after' } as never)

    expect(merged[0].replies?.[0].content).toBe('after')
  })

  it('leaves the list untouched when the comment is unknown', () => {
    const existing = [comment({ id: 'c1' })]

    // Same array back, not a copy: callers hold this in React state and use the
    // identity to decide whether to write.
    expect(updateComment(existing, { id: 'nope', content: 'x' } as never)).toBe(existing)
  })

  it('returns the same array when the update changes nothing', () => {
    const existing = [comment({ id: 'c1', content: 'same' })]

    expect(updateComment(existing, { id: 'c1', content: 'same' } as never)).toBe(existing)
  })
})

describe('upsertComment identity (task cb1581e0)', () => {
  it('returns the same array when the comment is already in the thread unchanged', () => {
    // A repeated SSE echo must not look like a state change, or every duplicate
    // event re-renders the thread.
    const incoming = comment({ id: 'c1' })
    const existing = [incoming]

    expect(upsertComment(existing, incoming)).toBe(existing)
  })
})

describe('removeComment (task cb1581e0)', () => {
  it('removes a top-level comment deleted on another device', () => {
    const existing = [comment({ id: 'c1' }), comment({ id: 'c2' })]

    expect(removeComment(existing, 'c1').map(c => c.id)).toEqual(['c2'])
  })

  it('returns the same array when the comment is already gone', () => {
    // The echo of a delete this client already applied must not look like a
    // state change (task cb1581e0).
    const existing = [comment({ id: 'c1' })]

    expect(removeComment(existing, 'already-gone')).toBe(existing)
  })

  it('removes a nested reply deleted on another device', () => {
    const existing = nestComments([
      comment({ id: 'c1' }),
      comment({ id: 'r1', parentCommentId: 'c1' }),
    ])

    const merged = removeComment(existing, 'r1')

    expect(merged.map(c => c.id)).toEqual(['c1'])
    expect(merged[0].replies).toEqual([])
  })
})

describe('settleOptimisticComment (task cb1581e0)', () => {
  it('swaps the optimistic row for the server comment', () => {
    const existing = [comment({ id: 'temp-1', content: 'hi' })]

    const merged = settleOptimisticComment(existing, 'temp-1', comment({ id: 'c1', content: 'hi' }))

    expect(merged.map(c => c.id)).toEqual(['c1'])
  })

  it('drops the optimistic row when the SSE echo already delivered the server comment', () => {
    // The author is now in their own SSE audience, so the echo can beat the
    // POST response home. Mapping temp -> server by id alone would leave the
    // same comment in the thread twice.
    const existing = [
      comment({ id: 'c1', content: 'hi' }),
      comment({ id: 'temp-1', content: 'hi' }),
    ]

    const merged = settleOptimisticComment(existing, 'temp-1', comment({ id: 'c1', content: 'hi' }))

    expect(merged.map(c => c.id)).toEqual(['c1'])
  })

  it('settles an optimistic reply nested under its parent', () => {
    const existing = nestComments([
      comment({ id: 'c1' }),
      comment({ id: 'temp-r1', parentCommentId: 'c1' }),
    ])

    const merged = settleOptimisticComment(
      existing,
      'temp-r1',
      comment({ id: 'r1', parentCommentId: 'c1' }),
    )

    expect(merged[0].replies?.map(r => r.id)).toEqual(['r1'])
  })
})
