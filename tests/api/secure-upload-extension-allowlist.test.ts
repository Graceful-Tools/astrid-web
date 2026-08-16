// @vitest-environment node
/**
 * POST /api/secure-upload/request-upload — an unknown extension must not ride
 * in on an allowed MIME type (task c09f3eb1).
 *
 * The route's own validator checked the MIME against a set, then:
 *
 *     const allowedMimes = EXTENSION_MIME_MAP[extension]
 *     if (allowedMimes && !allowedMimes.includes(file.type)) reject
 *
 * The `allowedMimes &&` is the hole. An extension that is not in the map has
 * no mapping, so the guard is skipped entirely and the file passes on the
 * strength of its declared MIME alone. `evil.html` sent as `image/png` is
 * accepted and stored WITH ITS .html EXTENSION.
 *
 * That matters because the extension decides the stored filename and therefore
 * what gets served back — the exact concern raised in the task description.
 *
 * Nothing legitimate is affected by closing it: the map covers all 24 allowed
 * MIME types, so every extension a permitted file can have is already present.
 *
 * RUNS IN THE NODE ENVIRONMENT. jsdom supplies its own File, which undici's
 * FormData rejects outright (`webidl.is.File(value)` fails) — the route never
 * even runs, and every case fails identically including one that passes in
 * production. A test that goes red for the wrong reason proves nothing.
 *
 * NOTE ON HOW THIS WAS FOUND. I first reported the shared-validator adoption as
 * "behaviour-identical" after comparing the two allowlists and finding them
 * equal, 24 for 24. The lists were equal; the CONTROL FLOW was not. Comparing
 * data is not comparing algorithms.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session-utils', () => ({
  getUnifiedSession: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    secureFile: { create: vi.fn().mockResolvedValue({ id: 'sf-1' }) },
    task: { findFirst: vi.fn().mockResolvedValue({ id: 'task-1' }) },
    chatChannel: { findFirst: vi.fn().mockResolvedValue({ id: 'ch-1' }) },
  },
}))
vi.mock('@vercel/blob', () => ({ put: vi.fn().mockResolvedValue({ url: 'https://blob/x' }) }))

function form(name: string, type: string) {
  const fd = new FormData()
  fd.set('file', new File([new Uint8Array([1, 2, 3])], name, { type }))
  fd.set('context', JSON.stringify({ attachTarget: 'task', taskId: 'task-1' }))
  return new Request('http://localhost/api/secure-upload/request-upload', {
    method: 'POST',
    body: fd,
  })
}

async function statusFor(name: string, type: string) {
  const { POST } = await import('@/app/api/secure-upload/request-upload/route')
  const res = await POST(form(name, type) as never)
  return res.status
}

beforeEach(() => vi.clearAllMocks())

describe('secure-upload extension allowlist (task c09f3eb1)', () => {
  it('rejects an unknown extension even when the declared MIME is allowed', async () => {
    // The hole: .html has no entry in the map, so the extension/MIME agreement
    // check was skipped and image/png alone carried it through.
    expect(await statusFor('evil.html', 'image/png')).toBe(400)
  })

  it('rejects a bare unknown extension', async () => {
    expect(await statusFor('payload.xyz', 'image/jpeg')).toBe(400)
  })

  it('still rejects a known extension whose MIME disagrees', async () => {
    // This one already worked — the map has .png, so the mismatch was caught.
    expect(await statusFor('photo.png', 'application/pdf')).toBe(400)
  })

  it('still accepts a legitimate file', async () => {
    expect(await statusFor('photo.png', 'image/png')).not.toBe(400)
  })

  it('still accepts the less common permitted types', async () => {
    // Guards against the tightening rejecting things that legitimately work:
    // every allowed MIME has its extension in the map, so these must survive.
    expect(await statusFor('notes.md', 'text/markdown')).not.toBe(400)
    expect(await statusFor('clip.mov', 'video/quicktime')).not.toBe(400)
  })
})
