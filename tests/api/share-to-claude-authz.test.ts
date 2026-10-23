/**
 * POST /api/tasks/:id/share-to-claude — authorization (AWTD-1341).
 *
 * The route copies a task's title, description, assignee/creator and recent
 * comments to an external Astrid list. The membership check lives in the
 * task query's `where` (list owner, or admin/member of a list the task is
 * on), so a caller who is not a member gets 404 and NO task data is sent —
 * the only outbound call is the OAuth token exchange, which carries none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const getUnifiedSession = vi.hoisted(() => vi.fn())
const taskFindFirst = vi.hoisted(() => vi.fn())
const postCommentAs = vi.hoisted(() => vi.fn())

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))
vi.mock('@/lib/prisma', () => ({ prisma: { task: { findFirst: taskFindFirst } } }))
vi.mock('@/services/post-comment-as', () => ({ postCommentAs }))

import { POST } from '@/app/api/tasks/[id]/share-to-claude/route'

const TASK = {
  id: 'task-1',
  title: 'Secret plan',
  description: 'CONFIDENTIAL-DESCRIPTION',
  priority: 2,
  completed: false,
  dueDateTime: null,
  assignee: null,
  creator: { name: 'Owner', email: 'owner@example.com' },
  lists: [{ id: 'list-1', name: 'L', owner: { name: 'Owner', email: 'owner@example.com' } }],
  comments: [],
}

/**
 * Evaluates the route's membership `where` against a fixture list, so the
 * test exercises the real filter shape rather than just echoing a mock.
 */
const LIST = { ownerId: 'owner-1', listMembers: [{ userId: 'member-1', role: 'member' }, { userId: 'viewer-1', role: 'viewer' }] }
function matchesMembership(where: any, list: typeof LIST): boolean {
  return where.lists.some.OR.some((clause: any) => {
    if (clause.ownerId) return clause.ownerId === list.ownerId
    const { userId, role } = clause.listMembers.some
    return list.listMembers.some(m => m.userId === userId && role.in.includes(m.role))
  })
}

const fetchMock = vi.fn()
const ctx = { params: Promise.resolve({ id: 'task-1' }) } as never
const share = () => POST(new NextRequest('http://localhost/api/tasks/task-1/share-to-claude', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ targetListId: 'remote-list' }),
}), ctx)
const signIn = (id: string) => getUnifiedSession.mockResolvedValue({ user: { id, email: `${id}@example.com` } })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ASTRID_OAUTH_CLIENT_ID = 'cid'
  process.env.ASTRID_OAUTH_CLIENT_SECRET = 'csecret'
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/api/v1/oauth/token')) return new Response(JSON.stringify({ access_token: 'at' }))
    return new Response(JSON.stringify({ task: { id: 'remote-1' } }))
  })
  taskFindFirst.mockImplementation(async ({ where }) => (where.id === 'task-1' && matchesMembership(where, LIST) ? TASK : null))
  postCommentAs.mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function outboundTaskCalls() {
  return fetchMock.mock.calls.filter(([url]) => !String(url).endsWith('/api/v1/oauth/token'))
}

describe('POST /api/tasks/:id/share-to-claude authorization (AWTD-1341)', () => {
  it('AWTD-1341: refuses a signed-out caller with 401 before any outbound call', async () => {
    getUnifiedSession.mockResolvedValue(null)
    expect((await share()).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(taskFindFirst).not.toHaveBeenCalled()
  })

  it('AWTD-1341: a non-member gets 404 and no task data leaves the server', async () => {
    signIn('stranger-1')
    const res = await share()
    expect(res.status).toBe(404)
    expect(outboundTaskCalls()).toHaveLength(0)
    for (const [, init] of fetchMock.mock.calls) {
      expect(String(init?.body ?? '')).not.toContain('CONFIDENTIAL-DESCRIPTION')
      expect(String(init?.body ?? '')).not.toContain('Secret plan')
    }
    expect(postCommentAs).not.toHaveBeenCalled()
  })

  it('AWTD-1341: a viewer (read-only role) is not allowed to export the task', async () => {
    signIn('viewer-1')
    expect((await share()).status).toBe(404)
    expect(outboundTaskCalls()).toHaveLength(0)
  })

  it('AWTD-1341: scopes the task lookup to lists the caller owns or is admin/member of', async () => {
    signIn('stranger-1')
    await share()
    const where = taskFindFirst.mock.calls[0][0].where
    expect(where.lists.some.OR).toEqual([
      { ownerId: 'stranger-1' },
      { listMembers: { some: { userId: 'stranger-1', role: { in: ['admin', 'member'] } } } },
    ])
  })

  it('AWTD-1341: a member is let through and the task is shared (control)', async () => {
    signIn('member-1')
    const res = await share()
    expect(res.status).toBe(200)
    expect(outboundTaskCalls()).toHaveLength(1)
  })
})
