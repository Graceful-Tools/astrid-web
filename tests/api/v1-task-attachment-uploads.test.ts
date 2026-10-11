/**
 * Screenshots on tasks over the API, without bytes in an MCP tool argument.
 *
 * Step 1 — POST /api/v1/tasks/:id/attachment-uploads: an authenticated caller
 *   with access to the task gets a short-lived, signed upload ticket.
 * Step 2 — PUT /api/v1/attachment-uploads with that ticket: the bytes are
 *   checked, stored through the SecureFile path the apps already read, and
 *   posted as an ATTACHMENT comment — so the image shows where every other
 *   comment attachment shows.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mockPrisma } from '../setup'
import { row } from '../fixtures/prisma-rows'
import { POST as MINT } from '@/app/api/v1/tasks/[id]/attachment-uploads/route'
import { PUT as UPLOAD } from '@/app/api/v1/attachment-uploads/route'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'
import { createCommentWithSideEffects } from '@/services/comment.service'
import { uploadFileToBlob } from '@/lib/secure-storage'
import { signAttachmentUploadTicket } from '@/lib/attachment-upload-ticket'

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

vi.mock('@/services/comment.service', () => ({
  createCommentWithSideEffects: vi.fn(),
}))

vi.mock('@/lib/secure-storage', () => ({
  uploadFileToBlob: vi.fn(),
}))

const mockAuth = vi.mocked(authenticateAPI)
const mockScopes = vi.mocked(requireScopes)
const mockCreateComment = vi.mocked(createCommentWithSideEffects)
const mockUpload = vi.mocked(uploadFileToBlob)

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
])

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'Pick a context menu',
    creatorId: 'owner-1',
    assigneeId: null,
    assignee: null,
    lists: [
      {
        id: 'list-1',
        name: 'Astrid Web To-do',
        ownerId: 'owner-1',
        privacy: 'PRIVATE',
        listMembers: [],
        githubRepositoryId: null,
        aiAgentConfiguredBy: null,
      },
    ],
    ...overrides,
  }
}

function mintRequest(body: unknown, id = 'task-1') {
  const req = new NextRequest(`https://astrid.test/api/v1/tasks/${id}/attachment-uploads`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  return MINT(req, { params: Promise.resolve({ id }) })
}

function uploadRequest(ticket: string | null, bytes: Buffer = PNG) {
  const headers: Record<string, string> = { 'content-type': 'image/png' }
  if (ticket) headers['x-upload-ticket'] = ticket
  return UPLOAD(
    new NextRequest('https://astrid.test/api/v1/attachment-uploads', {
      method: 'PUT',
      body: new Uint8Array(bytes),
      headers,
    }),
  )
}

function ticketFor(overrides: Partial<Parameters<typeof signAttachmentUploadTicket>[0]> = {}) {
  return signAttachmentUploadTicket({
    userId: 'owner-1',
    authorId: 'owner-1',
    taskId: 'task-1',
    fileName: 'shot.png',
    mimeType: 'image/png',
    caption: null,
    clientRequestId: 'req-1',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXTAUTH_SECRET = 'test-secret'
  mockScopes.mockImplementation(() => {})
  mockAuth.mockResolvedValue(row({ userId: 'owner-1', source: 'oauth', scopes: ['comments:write'] }))
})

describe('POST /api/v1/tasks/:id/attachment-uploads (mint)', () => {
  it('needs comments:write — the scope MCP connections already hold', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(row(task()))
    await mintRequest({ fileName: 'shot.png' })
    expect(mockScopes).toHaveBeenCalledWith(expect.anything(), ['comments:write'])
  })

  it('returns a PUT target and ticket for a task the caller can access', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(row(task()))

    const res = await mintRequest({ fileName: 'shot.png', caption: 'Option A' })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.upload.method).toBe('PUT')
    expect(body.upload.url).toBe('https://astrid.test/api/v1/attachment-uploads')
    expect(body.upload.headers['Content-Type']).toBe('image/png')
    expect(typeof body.upload.headers['X-Upload-Ticket']).toBe('string')
    expect(body.upload.maxBytes).toBe(4 * 1024 * 1024)
    expect(Date.parse(body.upload.expiresAt)).toBeGreaterThan(Date.now())
    expect(body.mimeType).toBe('image/png')
  })

  it('404s a task the caller cannot access, and never mints', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(row(task({ creatorId: 'someone-else', lists: [] })))
    const res = await mintRequest({ fileName: 'shot.png' })
    expect(res.status).toBe(404)
  })

  it.each([
    ['a non-image', { fileName: 'notes.pdf' }],
    ['SVG, which can carry script', { fileName: 'x.svg' }],
    ['a mime that disagrees with the extension', { fileName: 'shot.png', mimeType: 'image/jpeg' }],
    ['a path instead of a name', { fileName: '../../etc/passwd.png' }],
    ['no name', {}],
    ['an oversized caption', { fileName: 'shot.png', caption: 'x'.repeat(1001) }],
  ])('400s %s', async (_label, body) => {
    mockPrisma.task.findUnique.mockResolvedValue(row(task()))
    const res = await mintRequest(body)
    expect(res.status).toBe(400)
  })

  it('400s an aiAgentId that names no agent rather than signing as the owner', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(row(task()))
    mockPrisma.user.findUnique.mockResolvedValue(null)
    const res = await mintRequest({ fileName: 'shot.png', aiAgentId: 'nobody' })
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/v1/attachment-uploads (bytes)', () => {
  beforeEach(() => {
    mockPrisma.task.findUnique.mockResolvedValue(row(task()))
    mockPrisma.secureFile.findUnique.mockResolvedValue(null)
    mockPrisma.secureFile.create.mockImplementation(async ({ data }: any) => ({ ...data }))
    mockUpload.mockResolvedValue({ blobUrl: 'https://blob/files/owner-1/f1.png', fileId: 'file-1' })
    mockCreateComment.mockResolvedValue({
      kind: 'created',
      comment: { id: 'comment-1', type: 'ATTACHMENT', secureFiles: [{ id: 'file-1' }] },
    } as any)
  })

  it('stores the screenshot and posts it as an ATTACHMENT comment on the task', async () => {
    const res = await uploadRequest(ticketFor({ caption: 'Option A vs B' }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(mockUpload).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        fileName: 'shot.png',
        fileType: 'image/png',
        fileSize: PNG.length,
        uploadContext: expect.objectContaining({ taskId: 'task-1', userId: 'owner-1' }),
      }),
    )
    expect(mockPrisma.secureFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'file-1',
        uploadedBy: 'owner-1',
        taskId: 'task-1',
        mimeType: 'image/png',
        attachTarget: 'task',
        clientRequestId: 'task-attachment:task-1:req-1',
      }),
    })
    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: 'owner-1',
        content: 'Option A vs B',
        type: 'ATTACHMENT',
        clientRequestId: 'task-attachment:task-1:req-1',
        file: { id: 'file-1', linkerUserId: 'owner-1' },
      }),
    )
    expect(body.comment.id).toBe('comment-1')
    expect(body.fileId).toBe('file-1')
  })

  it('captions an uncaptioned screenshot the way the web composer does', async () => {
    await uploadRequest(ticketFor())
    expect(mockCreateComment).toHaveBeenCalledWith(expect.objectContaining({ content: 'Attached: shot.png' }))
  })

  it('signs the comment as the agent bound into the ticket', async () => {
    await uploadRequest(ticketFor({ authorId: 'ai-agent-copilot' }))
    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: 'ai-agent-copilot', file: { id: 'file-1', linkerUserId: 'owner-1' } }),
    )
  })

  it('a replayed PUT reuses the stored file and comment instead of duplicating', async () => {
    mockPrisma.secureFile.findUnique.mockResolvedValue(
      row({ id: 'file-1', originalName: 'shot.png', fileSize: PNG.length, mimeType: 'image/png' }),
    )
    mockCreateComment.mockResolvedValue({ kind: 'existing', comment: { id: 'comment-1' } } as any)

    const res = await uploadRequest(ticketFor())

    expect(res.status).toBe(200)
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockPrisma.secureFile.create).not.toHaveBeenCalled()
  })

  it('401s without a ticket', async () => {
    expect((await uploadRequest(null)).status).toBe(401)
  })

  it('401s a tampered ticket', async () => {
    const [payload] = ticketFor().split('.')
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), taskId: 'other-task' }),
    ).toString('base64url')
    expect((await uploadRequest(`${forged}.${ticketFor().split('.')[1]}`)).status).toBe(401)
  })

  it('401s an expired ticket', async () => {
    expect((await uploadRequest(ticketFor({ expiresAt: Date.now() - 1 }))).status).toBe(401)
  })

  it('404s when access to the task was lost after the ticket was minted', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(row(task({ creatorId: 'someone-else', lists: [] })))
    expect((await uploadRequest(ticketFor())).status).toBe(404)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('400s bytes that are not the image the ticket names', async () => {
    const res = await uploadRequest(ticketFor(), Buffer.from('<html><script>alert(1)</script></html>'))
    expect(res.status).toBe(400)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('400s an empty body', async () => {
    expect((await uploadRequest(ticketFor(), Buffer.alloc(0))).status).toBe(400)
  })

  it('413s a body over the limit', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)])
    expect((await uploadRequest(ticketFor(), big)).status).toBe(413)
    expect(mockUpload).not.toHaveBeenCalled()
  })
})

describe('MCP tool → mint → PUT, end to end in-process', () => {
  it('the curl the tool hands back lands the image as an attachment comment', async () => {
    const { default: AstridMCPServerOAuth } = await import('@/mcp/mcp-server-oauth')
    mockPrisma.task.findUnique.mockResolvedValue(row(task()))
    mockPrisma.secureFile.findUnique.mockResolvedValue(null)
    mockPrisma.secureFile.create.mockImplementation(async ({ data }: any) => ({ ...data }))
    mockUpload.mockResolvedValue({ blobUrl: 'https://blob/f.png', fileId: 'file-9' })
    mockCreateComment.mockResolvedValue({ kind: 'created', comment: { id: 'comment-9' } } as any)

    // The MCP server's HTTP client, routed straight into the real mint handler.
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const res = await MINT(new NextRequest(url, init as any), { params: Promise.resolve({ id: 'task-1' }) })
      return { ok: res.ok, status: res.status, json: () => res.json() }
    }))
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_token', baseUrl: 'https://astrid.test' })
    const result = await (server as any).server._requestHandlers.get('tools/call')(
      { method: 'tools/call', params: { name: 'create_task_attachment_upload', arguments: { taskId: 'task-1', fileName: 'shot.png', caption: 'A vs B' } } },
      {},
    )
    vi.unstubAllGlobals()
    expect(result.isError).toBeUndefined()
    const { upload, curl } = JSON.parse(result.content[0].text)
    expect(curl).toContain(upload.url)

    const res = await UPLOAD(new NextRequest(upload.url, { method: 'PUT', headers: upload.headers, body: new Uint8Array(PNG) }))

    expect(res.status).toBe(201)
    expect((await res.json()).comment.id).toBe('comment-9')
    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'A vs B', type: 'ATTACHMENT', file: { id: 'file-9', linkerUserId: 'owner-1' } }),
    )
  })
})
