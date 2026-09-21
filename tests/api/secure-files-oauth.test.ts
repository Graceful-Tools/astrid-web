/**
 * An agent must be able to read a task's attachments (AWTD-982).
 *
 * `docs/FIXALL_WORKFLOW.md` → *Per task* step 3 tells every agent to read the
 * task's comments AND attachments, because "a screenshot attached to the task
 * is usually the fastest route to the real cause". That instruction could not
 * be followed for any task at all: `app/api/secure-files/[fileId]/route.ts` —
 * which `/api/v1/secure-files/[fileId]` re-exports — authenticated by looking
 * for a NextAuth JWT and then a `next-auth.session-token` cookie row, and
 * never at `X-OAuth-Token`. It was the one `/api/v1/*` surface that was
 * session-only, and an OAuth client has no cookie and cannot get one:
 * client-credentials issues a token, not a session.
 *
 * The failure was silent in the useful direction. Task JSON lists `secureFiles`
 * with ids and sizes, so an agent sees that the evidence exists, asks for it,
 * and is told `401 {"error":"Unauthorized"}` — which reads as a bad credential
 * rather than as an unsupported scheme. Reproduced against production on
 * 2026-09-21: the token exchange returned 200 and the file fetch 401.
 *
 * The middleware is deliberately NOT mocked here. The bug was in which header
 * gets looked at, so a test that stubs out header parsing would have passed
 * against the broken route. Only `validateAccessToken` is stubbed, so the real
 * `X-OAuth-Token` extraction runs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { mockPrisma } from '@/tests/setup'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth-config', () => ({ authConfig: {} }))
vi.mock('@/lib/oauth/oauth-token-manager', () => ({ validateAccessToken: vi.fn() }))
vi.mock('@/lib/ai/ensure-agent-user', () => ({ ensureAgentUser: vi.fn() }))
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: vi.fn() }))
vi.mock('@/lib/secure-storage', () => ({
  generateSignedDownloadUrl: vi.fn(),
  uploadFileToBlob: vi.fn(),
  deleteFile: vi.fn(),
}))

import { getServerSession } from 'next-auth'
import { validateAccessToken } from '@/lib/oauth/oauth-token-manager'
import { ensureAgentUser } from '@/lib/ai/ensure-agent-user'
import { getUnifiedSession } from '@/lib/session-utils'
import { generateSignedDownloadUrl } from '@/lib/secure-storage'
import { GET } from '@/app/api/v1/secure-files/[fileId]/route'

const TOKEN = 'astrid_at_awtd982'
const FILE_ID = '2f4c5de7-fe36-4ad1-8f48-f9d3e1efd493'
const OWNER = { id: 'user-jon', email: 'jon@example.com', name: 'Jon', isAIAgent: false }

/**
 * The file the repro asked for: a screenshot on a task, on a list the token's
 * user owns. Not uploaded by them, so access has to come from list membership
 * rather than from the `uploadedBy` shortcut.
 */
function attachmentOnOwnedTask() {
  return {
    id: FILE_ID,
    uploadedBy: 'someone-else',
    blobUrl: 'https://blob.example/screenshot.png',
    originalName: 'screenshot.png',
    mimeType: 'image/png',
    fileSize: 1234,
    taskId: 'task-981',
    listId: null,
    commentId: null,
    chatMessageId: null,
    task: {
      id: 'task-981',
      assigneeId: null,
      creatorId: 'someone-else',
      lists: [
        {
          id: 'list-web',
          privacy: 'PRIVATE',
          ownerId: OWNER.id,
          owner: { id: OWNER.id },
          listMembers: [],
        },
      ],
    },
    list: null,
    comment: null,
    chatMessage: null,
  }
}

function request(headers: Record<string, string>) {
  return new NextRequest(`http://localhost:3000/api/v1/secure-files/${FILE_ID}`, {
    headers,
  }) as never
}

const context = { params: Promise.resolve({ fileId: FILE_ID }) } as never

function grantToken(scopes: string[]) {
  vi.mocked(validateAccessToken).mockResolvedValue({
    userId: OWNER.id,
    clientId: 'client-fixall',
    scopes,
    user: OWNER,
    agentUser: null,
  } as never)
}

beforeEach(() => {
  vi.mocked(getServerSession).mockReset().mockResolvedValue(null)
  vi.mocked(validateAccessToken).mockReset().mockResolvedValue(null)
  vi.mocked(ensureAgentUser).mockReset().mockResolvedValue(null)
  vi.mocked(getUnifiedSession).mockReset().mockResolvedValue(null)
  vi.mocked(generateSignedDownloadUrl)
    .mockReset()
    .mockResolvedValue('https://blob.example/screenshot.png?signed=1')
  mockPrisma.session.findUnique.mockReset().mockResolvedValue(null)
  mockPrisma.mCPToken.findFirst.mockReset().mockResolvedValue(null)
  mockPrisma.secureFile.findUnique.mockReset().mockResolvedValue(attachmentOnOwnedTask())
})

describe('GET /api/v1/secure-files/[fileId] with an OAuth token (AWTD-982)', () => {
  it('serves the file to a token carrying attachments:read', async () => {
    grantToken(['attachments:read'])

    const res = await GET(request({ 'X-OAuth-Token': TOKEN }), context)

    // The reported bug: this was 401 for every OAuth client, so an agent could
    // see that a screenshot existed and never open it.
    expect(res.status).not.toBe(401)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://blob.example/screenshot.png?signed=1')
    expect(vi.mocked(validateAccessToken)).toHaveBeenCalledWith(TOKEN)
  })

  it('accepts the token as an Authorization: Bearer header too', async () => {
    grantToken(['*'])

    const res = await GET(request({ Authorization: `Bearer ${TOKEN}` }), context)

    expect(res.status).toBe(307)
  })

  it('refuses a token without attachments:read, and says Forbidden rather than Unauthorized', async () => {
    // Attachments are user photos. A token scoped to tasks alone must not
    // reach them just because it authenticates — and 403 tells the caller the
    // credential was fine and the grant was not, which 401 does not.
    grantToken(['tasks:read', 'comments:read'])

    const res = await GET(request({ 'X-OAuth-Token': TOKEN }), context)

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
  })

  it('still refuses a file the token user cannot see', async () => {
    grantToken(['attachments:read'])
    const file = attachmentOnOwnedTask()
    file.task.lists[0].ownerId = 'a-stranger'
    file.task.lists[0].owner = { id: 'a-stranger' }
    mockPrisma.secureFile.findUnique.mockResolvedValue(file)

    const res = await GET(request({ 'X-OAuth-Token': TOKEN }), context)

    expect(res.status).toBe(403)
  })

  it('rejects an invalid token instead of falling through to the cookie path', async () => {
    vi.mocked(validateAccessToken).mockResolvedValue(null)

    const res = await GET(request({ 'X-OAuth-Token': TOKEN }), context)

    expect(res.status).toBe(401)
  })

  it('leaves the browser session path alone — no scope gate on a cookie request', async () => {
    // The web app authenticates with a cookie and has no scopes at all. Adding
    // the scope check must not lock it out of its own attachments.
    vi.mocked(getUnifiedSession).mockResolvedValue({ user: { id: OWNER.id } } as never)

    const res = await GET(request({}), context)

    expect(res.status).toBe(307)
    expect(vi.mocked(validateAccessToken)).not.toHaveBeenCalled()
  })
})
