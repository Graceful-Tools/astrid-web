/**
 * GET /api/v1/tasks/[id]/comments must not serialize an unbounded collection.
 *
 * Task a86b5bed capped the comments EMBEDDED in task responses after a runaway
 * GitHub comment-sync echo put 142k comments on one task. The list endpoint
 * was left uncapped, and on 2026-08-29 the Mac app hit it for that same task
 * (91a7e180, 136k comments / 64 MB of content by then) and got back Vercel's
 * HTML 500 — the function response is over the platform's 4.5 MB cap, so
 * `withAuth`'s JSON error path never ran:
 *
 *   [AstridAPI] request method=GET path=/api/v1/tasks/91a7e180-…/comments
 *   [AstridAPI] response status=500 bytes=2049
 *   ✗ NETWORK: HTTP 500: <!DOCTYPE html>…500: Internal Server Error…
 *
 * The cap keeps the NEWEST comments, returned in the same ascending order as
 * before, and says so in `meta` so a client can tell "all of it" from "the
 * newest slice". The iOS/Mac merge never deletes comments absent from a
 * response, so a truncated page is safe for it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockPrisma } from '../setup'
import { GET } from '@/app/api/v1/tasks/[id]/comments/route'
import { authenticateAPI, requireScopes, getDeprecationWarning } from '@/lib/api-auth-middleware'
import { TASK_COMMENTS_LIST_LIMIT } from '@/lib/task-query-utils'

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
  }
})
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/list-member-utils', () => ({ getListMemberIds: vi.fn().mockReturnValue([]) }))

const task = {
  id: 'task-1',
  creatorId: 'owner-id',
  assigneeId: null,
  lists: [{ id: 'list-1', ownerId: 'owner-id', privacy: 'PRIVATE', listMembers: [] }],
}

// Newest-first, as the capped query returns them.
const newestFirst = [
  { id: 'c-new', content: 'newer', createdAt: new Date('2026-02-02'), authorId: 'owner-id', author: null, secureFiles: [] },
  { id: 'c-old', content: 'older', createdAt: new Date('2026-01-01'), authorId: 'owner-id', author: null, secureFiles: [] },
]

async function get() {
  const response = await GET(
    new Request('http://localhost:3000/api/v1/tasks/task-1/comments'),
    { params: Promise.resolve({ id: 'task-1' }) }
  )
  return { status: response.status, body: await response.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireScopes).mockImplementation(() => {})
  vi.mocked(getDeprecationWarning).mockReturnValue(undefined)
  vi.mocked(authenticateAPI).mockResolvedValue({ userId: 'owner-id', source: 'oauth', scopes: ['comments:read'] } as never)
  mockPrisma.task.findUnique.mockResolvedValue(task as never)
})

describe('GET /api/v1/tasks/[id]/comments response cap (task 91a7e180 500)', () => {
  it('bounds the query to the newest TASK_COMMENTS_LIST_LIMIT comments', async () => {
    mockPrisma.comment.findMany.mockResolvedValue(newestFirst as never)

    await get()

    expect(mockPrisma.comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: 'task-1' },
        orderBy: { createdAt: 'desc' },
        take: TASK_COMMENTS_LIST_LIMIT,
      })
    )
  })

  it('returns them oldest-first, exactly as before the cap', async () => {
    mockPrisma.comment.findMany.mockResolvedValue(newestFirst as never)

    const { status, body } = await get()

    expect(status).toBe(200)
    expect(body.comments.map((c: { id: string }) => c.id)).toEqual(['c-old', 'c-new'])
  })

  it('reports a complete listing when the page is not full, without a count query', async () => {
    mockPrisma.comment.findMany.mockResolvedValue(newestFirst as never)

    const { body } = await get()

    expect(body.meta.total).toBe(2)
    expect(body.meta.truncated).toBe(false)
    expect(mockPrisma.comment.count).not.toHaveBeenCalled()
  })

  it('reports the true total and truncated=true when the page is full', async () => {
    // A full page means "there may be more" — only then is the count worth a query.
    const fullPage = Array.from({ length: TASK_COMMENTS_LIST_LIMIT }, (_, i) => ({
      ...newestFirst[0],
      id: `c-${i}`,
      createdAt: new Date(2026, 0, 1, 0, 0, TASK_COMMENTS_LIST_LIMIT - i),
    }))
    mockPrisma.comment.findMany.mockResolvedValue(fullPage as never)
    mockPrisma.comment.count.mockResolvedValue(136_325 as never)

    const { body } = await get()

    expect(body.comments).toHaveLength(TASK_COMMENTS_LIST_LIMIT)
    expect(body.meta.total).toBe(136_325)
    expect(body.meta.truncated).toBe(true)
    expect(mockPrisma.comment.count).toHaveBeenCalledWith({ where: { taskId: 'task-1' } })
  })

  it('keeps the cap under the platform response limit at the observed comment size', () => {
    // 2,013 comments serialized to 1,915,839 bytes on 2026-08-29 (~950 B each,
    // author + secureFiles included). Vercel fails any function response over
    // 4.5 MB. Leave headroom for larger-than-average threads.
    const observedBytesPerComment = 1_915_839 / 2_013
    expect(TASK_COMMENTS_LIST_LIMIT * observedBytesPerComment).toBeLessThan(3_000_000)
  })
})
