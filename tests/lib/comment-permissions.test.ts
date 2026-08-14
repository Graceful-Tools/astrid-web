/**
 * Task e0613ae5 — comment edit/delete permissions and the notification
 * audience, shared by /api/comments/:id and /api/v1/comments/:id.
 *
 * The delete rule is four conditions ORed together, which is the kind of
 * expression that loses a clause in a rewrite without anyone noticing, so each
 * clause gets its own test.
 */

import { describe, it, expect } from 'vitest'
import {
  canEditComment,
  canDeleteComment,
  commentAudience,
  type CommentTaskContext,
} from '@/lib/comment-permissions'

const AUTHOR = 'author-1'
const OTHER = 'other-9'

function task(overrides: Partial<CommentTaskContext> = {}): CommentTaskContext {
  return {
    creatorId: 'creator-2',
    assigneeId: 'assignee-3',
    lists: [{ ownerId: 'owner-4', listMembers: [{ userId: 'member-5' }] }],
    ...overrides,
  }
}

describe('canEditComment (task e0613ae5)', () => {
  it('allows the author', () => {
    expect(canEditComment(AUTHOR, AUTHOR)).toBe(true)
  })

  it('refuses everyone else, including people who could DELETE it', () => {
    // Editing is deliberately narrower than deleting: a list admin may remove a
    // comment they object to, but nobody may put words in someone else's mouth.
    expect(canEditComment(AUTHOR, 'creator-2')).toBe(false)
    expect(canEditComment(AUTHOR, 'owner-4')).toBe(false)
    expect(canEditComment(AUTHOR, OTHER)).toBe(false)
  })
})

describe('canDeleteComment (task e0613ae5)', () => {
  it('allows the comment author', () => {
    expect(canDeleteComment(AUTHOR, task(), AUTHOR)).toBe(true)
  })

  it('allows the task creator', () => {
    expect(canDeleteComment(AUTHOR, task(), 'creator-2')).toBe(true)
  })

  it('allows the task assignee', () => {
    expect(canDeleteComment(AUTHOR, task(), 'assignee-3')).toBe(true)
  })

  it('allows a list owner', () => {
    expect(canDeleteComment(AUTHOR, task(), 'owner-4')).toBe(true)
  })

  it('refuses a plain list member who is none of the above', () => {
    // Membership lets you read and comment; it does not make you a moderator.
    expect(canDeleteComment(AUTHOR, task(), 'member-5')).toBe(false)
  })

  it('refuses an unrelated user', () => {
    expect(canDeleteComment(AUTHOR, task(), OTHER)).toBe(false)
  })

  it('checks every list the task is on, not just the first', () => {
    const multiList = task({
      creatorId: 'creator-2',
      lists: [
        { ownerId: 'someone-else', listMembers: [] },
        { ownerId: 'owner-of-second', listMembers: [] },
      ],
    })

    expect(canDeleteComment(AUTHOR, multiList, 'owner-of-second')).toBe(true)
  })

  it('handles a task on no lists at all', () => {
    const listless = task({ lists: [] })

    expect(canDeleteComment(AUTHOR, listless, AUTHOR)).toBe(true)
    expect(canDeleteComment(AUTHOR, listless, OTHER)).toBe(false)
  })
})

describe('commentAudience (task e0613ae5)', () => {
  it('gathers the creator, assignee, list owners and list members', () => {
    expect([...commentAudience(task())].sort())
      .toEqual(['assignee-3', 'creator-2', 'member-5', 'owner-4'])
  })

  it('returns the full set INCLUDING the actor', () => {
    // Deliberate. comment_updated keeps the editor in and lets the client
    // filter on data.userId; comment_deleted drops the actor server-side.
    // Deciding that here would make one of the two verbs wrong.
    const audience = commentAudience(task({ creatorId: AUTHOR }))

    expect(audience.has(AUTHOR)).toBe(true)
  })

  it('deduplicates someone who holds several roles', () => {
    const sameUser = task({
      creatorId: 'u1',
      assigneeId: 'u1',
      lists: [{ ownerId: 'u1', listMembers: [{ userId: 'u1' }] }],
    })

    expect([...commentAudience(sameUser)]).toEqual(['u1'])
  })

  it('tolerates a null creator, null assignee and missing members', () => {
    const sparse: CommentTaskContext = {
      creatorId: null,
      assigneeId: null,
      lists: [{ ownerId: null, listMembers: null }],
    }

    expect(commentAudience(sparse).size).toBe(0)
  })
})

describe('system-authored comments (task e0613ae5)', () => {
  // State-change comments are written with authorId null (see the `type`
  // discriminator in the schema). Nobody is their author, so the author clause
  // must never match — and the remaining clauses must still apply.
  it('has no editor', () => {
    expect(canEditComment(null, AUTHOR)).toBe(false)
    expect(canEditComment(null, 'creator-2')).toBe(false)
  })

  it('is still deletable by the task creator or a list admin', () => {
    expect(canDeleteComment(null, task(), 'creator-2')).toBe(true)
    expect(canDeleteComment(null, task(), 'owner-4')).toBe(true)
  })

  it('is not deletable by an unrelated user', () => {
    expect(canDeleteComment(null, task(), OTHER)).toBe(false)
  })
})
