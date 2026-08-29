import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/images/store/route'
import { getUnifiedSession } from '@/lib/session-utils'
import { del, put } from '@vercel/blob'
import { lookup } from 'node:dns/promises'
import { MAX_REMOTE_IMAGE_BYTES } from '@/lib/security/remote-image'
import { prisma } from '@/lib/prisma'

const { lookupMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
}))

vi.mock('@/lib/session-utils', () => ({
  getUnifiedSession: vi.fn(),
}))

vi.mock('@vercel/blob', () => ({
  del: vi.fn(),
  put: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    secureFile: {
      create: vi.fn(),
    },
  },
}))

vi.mock('node:dns/promises', () => ({
  default: { lookup: lookupMock },
  lookup: lookupMock,
}))

describe('POST /api/images/store security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.REMOTE_IMAGE_ALLOWED_HOSTS
    vi.mocked(getUnifiedSession).mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com' },
    } as never)
    vi.mocked(lookup).mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never)
    vi.mocked(prisma.secureFile.create).mockResolvedValue({} as never)
  })

  it('AWTD-security rejects non-HTTPS URLs without fetching them', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new Request('http://localhost/api/images/store', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: 'http://169.254.169.254/latest/meta-data' }),
    }) as never)

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('AWTD-security rejects unapproved hosts without fetching them', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new Request('http://localhost/api/images/store', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: 'https://localhost/private.png' }),
    }) as never)

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('AWTD-security rejects approved hosts that resolve to private addresses', async () => {
    process.env.REMOTE_IMAGE_ALLOWED_HOSTS = 'images.example.test'
    vi.mocked(lookup).mockResolvedValue([
      { address: '10.0.0.4', family: 4 },
    ] as never)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new Request('http://localhost/api/images/store', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: 'https://images.example.test/private.png' }),
    }) as never)

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('AWTD-security validates every redirect target', async () => {
    process.env.REMOTE_IMAGE_ALLOWED_HOSTS = 'images.example.test'
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new Request('http://localhost/api/images/store', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: 'https://images.example.test/generated.png' }),
    }) as never)

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('AWTD-security rejects oversized responses before reading the body', async () => {
    process.env.REMOTE_IMAGE_ALLOWED_HOSTS = 'images.example.test'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      new Uint8Array([0x89]),
      {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(MAX_REMOTE_IMAGE_BYTES + 1),
        },
      },
    )))

    const response = await POST(new Request('http://localhost/api/images/store', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: 'https://images.example.test/huge.png' }),
    }) as never)

    expect(response.status).toBe(413)
    expect(put).not.toHaveBeenCalled()
  })

  it('AWTD-security rejects non-image content', async () => {
    process.env.REMOTE_IMAGE_ALLOWED_HOSTS = 'images.example.test'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not an image', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })))

    const response = await POST(new Request('http://localhost/api/images/store', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: 'https://images.example.test/fake.png' }),
    }) as never)

    expect(response.status).toBe(415)
    expect(put).not.toHaveBeenCalled()
  })

  it('AWTD-security persists approved images in blob storage', async () => {
    process.env.REMOTE_IMAGE_ALLOWED_HOSTS = 'images.example.test'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      { status: 200, headers: { 'content-type': 'image/png', 'content-length': '4' } },
    )))
    vi.mocked(put).mockResolvedValue({
      url: 'https://blob.example.test/generated.png',
      downloadUrl: 'https://blob.example.test/generated.png?download=1',
      pathname: 'uploads/user-1/generated.png',
      contentType: 'image/png',
      contentDisposition: 'inline',
    })

    const response = await POST(new Request('http://localhost/api/images/store', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: 'https://images.example.test/generated.png' }),
    }) as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.url).toBe('https://blob.example.test/generated.png')
    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^uploads\/user-1\/generated-[\w-]+\.png$/),
      expect.anything(),
      { access: 'public', contentType: 'image/png' },
    )
    expect(Buffer.isBuffer(vi.mocked(put).mock.calls[0][1])).toBe(true)
    expect(prisma.secureFile.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        blobUrl: 'https://blob.example.test/generated.png',
        originalName: expect.stringMatching(/^generated-[\w-]+\.png$/),
        mimeType: 'image/png',
        fileSize: 4,
        uploadedBy: 'user-1',
        attachTarget: 'list-image',
      },
    })
    expect(body.fileId).toEqual(expect.any(String))
  })

  it('removes the blob if lifecycle tracking fails', async () => {
    process.env.REMOTE_IMAGE_ALLOWED_HOSTS = 'images.example.test'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      new Uint8Array([0x89]),
      { status: 200, headers: { 'content-type': 'image/png' } },
    )))
    vi.mocked(put).mockResolvedValue({
      url: 'https://blob.example.test/generated.png',
      downloadUrl: 'https://blob.example.test/generated.png?download=1',
      pathname: 'uploads/user-1/generated.png',
      contentType: 'image/png',
      contentDisposition: 'inline',
    })
    vi.mocked(prisma.secureFile.create).mockRejectedValue(new Error('database unavailable'))
    vi.mocked(del).mockResolvedValue(undefined)

    const response = await POST(new Request('http://localhost/api/images/store', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: 'https://images.example.test/generated.png' }),
    }) as never)

    expect(response.status).toBe(500)
    expect(del).toHaveBeenCalledWith('https://blob.example.test/generated.png')
  })
})
