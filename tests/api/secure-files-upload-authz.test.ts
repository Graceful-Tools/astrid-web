/**
 * POST /api/secure-files/:fileId/upload-url and /confirm-upload —
 * authorization (AWTD-1341).
 *
 * Both steps of the direct-upload flow replace an existing file's bytes, so
 * only the file's uploader may run either. Another signed-in user must be
 * refused before a scoped upload token is minted or the row is rewritten.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getUnifiedSession = vi.hoisted(() => vi.fn())
const fileFindUnique = vi.hoisted(() => vi.fn())
const fileUpdate = vi.hoisted(() => vi.fn())
const issueClientUploadToken = vi.hoisted(() => vi.fn())
const deleteFile = vi.hoisted(() => vi.fn())

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    secureFile: { findUnique: fileFindUnique, update: fileUpdate },
    session: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}))
vi.mock('@/lib/secure-storage', () => ({
  issueClientUploadToken,
  deleteFile,
  presignedUploadsEnabled: () => false,
}))

import { POST as uploadUrl } from '@/app/api/secure-files/[fileId]/upload-url/route'
import { POST as confirmUpload } from '@/app/api/secure-files/[fileId]/confirm-upload/route'

const FILE = {
  id: 'file-1',
  uploadedBy: 'owner-1',
  originalName: 'report.pdf',
  blobUrl: 'https://blob.example/files/owner-1/file-1-1.pdf',
  fileSize: 10,
  mimeType: 'application/pdf',
}

const ctx = { params: Promise.resolve({ fileId: 'file-1' }) } as never

function req(path: string, body: unknown) {
  return new NextRequest(`http://localhost/api/secure-files/file-1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const signIn = (id: string | null) =>
  getUnifiedSession.mockResolvedValue(id ? { user: { id } } : null)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token'
  fileFindUnique.mockResolvedValue(FILE)
  fileUpdate.mockImplementation(async ({ data }) => ({ ...FILE, ...data }))
  issueClientUploadToken.mockResolvedValue({ token: 'client-token', uploadUrl: 'https://blob.example/up' })
  deleteFile.mockResolvedValue(undefined)
})

describe('POST /api/secure-files/:fileId/upload-url authorization (AWTD-1341)', () => {
  const body = { mimeType: 'application/pdf', fileSize: 100 }

  it('AWTD-1341: refuses a signed-out caller with 401', async () => {
    signIn(null)
    expect((await uploadUrl(req('upload-url', body), ctx)).status).toBe(401)
    expect(issueClientUploadToken).not.toHaveBeenCalled()
  })

  it('AWTD-1341: refuses another user (not uploadedBy) with 403 and mints no upload token', async () => {
    signIn('intruder-1')
    const res = await uploadUrl(req('upload-url', body), ctx)
    expect(res.status).toBe(403)
    expect(issueClientUploadToken).not.toHaveBeenCalled()
    expect(JSON.stringify(await res.json())).not.toContain(FILE.blobUrl)
  })

  it('AWTD-1341: lets the uploader through (control)', async () => {
    signIn('owner-1')
    const res = await uploadUrl(req('upload-url', body), ctx)
    expect(res.status).toBe(200)
    expect(issueClientUploadToken).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: expect.stringMatching(/^files\/owner-1\/file-1-/) }),
    )
  })
})

describe('POST /api/secure-files/:fileId/confirm-upload authorization (AWTD-1341)', () => {
  const body = { blobUrl: 'https://blob.example/files/owner-1/file-1-2.pdf' }

  it('AWTD-1341: refuses a signed-out caller with 401', async () => {
    signIn(null)
    expect((await confirmUpload(req('confirm-upload', body), ctx)).status).toBe(401)
    expect(fileUpdate).not.toHaveBeenCalled()
  })

  it('AWTD-1341: refuses another user (not uploadedBy) with 403, rewriting and deleting nothing', async () => {
    signIn('intruder-1')
    const res = await confirmUpload(req('confirm-upload', { ...body, oldBlobUrl: FILE.blobUrl }), ctx)
    expect(res.status).toBe(403)
    expect(fileUpdate).not.toHaveBeenCalled()
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('AWTD-1341: lets the uploader through and deletes the file\'s own old blob (control)', async () => {
    signIn('owner-1')
    const res = await confirmUpload(req('confirm-upload', body), ctx)
    expect(res.status).toBe(200)
    expect(deleteFile).toHaveBeenCalledWith(FILE.blobUrl)
  })

  /*
   * FIXED (AWTD-1344/1345), found by AWTD-1341: confirm-upload/route.ts:84-85 deletes
   * `oldBlobUrl || existingFile.blobUrl`, and `oldBlobUrl` comes straight from
   * the request body. The uploader of ANY file can therefore delete an
   * arbitrary blob — another user's attachment — by naming its URL. Only the
   * file's own stored blobUrl should ever be deleted here.
   */
  it('AWTD-1344/1345 (was AWTD-1341 BUG): the uploader cannot delete a blob that is not this file\'s via oldBlobUrl', async () => {
    signIn('owner-1')
    const victim = 'https://blob.example/files/victim-1/secret-1.pdf'
    await confirmUpload(req('confirm-upload', { ...body, oldBlobUrl: victim }), ctx)
    expect(deleteFile).not.toHaveBeenCalledWith(victim)
  })

  /*
   * FIXED (AWTD-1344/1345), found by AWTD-1341: confirm-upload/route.ts:72-80 stores the
   * body's `blobUrl` without checking it is the pathname upload-url minted
   * (`files/<uploader>/<fileId>-…`). The uploader can point their own file
   * row at another user's blob and then read it back through
   * GET /api/secure-files/:fileId, which signs a download for whatever
   * blobUrl the row holds.
   */
  it('AWTD-1344/1345 (was AWTD-1341 BUG): the uploader cannot point their file at another user\'s blob', async () => {
    signIn('owner-1')
    const res = await confirmUpload(
      req('confirm-upload', { blobUrl: 'https://blob.example/files/victim-1/secret-1.pdf' }),
      ctx,
    )
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(fileUpdate).not.toHaveBeenCalled()
  })
})
