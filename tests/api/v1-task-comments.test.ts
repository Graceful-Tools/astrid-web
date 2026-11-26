/**
 * GET/POST /api/v1/tasks/[id]/comments — every behaviour of this route in one file.
 *
 * Merged from three per-bug files (ADEV-300): public access, standard access,
 * validation and agent authorship, and the list cap. Add new behaviour as a new
 * `describe` here, with the task id in the name, rather than a new file.
 * (The comment cap on task responses, a86b5bed, tests `/api/v1/tasks/[id]`, not
 * this route, and lives in tests/api/v1-task-update.test.ts.)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockPrisma } from '../setup'
import { GET, POST } from '@/app/api/v1/tasks/[id]/comments/route'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds } from '@/lib/list-member-utils'
import { BRAND } from '@/lib/brand/config'
import { TASK_COMMENTS_LIST_LIMIT } from '@/lib/task-query-utils'
import {
  callRoute,
  ensurePrismaModels,
  listRow,
  resetRouteHarness,
  seedTask,
  signIn,
  signOut,
  taskOnList,
} from '../utils/route-harness'

vi.mock('@/lib/api-auth-middleware', async () =>
  (await import('../utils/route-harness')).authMiddlewareMock()
)
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/list-member-utils', () => ({ getListMemberIds: vi.fn(() => []) }))

const prisma = mockPrisma as any

const commentsPath = (id: string) => `/api/v1/tasks/${id}/comments`
const getComments = (id = 'task-1') => callRoute(GET as never, { path: commentsPath(id), id })
const postComment = (body: unknown, id = 'task-1') =>
  callRoute(POST as never, { path: commentsPath(id), id, method: 'POST', body })

const authorSelect = { id: true, name: true, email: true, image: true, isAIAgent: true }
const secureFilesSelect = {
  select: { id: true, originalName: true, mimeType: true, fileSize: true, createdAt: true },
}

const createComment = () => ({
  id: 'comment-1',
  content: 'First!',
  type: 'TEXT',
  authorId: 'owner-id',
  taskId: 'task-id',
  createdAt: new Date(),
  updatedAt: new Date(),
  parentCommentId: null,
  author: { id: 'owner-id', name: 'Owner', email: 'owner@example.com', image: null },
  secureFiles: [],
})

beforeEach(() => {
  resetRouteHarness()
  vi.mocked(getListMemberIds).mockReturnValue(['owner-id'] as never)
  // `task-1` is identifier-shaped (TASK-1), so a miss also asks whether TASK is a
  // renamed key (AWTD-1024); the global Prisma mock has no such model.
  ensurePrismaModels({ projectKeyAlias: ['findUnique'] })
})

describe('public access', () => {
  const publicList = listRow({ id: 'list-public', privacy: 'PUBLIC', publicListType: 'copy_only' })

  it('allows viewing comments on public lists without membership', async () => {
    signIn({ userId: 'viewer-id', scopes: ['comments:read'] })
    seedTask({ id: 'task-public', lists: [publicList] })
    prisma.comment.findMany.mockResolvedValue([createComment()])

    const { status, body } = await getComments('task-public')

    expect(status).toBe(200)
    expect(body.comments).toHaveLength(1)
    expect(prisma.comment.findMany).toHaveBeenCalledWith({
      where: { taskId: 'task-public' },
      include: { author: { select: authorSelect }, secureFiles: secureFilesSelect },
      orderBy: { createdAt: 'desc' },
      take: 2500,
    })
  })

  it('allows collaborative public list viewers to add comments', async () => {
    signIn({ userId: 'viewer-id', scopes: ['comments:write'] })
    seedTask({
      id: 'task-collab',
      lists: [listRow({ id: 'list-collab', privacy: 'PUBLIC', publicListType: 'collaborative' })],
    })
    prisma.comment.create.mockResolvedValue({
      ...createComment(),
      id: 'comment-new',
      content: 'Excited to help!',
      authorId: 'viewer-id',
      author: { id: 'viewer-id', name: 'Viewer', email: 'viewer@example.com', image: null },
    })
    prisma.secureFile.update.mockResolvedValue(undefined)

    const { status, body } = await postComment({ content: 'Excited to help!' }, 'task-collab')

    expect(status).toBe(201)
    expect(body.comment.content).toBe('Excited to help!')
    expect(prisma.comment.create).toHaveBeenCalledWith({
      data: {
        content: 'Excited to help!',
        type: 'TEXT',
        authorId: 'viewer-id',
        taskId: 'task-collab',
        parentCommentId: null,
        clientRequestId: null,
      },
      include: { author: { select: authorSelect }, secureFiles: secureFilesSelect },
    })
    expect(vi.mocked(broadcastToUsers)).toHaveBeenCalled()
  })

  it('returns existing comment when clientRequestId matches a prior submit (offline retry)', async () => {
    signIn({ userId: 'author-id', scopes: ['comments:write'] })
    prisma.comment.findUnique.mockResolvedValue({
      ...createComment(),
      id: 'comment-existing',
      content: 'bam',
      authorId: 'author-id',
      taskId: 'task-id',
      clientRequestId: 'client-req-12345678',
    })
    // The idempotency lookup happens AFTER the access check, so the task is still needed.
    seedTask({
      id: 'task-id',
      creatorId: 'author-id',
      lists: [listRow({ id: 'list-id', privacy: 'PUBLIC', publicListType: 'collaborative' })],
    })

    const { status, body } = await postComment(
      { content: 'bam', clientRequestId: 'client-req-12345678' },
      'task-id'
    )

    expect(status).toBe(200)
    expect(body.meta.idempotent).toBe(true)
    expect(body.comment.id).toBe('comment-existing')
    expect(prisma.comment.create).not.toHaveBeenCalled()
  })

  it('rejects copy-only public list comments from non-members', async () => {
    signIn({ userId: 'viewer-id', scopes: ['comments:write'] })
    seedTask({ id: 'task-copy', lists: [publicList] })

    const { status, body } = await postComment({ content: 'Let me contribute' }, 'task-copy')

    expect(status).toBe(404)
    expect(body.error).toBe('Task not found or access denied')
    expect(prisma.comment.create).not.toHaveBeenCalled()
  })
})

describe('authentication', () => {
  it('returns 401 when no one is signed in', async () => {
    signOut()
    const { status } = await getComments()
    expect(status).toBe(401)
    expect(prisma.comment.findMany).not.toHaveBeenCalled()
  })
})

describe('GET standard access', () => {
  const foreignTask = taskOnList({ creatorId: 'someone-else', list: { ownerId: 'someone-else' } })

  beforeEach(() => {
    signIn({ userId: 'user-1', scopes: ['comments:read', 'comments:write'] })
  })

  it('returns 404 when task does not exist', async () => {
    prisma.task.findUnique.mockResolvedValue(null)
    expect((await getComments()).status).toBe(404)
  })

  it('returns 404 when caller is not on the task and it is not public', async () => {
    prisma.task.findUnique.mockResolvedValue(foreignTask)
    expect((await getComments()).status).toBe(404)
  })

  it('returns comments when caller is the task creator', async () => {
    seedTask({ creatorId: 'user-1', list: { ownerId: 'user-1' } })
    prisma.comment.findMany.mockResolvedValue([
      { id: 'c-1', content: 'hi', author: { id: 'user-1' }, secureFiles: [] },
    ])

    const { status, body } = await getComments()

    expect(status).toBe(200)
    expect(body.comments).toHaveLength(1)
    expect(body.meta).toMatchObject({ total: 1, taskId: 'task-1' })
  })
})

describe('POST validation', () => {
  beforeEach(() => {
    signIn({ userId: 'user-1', scopes: ['comments:read', 'comments:write'] })
  })

  it('returns 400 when content is not a string', async () => {
    expect((await postComment({ content: 42 })).status).toBe(400)
  })

  it('returns 400 when content is empty and no fileId', async () => {
    expect((await postComment({ content: '   ' })).status).toBe(400)
  })
})

describe('POST standard access', () => {
  beforeEach(() => {
    signIn({ userId: 'user-1', scopes: ['comments:read', 'comments:write'] })
  })

  it('returns 404 when task does not exist', async () => {
    prisma.task.findUnique.mockResolvedValue(null)
    expect((await postComment({ content: 'hi' })).status).toBe(404)
  })

  it('returns 404 when caller has no access and task is not collaborative-public', async () => {
    seedTask({ creatorId: 'someone-else', list: { ownerId: 'someone-else' } })
    expect((await postComment({ content: 'hi' })).status).toBe(404)
  })

  it('creates a comment when caller is the task creator', async () => {
    seedTask({ creatorId: 'user-1', list: { ownerId: 'user-1' } })
    prisma.comment.create.mockResolvedValue({
      id: 'c-1',
      content: 'hello',
      authorId: 'user-1',
      createdAt: new Date(),
      author: { id: 'user-1', isAIAgent: false },
      secureFiles: [],
    })
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1', name: 'Jon', email: 'jon@example.com', isAIAgent: false,
    })

    const { status, body } = await postComment({ content: 'hello' })

    expect(status).toBe(201)
    expect(body.comment.id).toBe('c-1')
  })
})

describe('POST agent-bound authentication', () => {
  const copilot = {
    id: 'copilot-agent',
    email: `copilot@${BRAND.agentEmailDomain}`,
    name: 'GitHub Copilot Agent',
    isAIAgent: true,
  }
  const signInAsBoundAgent = () =>
    signIn({
      userId: 'user-1',
      source: 'legacy_mcp',
      scopes: ['comments:read', 'comments:write'],
      extra: { agentUser: copilot },
    })
  const agentComment = (authorId: string, author: object) => ({
    id: 'c-1',
    content: 'as agent',
    authorId,
    createdAt: new Date(),
    author,
    secureFiles: [],
  })

  beforeEach(() => {
    seedTask({ creatorId: 'user-1', list: { ownerId: 'user-1' } })
  })

  it('AWTD-1383 accepts the bound MCP agent when its identity is explicitly supplied', async () => {
    signInAsBoundAgent()
    prisma.comment.create.mockResolvedValue(agentComment(copilot.id, copilot))

    const { status } = await postComment({ content: 'as agent', aiAgentId: copilot.id })

    expect(status).toBe(201)
    expect(prisma.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ authorId: copilot.id }) })
    )
  })

  it('AWTD-1383 refuses a different identity on an agent-bound MCP token', async () => {
    signInAsBoundAgent()

    const { status, body } = await postComment({ content: 'as agent', aiAgentId: 'different-agent' })

    expect(status).toBe(400)
    expect(body).toMatchObject({ error: 'aiAgentId does not match the agent-bound credential' })
    expect(prisma.comment.create).not.toHaveBeenCalled()
  })

  it('regression for d9e4aae0 derives the author from the authenticated MCP token', async () => {
    signInAsBoundAgent()
    prisma.comment.create.mockResolvedValue(
      agentComment('copilot-agent', { id: 'copilot-agent', isAIAgent: true })
    )

    const { status } = await postComment({ content: 'as agent' })

    expect(status).toBe(201)
    expect(prisma.comment.create.mock.calls[0][0].data.authorId).toBe('copilot-agent')
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'copilot-agent' },
      select: { id: true, name: true, email: true, isAIAgent: true },
    })
  })

  it('regression for d9e4aae0 rejects caller-selected agent impersonation', async () => {
    signIn({ userId: 'user-1', source: 'legacy_mcp', scopes: ['comments:read', 'comments:write'] })

    const { status } = await postComment({ content: 'as agent', aiAgentId: 'copilot-agent' })

    expect(status).toBe(400)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(prisma.comment.create).not.toHaveBeenCalled()
  })

  describe('OAuth aiAgentId compatibility', () => {
    beforeEach(() => {
      signIn({ userId: 'user-1', scopes: ['comments:read', 'comments:write'] })
    })

    it('returns 400 when aiAgentId user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      expect((await postComment({ content: 'as agent', aiAgentId: 'agent-x' })).status).toBe(400)
    })

    it(`returns 400 when aiAgentId user is not an AI agent and not @${BRAND.domain}`, async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'human-1', isAIAgent: false, email: 'someone@gmail.com',
      })
      expect((await postComment({ content: 'as agent', aiAgentId: 'human-1' })).status).toBe(400)
    })

    it(`accepts a system @${BRAND.domain} agent even if isAIAgent is false`, async () => {
      prisma.user.findUnique.mockImplementation((args: any) =>
        Promise.resolve(
          args.where.id === 'system-agent'
            ? { id: 'system-agent', isAIAgent: false, email: `claude@${BRAND.agentEmailDomain}` }
            : { id: 'user-1', name: 'Jon', email: 'jon@example.com', isAIAgent: false }
        )
      )
      prisma.comment.create.mockResolvedValue(
        agentComment('system-agent', { id: 'system-agent', isAIAgent: false })
      )

      const { status } = await postComment({ content: 'as agent', aiAgentId: 'system-agent' })

      expect(status).toBe(201)
      expect(prisma.comment.create.mock.calls[0][0].data.authorId).toBe('system-agent')
    })
  })
})

/**
 * GET must not serialize an unbounded collection (task 91a7e180).
 *
 * Task a86b5bed capped the comments EMBEDDED in task responses after a runaway
 * GitHub comment-sync echo put 142k comments on one task. The list endpoint was
 * left uncapped, and on 2026-08-29 the Mac app hit it for that same task
 * (136k comments / 64 MB of content by then) and got back Vercel's HTML 500: the
 * function response is over the platform's 4.5 MB cap, so `withAuth`'s JSON error
 * path never ran.
 *
 * The cap keeps the NEWEST comments, returned oldest-first as before, and says
 * so in `meta` so a client can tell "all of it" from "the newest slice". The
 * iOS/Mac merge never deletes comments absent from a response, so a truncated
 * page is safe for it.
 */
describe('GET list cap (task 91a7e180 500)', () => {
  // Newest-first, as the capped query returns them.
  const newestFirst = [
    { id: 'c-new', content: 'newer', createdAt: new Date('2026-02-02'), authorId: 'owner-id', author: null, secureFiles: [] },
    { id: 'c-old', content: 'older', createdAt: new Date('2026-01-01'), authorId: 'owner-id', author: null, secureFiles: [] },
  ]

  beforeEach(() => {
    signIn({ userId: 'owner-id', scopes: ['comments:read'] })
    seedTask({ creatorId: 'owner-id', list: { ownerId: 'owner-id' } })
  })

  it('bounds the query to the newest TASK_COMMENTS_LIST_LIMIT comments', async () => {
    prisma.comment.findMany.mockResolvedValue(newestFirst)

    await getComments()

    expect(prisma.comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: 'task-1' },
        orderBy: { createdAt: 'desc' },
        take: TASK_COMMENTS_LIST_LIMIT,
      })
    )
  })

  it('returns them oldest-first, exactly as before the cap', async () => {
    prisma.comment.findMany.mockResolvedValue(newestFirst)

    const { status, body } = await getComments()

    expect(status).toBe(200)
    expect(body.comments.map((c: { id: string }) => c.id)).toEqual(['c-old', 'c-new'])
  })

  it('reports a complete listing when the page is not full, without a count query', async () => {
    prisma.comment.findMany.mockResolvedValue(newestFirst)

    const { body } = await getComments()

    expect(body.meta.total).toBe(2)
    expect(body.meta.truncated).toBe(false)
    expect(prisma.comment.count).not.toHaveBeenCalled()
  })

  it('reports the true total and truncated=true when the page is full', async () => {
    // A full page means "there may be more" — only then is the count worth a query.
    const fullPage = Array.from({ length: TASK_COMMENTS_LIST_LIMIT }, (_, i) => ({
      ...newestFirst[0],
      id: `c-${i}`,
      createdAt: new Date(2026, 0, 1, 0, 0, TASK_COMMENTS_LIST_LIMIT - i),
    }))
    prisma.comment.findMany.mockResolvedValue(fullPage)
    prisma.comment.count.mockResolvedValue(136_325)

    const { body } = await getComments()

    expect(body.comments).toHaveLength(TASK_COMMENTS_LIST_LIMIT)
    expect(body.meta.total).toBe(136_325)
    expect(body.meta.truncated).toBe(true)
    expect(prisma.comment.count).toHaveBeenCalledWith({ where: { taskId: 'task-1' } })
  })

  it('keeps the cap under the platform response limit at the observed comment size', () => {
    // 2,013 comments serialized to 1,915,839 bytes on 2026-08-29 (~950 B each,
    // author + secureFiles included). Vercel fails any function response over
    // 4.5 MB. Leave headroom for larger-than-average threads.
    const observedBytesPerComment = 1_915_839 / 2_013
    expect(TASK_COMMENTS_LIST_LIMIT * observedBytesPerComment).toBeLessThan(3_000_000)
  })
})
