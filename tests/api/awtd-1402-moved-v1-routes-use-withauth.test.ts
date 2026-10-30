/**
 * The four v1 routes AWTD-839 moved out of legacy authenticate through withAuth
 * (AWTD-1402).
 *
 * They used to authenticate inline: the chat routes called authenticateAPI and
 * checked no scope at all, and the upload routes read cookies only, so an OAuth
 * token could not reach them. Wrapped, each checks the scope its wrapped
 * sibling already uses — chat:write like chat/channels/:id/messages,
 * attachments:write like POST /api/v1/upload — and a session (scopes ['*'])
 * passes exactly as before.
 *
 * "Reaches the handler" is observed as the handler's first database read, so
 * the per-route list/channel/task checks are still the handler's to make.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { mockPrisma } from '../setup'

const authenticateAPI = vi.hoisted(() => vi.fn())
const getUnifiedSession = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth-middleware', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api-auth-middleware')>()),
  authenticateAPI,
}))
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))

import { UnauthorizedError } from '@/lib/api-auth-middleware'
import { POST as createChannel } from '@/app/api/v1/chat/channels/route'
import { POST as agentResponse } from '@/app/api/v1/chat/channels/[channelId]/agent-response/route'
import { POST as getUploadUrl } from '@/app/api/v1/secure-upload/get-upload-url/route'
import { POST as requestUpload } from '@/app/api/v1/secure-upload/request-upload/route'

const json = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

/**
 * Cast kept deliberately: a real multipart NextRequest never resolves
 * formData() under vitest (the same reason tests/api/secure-upload.test.ts
 * stubs it), and the route reads nothing else from the request.
 */
function multipart(path: string) {
  const form = new FormData()
  form.append('file', new File(['x'], 'a.png', { type: 'image/png' }))
  form.append('context', JSON.stringify({ taskId: 'task-1' }))
  return {
    formData: async () => form,
    nextUrl: new URL(`http://localhost${path}`),
    cookies: { get: () => undefined },
    headers: new Headers(),
  } as unknown as NextRequest
}

const ROUTES = [
  {
    name: 'POST /api/v1/chat/channels',
    scope: 'chat:write',
    call: () => createChannel(json('/api/v1/chat/channels', { listId: 'list-1' })),
    handlerRead: () => mockPrisma.taskList.findUnique,
  },
  {
    name: 'POST /api/v1/chat/channels/:id/agent-response',
    scope: 'chat:write',
    call: () =>
      agentResponse(json('/api/v1/chat/channels/c1/agent-response', { content: 'hi' }), {
        params: Promise.resolve({ channelId: 'c1' }),
      }),
    handlerRead: () => mockPrisma.user.findUnique,
  },
  {
    name: 'POST /api/v1/secure-upload/get-upload-url',
    scope: 'attachments:write',
    call: () =>
      getUploadUrl(
        json('/api/v1/secure-upload/get-upload-url', {
          fileName: 'a.png',
          fileType: 'image/png',
          fileSize: 1,
          context: { taskId: 'task-1' },
        }),
      ),
    handlerRead: () => mockPrisma.task.findFirst,
  },
  {
    name: 'POST /api/v1/secure-upload/request-upload',
    scope: 'attachments:write',
    call: () => requestUpload(multipart('/api/v1/secure-upload/request-upload')),
    handlerRead: () => mockPrisma.task.findFirst,
  },
]

const oauth = (scopes: string[]) =>
  authenticateAPI.mockResolvedValue({ userId: 'user-1', source: 'oauth', scopes, clientId: 'client-1' })

beforeEach(() => {
  vi.clearAllMocks()
  // The inline cookie path the upload routes used to take finds nothing, so
  // only the wrapper's authenticateAPI can admit a caller.
  getUnifiedSession.mockResolvedValue(null)
  mockPrisma.session.findUnique.mockResolvedValue(null)
  mockPrisma.taskList.findUnique.mockResolvedValue(null)
  mockPrisma.user.findUnique.mockResolvedValue(null)
  mockPrisma.task.findFirst.mockResolvedValue(null)
})

describe.each(ROUTES)('AWTD-1402: $name authenticates through withAuth', route => {
  it('AWTD-1402: answers 401 to an unauthenticated caller', async () => {
    authenticateAPI.mockRejectedValue(new UnauthorizedError('no credentials'))
    expect((await route.call()).status).toBe(401)
    expect(route.handlerRead()).not.toHaveBeenCalled()
  })

  it(`AWTD-1402: refuses an OAuth token without the required scope with 403`, async () => {
    oauth(['tasks:read'])
    expect((await route.call()).status).toBe(403)
    expect(route.handlerRead()).not.toHaveBeenCalled()
  })

  it(`AWTD-1402: admits an OAuth token carrying the required scope`, async () => {
    oauth([route.scope])
    // Not "status is not 403": past the wrapper, the handler's own checks
    // (list access, on-device model) still refuse these empty fixtures.
    expect((await route.call()).status).not.toBe(401)
    expect(route.handlerRead()).toHaveBeenCalled()
  })

  it('AWTD-1402: admits a session caller (scopes *) as before', async () => {
    authenticateAPI.mockResolvedValue({ userId: 'user-1', source: 'session', scopes: ['*'] })
    getUnifiedSession.mockResolvedValue({ user: { id: 'user-1' } })
    const res = await route.call()
    expect(res.status).not.toBe(401)
    expect(route.handlerRead()).toHaveBeenCalled()
  })
})
