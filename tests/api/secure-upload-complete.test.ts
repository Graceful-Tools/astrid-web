/**
 * AWTD-1421: the upload-completed callback route. Its verifier and token minting
 * are tested separately; this pins the route itself, since a regression in its
 * 401 path would let anyone create SecureFile rows.
 *
 * Only prisma is mocked. Signing is real Ed25519 against a test key passed
 * through process.env, so the test fails if the route stops calling
 * verifyBlobCallback or stops passing BLOB_WEBHOOK_PUBLIC_KEY.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac, generateKeyPairSync, sign } from 'crypto'

const rows = vi.hoisted(() => new Map<string, { id: string }>())
const secureFileCreate = vi.hoisted(() => vi.fn())
const secureFileFindUnique = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: { secureFile: { create: secureFileCreate, findUnique: secureFileFindUnique } },
}))

import { POST } from '@/app/api/secure-upload/upload-complete/route'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const sig = (body: string, key = privateKey) => sign(null, Buffer.from(body), key).toString('hex')

const TOKEN_PAYLOAD = {
  userId: 'user-1',
  fileId: 'file-1',
  fileName: 'report.pdf',
  fileType: 'application/pdf',
  fileSize: 123,
  taskId: 'task-1',
  listId: 'list-1',
  commentId: 'comment-1',
  clientRequestId: 'req-1',
}

const callback = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'blob.upload-completed',
    payload: {
      blob: { url: 'https://blob.example/files/user-1/file-1.pdf', contentType: 'application/pdf', size: 123 },
      tokenPayload: JSON.stringify(TOKEN_PAYLOAD),
    },
    ...overrides,
  })

const post = (body: string, signature?: string | null) =>
  POST(
    new NextRequest('http://localhost/api/secure-upload/upload-complete', {
      method: 'POST',
      headers: signature ? { 'x-vercel-signature': signature } : {},
      body,
    }),
  )

const saved = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  rows.clear()
  process.env.BLOB_WEBHOOK_PUBLIC_KEY = PUBLIC_PEM
  // A tiny stateful store keyed by (uploadedBy, clientRequestId), as the DB unique index is.
  secureFileFindUnique.mockImplementation(async ({ where }) => {
    const k = where.uploadedBy_clientRequestId
    return rows.get(`${k.uploadedBy}:${k.clientRequestId}`) ?? null
  })
  secureFileCreate.mockImplementation(async ({ data }) => {
    rows.set(`${data.uploadedBy}:${data.clientRequestId}`, { id: data.id })
    return { id: data.id }
  })
})

afterEach(() => {
  process.env = { ...saved }
})

describe('POST /api/secure-upload/upload-complete (AWTD-1421)', () => {
  it('AWTD-1421: a signed callback creates the file from the tokenPayload', async () => {
    const body = callback()
    const res = await post(body, sig(body))
    expect(res.status).toBe(200)
    expect(secureFileCreate).toHaveBeenCalledTimes(1)
    expect(secureFileCreate.mock.calls[0][0].data).toEqual({
      id: 'file-1',
      blobUrl: 'https://blob.example/files/user-1/file-1.pdf',
      originalName: 'report.pdf',
      mimeType: 'application/pdf',
      fileSize: 123,
      uploadedBy: 'user-1',
      taskId: 'task-1',
      listId: 'list-1',
      commentId: 'comment-1',
      clientRequestId: 'req-1',
    })
  })

  it.each([
    ['unsigned', (_b: string) => null],
    ['HMAC-signed', (b: string) => createHmac('sha256', 'rw-token').update(b).digest('hex')],
    ['signed by another key', (b: string) => sig(b, generateKeyPairSync('ed25519').privateKey)],
    ['garbage signature', (_b: string) => 'zz'.repeat(64)],
  ])('AWTD-1421: a %s callback is rejected with 401 and creates nothing', async (_name, signer) => {
    const body = callback()
    const res = await post(body, signer(body))
    expect(res.status).toBe(401)
    expect(secureFileCreate).not.toHaveBeenCalled()
  })

  it('AWTD-1421: a tampered body is rejected with 401 and creates nothing', async () => {
    const signature = sig(callback())
    const tampered = callback().replace('user-1/file-1.pdf', 'victim/evil.pdf')
    const res = await post(tampered, signature)
    expect(res.status).toBe(401)
    expect(secureFileCreate).not.toHaveBeenCalled()
  })

  it('AWTD-1421: with no webhook key configured even a well-formed signature is rejected', async () => {
    delete process.env.BLOB_WEBHOOK_PUBLIC_KEY
    const body = callback()
    const res = await post(body, sig(body))
    expect(res.status).toBe(401)
    expect(secureFileCreate).not.toHaveBeenCalled()
  })

  it('AWTD-1421: a signed callback with the wrong type is a 400', async () => {
    const body = callback({ type: 'blob.something-else' })
    const res = await post(body, sig(body))
    expect(res.status).toBe(400)
    expect(secureFileCreate).not.toHaveBeenCalled()
  })

  it('AWTD-1421: the same clientRequestId delivered twice stores one row', async () => {
    const body = callback()
    expect((await post(body, sig(body))).status).toBe(200)
    expect((await post(body, sig(body))).status).toBe(200)
    expect(secureFileCreate).toHaveBeenCalledTimes(1)
    expect(rows.size).toBe(1)
  })
})
