/**
 * AWTD-1368: both direct-upload routes serve a presigned request once the
 * Blob store can verify its callbacks, and stop depending on
 * BLOB_READ_WRITE_TOKEN — the credential the OIDC upgrade removes.
 *
 * Contract (astrid-ios AITD-558, docs/API_CONTRACT.md → Uploads):
 *   get-upload-url → { fileId, pathname, presigned: { uploadUrl, headers } }
 *
 * AWTD-1386: the Blob store is on OIDC, so the legacy client token
 * (`uploadToken` + `uploadUrl`) is gone. iOS/Mac builds before 1253/1254 lose
 * new uploads, which Jon accepted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateAPI = vi.hoisted(() => vi.fn())
const getUnifiedSession = vi.hoisted(() => vi.fn())
const taskFindFirst = vi.hoisted(() => vi.fn())
const fileFindUnique = vi.hoisted(() => vi.fn())
const issuePresignedUpload = vi.hoisted(() => vi.fn())
const presignedUploadsEnabled = vi.hoisted(() => vi.fn())

// get-upload-url authenticates through withAuth (AWTD-1402); the secure-files
// edit route still reads the session itself.
vi.mock('@/lib/api-auth-middleware', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api-auth-middleware')>()),
  authenticateAPI,
}))
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findFirst: taskFindFirst },
    secureFile: { findUnique: fileFindUnique },
    session: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}))
vi.mock('@/lib/secure-file-idempotency', () => ({
  findSecureFileByClientRequestId: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/secure-storage', () => ({
  issuePresignedUpload,
  presignedUploadsEnabled,
}))

import { POST as getUploadUrl } from '@/app/api/v1/secure-upload/get-upload-url/route'
import { POST as editUploadUrl } from '@/app/api/secure-files/[fileId]/upload-url/route'

const PRESIGNED = {
  uploadUrl: 'https://vercel.com/api/blob/?pathname=p&vercel-blob-signature=s',
  headers: { 'x-api-version': '12', 'x-vercel-blob-store-id': 'abc', 'x-vercel-blob-access': 'public' },
}

const saved = { ...process.env }

function post(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const newUpload = () =>
  getUploadUrl(
    post('http://localhost/api/secure-upload/get-upload-url', {
      fileName: 'report.pdf',
      fileType: 'application/pdf',
      fileSize: 100,
      context: { taskId: 'task-1' },
    }),
  )

const editUpload = () =>
  editUploadUrl(
    post('http://localhost/api/secure-files/file-1/upload-url', { mimeType: 'application/pdf', fileSize: 100 }),
    { params: Promise.resolve({ fileId: 'file-1' }) } as never,
  )

beforeEach(() => {
  vi.clearAllMocks()
  authenticateAPI.mockResolvedValue({ userId: 'owner-1', source: 'session', scopes: ['*'] })
  getUnifiedSession.mockResolvedValue({ user: { id: 'owner-1' } })
  taskFindFirst.mockResolvedValue({ id: 'task-1' })
  fileFindUnique.mockResolvedValue({
    id: 'file-1',
    uploadedBy: 'owner-1',
    originalName: 'report.pdf',
    blobUrl: 'https://blob.example/files/owner-1/file-1-1.pdf',
  })
  issuePresignedUpload.mockResolvedValue(PRESIGNED)
  process.env.BLOB_READ_WRITE_TOKEN = 'rw-token'
  presignedUploadsEnabled.mockReturnValue(false)
})

afterEach(() => {
  process.env = { ...saved }
})

describe('POST /api/secure-upload/get-upload-url (AWTD-1368, AWTD-1386)', () => {
  it('AWTD-1386: serves presigned only, with no legacy token, even while the read/write token exists', async () => {
    presignedUploadsEnabled.mockReturnValue(true)
    const res = await newUpload()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.presigned).toEqual(PRESIGNED)
    expect(body).not.toHaveProperty('uploadToken')
    expect(body).not.toHaveProperty('uploadUrl')
  })

  it('AWTD-1368: signs the completion callback and payload into the presigned request', async () => {
    presignedUploadsEnabled.mockReturnValue(true)
    const body = await (await newUpload()).json()
    const presigned = issuePresignedUpload.mock.calls[0][0]
    expect(presigned).toMatchObject({
      pathname: body.pathname,
      contentType: 'application/pdf',
      onUploadCompleted: { callbackUrl: expect.stringMatching(/\/api\/secure-upload\/upload-complete$/) },
    })
    expect(presigned.maximumSizeInBytes).toBeGreaterThan(0)
    expect(presigned.allowedContentTypes).toContain('application/pdf')
    expect(JSON.parse(presigned.onUploadCompleted.tokenPayload)).toMatchObject({ fileId: body.fileId, userId: 'owner-1' })
  })

  it('AWTD-1386: without presigned uploads, refuses rather than minting a legacy token', async () => {
    const res = await newUpload()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'Storage not configured' })
    expect(issuePresignedUpload).not.toHaveBeenCalled()
  })
})

describe('POST /api/secure-files/:fileId/upload-url (AWTD-1368, AWTD-1386)', () => {
  it('AWTD-1368: returns the presigned URL and headers with no Authorization', async () => {
    presignedUploadsEnabled.mockReturnValue(true)
    const res = await editUpload()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.uploadUrl).toBe(PRESIGNED.uploadUrl)
    expect(body.method).toBe('PUT')
    expect(body.headers).toMatchObject(PRESIGNED.headers)
    expect(Object.keys(body.headers).map((h: string) => h.toLowerCase())).not.toContain('authorization')
    expect(issuePresignedUpload).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: body.pathname, allowedContentTypes: ['application/pdf'] }),
    )
  })

  it('AWTD-1368: does not need the read/write token', async () => {
    presignedUploadsEnabled.mockReturnValue(true)
    delete process.env.BLOB_READ_WRITE_TOKEN
    expect((await editUpload()).status).toBe(200)
  })

  it('AWTD-1386: without presigned uploads, refuses even while the read/write token exists', async () => {
    const res = await editUpload()
    expect(res.status).toBe(500)
    expect(issuePresignedUpload).not.toHaveBeenCalled()
  })
})
