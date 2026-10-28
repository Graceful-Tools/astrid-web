/**
 * AWTD-1368: both direct-upload routes serve a presigned request once the
 * Blob store can verify its callbacks, and stop depending on
 * BLOB_READ_WRITE_TOKEN — the credential the OIDC upgrade removes.
 *
 * Contract (astrid-ios AITD-558, docs/API_CONTRACT.md → Uploads):
 *   get-upload-url → { fileId, pathname, presigned?: { uploadUrl, headers }, uploadToken?, uploadUrl? }
 *   presigned wins when present; the legacy pair stays until old builds drain.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const getUnifiedSession = vi.hoisted(() => vi.fn())
const taskFindFirst = vi.hoisted(() => vi.fn())
const fileFindUnique = vi.hoisted(() => vi.fn())
const issueClientUploadToken = vi.hoisted(() => vi.fn())
const issuePresignedUpload = vi.hoisted(() => vi.fn())
const presignedUploadsEnabled = vi.hoisted(() => vi.fn())

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
  issueClientUploadToken,
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
  getUnifiedSession.mockResolvedValue({ user: { id: 'owner-1' } })
  taskFindFirst.mockResolvedValue({ id: 'task-1' })
  fileFindUnique.mockResolvedValue({
    id: 'file-1',
    uploadedBy: 'owner-1',
    originalName: 'report.pdf',
    blobUrl: 'https://blob.example/files/owner-1/file-1-1.pdf',
  })
  issueClientUploadToken.mockResolvedValue({ token: 'client-token', uploadUrl: 'https://blob.vercel-storage.com/p' })
  issuePresignedUpload.mockResolvedValue(PRESIGNED)
  process.env.BLOB_READ_WRITE_TOKEN = 'rw-token'
  presignedUploadsEnabled.mockReturnValue(false)
})

afterEach(() => {
  process.env = { ...saved }
})

describe('POST /api/secure-upload/get-upload-url (AWTD-1368)', () => {
  it('AWTD-1368: today (no webhook key) answers exactly as before — legacy only, no presigned', async () => {
    const res = await newUpload()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ uploadToken: 'client-token', uploadUrl: 'https://blob.vercel-storage.com/p' })
    expect(body).not.toHaveProperty('presigned')
    expect(issuePresignedUpload).not.toHaveBeenCalled()
  })

  it('AWTD-1368: with the webhook key, adds presigned ALONGSIDE the legacy token', async () => {
    presignedUploadsEnabled.mockReturnValue(true)
    const body = await (await newUpload()).json()
    expect(body.presigned).toEqual(PRESIGNED)
    expect(body.uploadToken).toBe('client-token')
    expect(body.uploadUrl).toBe('https://blob.vercel-storage.com/p')
  })

  it('AWTD-1368: signs the same completion callback and payload into the presigned request', async () => {
    presignedUploadsEnabled.mockReturnValue(true)
    const body = await (await newUpload()).json()
    const legacy = issueClientUploadToken.mock.calls[0][0]
    const presigned = issuePresignedUpload.mock.calls[0][0]
    expect(presigned).toMatchObject({
      pathname: body.pathname,
      contentType: 'application/pdf',
      maximumSizeInBytes: legacy.maximumSizeInBytes,
      allowedContentTypes: legacy.allowedContentTypes,
      onUploadCompleted: legacy.onUploadCompleted,
    })
    expect(JSON.parse(presigned.onUploadCompleted.tokenPayload)).toMatchObject({ fileId: body.fileId, userId: 'owner-1' })
  })

  it('AWTD-1368: after the OIDC upgrade (no read/write token) serves presigned only, not a 500', async () => {
    presignedUploadsEnabled.mockReturnValue(true)
    delete process.env.BLOB_READ_WRITE_TOKEN
    const res = await newUpload()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.presigned).toEqual(PRESIGNED)
    expect(body).not.toHaveProperty('uploadToken')
    expect(issueClientUploadToken).not.toHaveBeenCalled()
  })
})

describe('POST /api/secure-files/:fileId/upload-url (AWTD-1368)', () => {
  it('AWTD-1368: today (no webhook key) still returns the bearer-token request', async () => {
    const body = await (await editUpload()).json()
    expect(body.headers.Authorization).toBe('Bearer client-token')
    expect(issuePresignedUpload).not.toHaveBeenCalled()
  })

  it('AWTD-1368: with the webhook key, returns the presigned URL and headers with no Authorization', async () => {
    presignedUploadsEnabled.mockReturnValue(true)
    const res = await editUpload()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.uploadUrl).toBe(PRESIGNED.uploadUrl)
    expect(body.method).toBe('PUT')
    expect(body.headers).toMatchObject(PRESIGNED.headers)
    expect(Object.keys(body.headers).map((h: string) => h.toLowerCase())).not.toContain('authorization')
    expect(issueClientUploadToken).not.toHaveBeenCalled()
    expect(issuePresignedUpload).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: body.pathname, allowedContentTypes: ['application/pdf'] }),
    )
  })

  it('AWTD-1368: after the OIDC upgrade (no read/write token) does not answer "Storage not configured"', async () => {
    presignedUploadsEnabled.mockReturnValue(true)
    delete process.env.BLOB_READ_WRITE_TOKEN
    expect((await editUpload()).status).toBe(200)
  })

  it('AWTD-1368: with neither credential, still refuses with 500 before minting anything', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    expect((await editUpload()).status).toBe(500)
    expect(issueClientUploadToken).not.toHaveBeenCalled()
    expect(issuePresignedUpload).not.toHaveBeenCalled()
  })
})
