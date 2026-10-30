// @vitest-environment node
/**
 * AWTD-1286: a direct upload end to end on self-hosted storage, with the real
 * storage module, the real local store and the real routes. Only the session
 * and the database are stubbed.
 *
 * The contract it holds is the one astrid-ios (AITD-558) already speaks, so no
 * client changes: get-upload-url answers `presigned: { uploadUrl, headers }`,
 * the client PUTs the bytes there with Content-Type, and the file is recorded
 * without any store callback. The replace-file flow PUTs, reads `url` from the
 * response, and hands it to confirm-upload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const getUnifiedSession = vi.hoisted(() => vi.fn())
const taskFindFirst = vi.hoisted(() => vi.fn())
const fileCreate = vi.hoisted(() => vi.fn())
const fileFindUnique = vi.hoisted(() => vi.fn())
const fileUpdate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findFirst: taskFindFirst },
    secureFile: { create: fileCreate, findUnique: fileFindUnique, update: fileUpdate },
    session: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}))
vi.mock('@/lib/secure-file-idempotency', () => ({
  findSecureFileByClientRequestId: vi.fn().mockResolvedValue(null),
  isUniqueConstraintError: () => false,
}))

import { POST as getUploadUrl } from '@/app/api/v1/secure-upload/get-upload-url/route'
import { POST as replaceUploadUrl } from '@/app/api/secure-files/[fileId]/upload-url/route'
import { POST as confirmUpload } from '@/app/api/secure-files/[fileId]/confirm-upload/route'
import { PUT as putUpload } from '@/app/api/v1/storage/uploads/[token]/route'
import { GET as getObject } from '@/app/api/v1/storage/objects/[...path]/route'
import { putObject } from '@/lib/secure-storage'

const ORIGIN = 'https://tasks.example.test'
const saved = { ...process.env }
let root: string

beforeEach(() => {
  vi.clearAllMocks()
  root = mkdtempSync(join(tmpdir(), 'self-hosted-flow-'))
  process.env.STORAGE_DRIVER = 'local'
  process.env.STORAGE_LOCAL_DIR = root
  process.env.NEXTAUTH_URL = ORIGIN
  process.env.NEXTAUTH_SECRET = 's'.repeat(40)
  delete process.env.VERCEL_URL
  delete process.env.BLOB_READ_WRITE_TOKEN
  getUnifiedSession.mockResolvedValue({ user: { id: 'owner-1' } })
  taskFindFirst.mockResolvedValue({ id: 'task-1' })
  fileCreate.mockResolvedValue({})
  fileUpdate.mockImplementation(async ({ data }) => data)
})

afterEach(() => {
  process.env = { ...saved }
  rmSync(root, { recursive: true, force: true })
})

function json(url: string, body: unknown) {
  return new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

/** The client side of a direct upload: PUT to the URL as given, adding only Content-Type. */
async function clientPut(uploadUrl: string, headers: Record<string, string>, body: string, contentType: string) {
  const token = new URL(uploadUrl).pathname.split('/').pop()!
  const req = new NextRequest(uploadUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': contentType }, body })
  return putUpload(req, { params: Promise.resolve({ token }) } as never)
}

async function clientGet(url: string, headers: Record<string, string> = {}) {
  const path = new URL(url).pathname.replace('/api/v1/storage/objects/', '').split('/')
  return getObject(new NextRequest(url, { headers }), { params: Promise.resolve({ path }) } as never)
}

describe('self-hosted direct upload (AWTD-1286)', () => {
  it('get-upload-url hands out a presigned PUT to this app, and no Blob token', async () => {
    const res = await getUploadUrl(json(`${ORIGIN}/api/secure-upload/get-upload-url`, {
      fileName: 'report.pdf', fileType: 'application/pdf', fileSize: 11, context: { taskId: 'task-1' },
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.presigned.uploadUrl).toMatch(new RegExp(`^${ORIGIN}/api/v1/storage/uploads/[\\w-]+\\.[\\w-]+$`))
    expect(body.presigned.headers).toEqual({})
    expect(body).not.toHaveProperty('uploadToken')
  })

  it('the PUT stores the bytes, records the file, and the object is served back', async () => {
    const body = await (await getUploadUrl(json(`${ORIGIN}/api/secure-upload/get-upload-url`, {
      fileName: 'report.pdf', fileType: 'application/pdf', fileSize: 11, context: { taskId: 'task-1' },
    }))).json()

    const put = await clientPut(body.presigned.uploadUrl, body.presigned.headers, '%PDF-1 data', 'application/pdf')
    expect(put.status).toBe(200)
    const landed = await put.json()
    expect(landed.url).toBe(`${ORIGIN}/api/v1/storage/objects/${body.pathname}`)

    expect(fileCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: body.fileId, blobUrl: landed.url, uploadedBy: 'owner-1', taskId: 'task-1' }),
    })

    const served = await clientGet(landed.url)
    expect(served.status).toBe(200)
    expect(await served.text()).toBe('%PDF-1 data')
    expect(served.headers.get('content-type')).toBe('application/pdf')
    expect(served.headers.get('content-disposition')).toBe('inline')
    expect(served.headers.get('x-content-type-options')).toBe('nosniff')
    expect(served.headers.get('content-security-policy')).toContain('sandbox')
  })

  it('refuses a type the grant does not allow, and a body over its size', async () => {
    const body = await (await getUploadUrl(json(`${ORIGIN}/api/secure-upload/get-upload-url`, {
      fileName: 'report.pdf', fileType: 'application/pdf', fileSize: 11, context: { taskId: 'task-1' },
    }))).json()
    const wrongType = await clientPut(body.presigned.uploadUrl, {}, '<html>', 'text/html')
    expect(wrongType.status).toBe(415)
    expect(fileCreate).not.toHaveBeenCalled()
  })

  it('refuses a forged or tampered grant', async () => {
    const res = await clientPut(`${ORIGIN}/api/v1/storage/uploads/e30.bad`, {}, 'x', 'application/pdf')
    expect(res.status).toBe(401)
  })

  it('replace-file: PUT answers a Blob-shaped url that confirm-upload accepts', async () => {
    const oldUrl = (await putObject('files/owner-1/file-1-1.pdf', Buffer.from('old'), { contentType: 'application/pdf' })).url
    fileFindUnique.mockResolvedValue({
      id: 'file-1', uploadedBy: 'owner-1', originalName: 'report.pdf', blobUrl: oldUrl, fileSize: 3, mimeType: 'application/pdf',
    })

    const grant = await (await replaceUploadUrl(
      json(`${ORIGIN}/api/secure-files/file-1/upload-url`, { mimeType: 'application/pdf', fileSize: 3 }),
      { params: Promise.resolve({ fileId: 'file-1' }) } as never,
    )).json()
    const landed = await (await clientPut(grant.uploadUrl, grant.headers, 'new', 'application/pdf')).json()

    const confirmed = await confirmUpload(
      json(`${ORIGIN}/api/secure-files/file-1/confirm-upload`, { blobUrl: landed.url, mimeType: 'application/pdf', fileSize: 3 }),
      { params: Promise.resolve({ fileId: 'file-1' }) } as never,
    )
    expect(confirmed.status).toBe(200)
    expect(fileUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ blobUrl: landed.url }) }))
    // The old object is gone; the new one is served.
    expect((await clientGet(oldUrl)).status).toBe(404)
    expect(await (await clientGet(landed.url)).text()).toBe('new')
  })
})

describe('self-hosted object serving (AWTD-1286)', () => {
  it('answers a byte range with 206, so video plays', async () => {
    const { url } = await putObject('files/u/clip.mp4', Buffer.from('0123456789'), { contentType: 'video/mp4' })
    const res = await clientGet(url, { range: 'bytes=0-3' })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 0-3/10')
    expect(await res.text()).toBe('0123')
  })

  it('downloads rather than renders anything that could run as this site', async () => {
    const { url } = await putObject('uploads/u/page.html', Buffer.from('<script>1</script>'), { contentType: 'text/html' })
    const res = await clientGet(url)
    expect(res.headers.get('content-disposition')).toBe('attachment')
  })

  it('404s a traversal attempt and a missing object', async () => {
    expect((await getObject(new NextRequest(`${ORIGIN}/x`), { params: Promise.resolve({ path: ['..', 'etc', 'passwd'] }) } as never)).status).toBe(404)
    expect((await clientGet(`${ORIGIN}/api/v1/storage/objects/files/u/none.png`)).status).toBe(404)
  })

  it('both routes 404 on a Vercel Blob deployment', async () => {
    delete process.env.STORAGE_DRIVER
    expect((await clientGet(`${ORIGIN}/api/v1/storage/objects/files/u/x.png`)).status).toBe(404)
    expect((await clientPut(`${ORIGIN}/api/v1/storage/uploads/a.b`, {}, 'x', 'image/png')).status).toBe(404)
  })
})

describe('secure-storage on self-hosted storage (AWTD-1286)', () => {
  it('always offers presigned uploads', async () => {
    const { presignedUploadsEnabled } = await import('@/lib/secure-storage')
    expect(presignedUploadsEnabled()).toBe(true)
  })

  it('deleteObject removes what putObject wrote', async () => {
    const { deleteObject } = await import('@/lib/secure-storage')
    const { url } = await putObject('uploads/u/a.png', Buffer.from('x'), { contentType: 'image/png' })
    await deleteObject(url)
    expect((await clientGet(url)).status).toBe(404)
  })
})
