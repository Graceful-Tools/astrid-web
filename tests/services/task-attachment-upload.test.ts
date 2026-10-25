/**
 * AWTD-1342: services/task-attachment-upload.service.ts, tested directly. The
 * route test (tests/api/v1-task-attachment-uploads.test.ts) covers the wire;
 * this pins the service's own edges.
 *
 * Pinned:
 *   - the 4 MB limit is inclusive: exactly 4 MiB stores, one byte more is 413,
 *     and the size check runs before the bytes are sniffed;
 *   - the bytes must sniff as the ticket's MIME type — a JPEG body on a PNG
 *     ticket is refused; GIF and WebP pass;
 *   - mint infers the MIME from the extension (case-insensitively) and refuses
 *     one that disagrees with it;
 *   - completion re-reads the task and re-checks access: a member removed, or a
 *     task deleted, after minting gets 404 and NOTHING is stored;
 *   - access is creator / assignee / list role only — a public list's stranger
 *     cannot mint;
 *   - a comment conflict surfaces as 409 and an invalid comment as 400.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({ task: { findUnique: vi.fn() } }))
const storeSecureUpload = vi.hoisted(() => vi.fn())
const createCommentWithSideEffects = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/services/secure-upload.service', () => ({ storeSecureUpload }))
vi.mock('@/services/comment.service', () => ({ createCommentWithSideEffects }))

import {
  TASK_ATTACHMENT_MAX_BYTES,
  completeTaskAttachmentUpload,
  mintTaskAttachmentUpload,
} from '@/services/task-attachment-upload.service'
import type { AttachmentUploadTicket } from '@/lib/attachment-upload-ticket'

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIG = [0xff, 0xd8, 0xff, 0xe0]
const GIF_SIG = [...'GIF89a'].map(c => c.charCodeAt(0))
const WEBP_SIG = [...'RIFF'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map(c => c.charCodeAt(0)))

function image(signature: number[], size = 64): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set(signature)
  return bytes
}

type ListRow = { id: string; ownerId: string; privacy: string; listMembers: Array<{ userId: string; role: string }> }
function taskRow(overrides: { creatorId?: string; assigneeId?: string | null; lists?: ListRow[] } = {}) {
  return {
    id: 'task-1',
    title: 'Pick a layout',
    creatorId: 'creator',
    assigneeId: null,
    assignee: null,
    lists: [],
    ...overrides,
  }
}
const sharedList = (members: string[]): ListRow => ({
  id: 'list-1',
  ownerId: 'list-owner',
  privacy: 'SHARED',
  listMembers: members.map(userId => ({ userId, role: 'member' })),
})

function claims(overrides: Partial<AttachmentUploadTicket> = {}): AttachmentUploadTicket {
  return {
    userId: 'member',
    authorId: 'member',
    taskId: 'task-1',
    fileName: 'shot.png',
    mimeType: 'image/png',
    caption: null,
    clientRequestId: 'req-1',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.task.findUnique.mockResolvedValue(taskRow({ lists: [sharedList(['member'])] }))
  storeSecureUpload.mockResolvedValue({ file: { id: 'file-1' } })
  createCommentWithSideEffects.mockResolvedValue({ kind: 'created', comment: { id: 'comment-1' } })
})

describe('completeTaskAttachmentUpload size and type limits (AWTD-1342)', () => {
  it('the limit is 4 MiB and inclusive', async () => {
    expect(TASK_ATTACHMENT_MAX_BYTES).toBe(4 * 1024 * 1024)
    const result = await completeTaskAttachmentUpload(claims(), image(PNG_SIG, TASK_ATTACHMENT_MAX_BYTES))
    expect(result).toEqual({ ok: true, created: true, comment: { id: 'comment-1' }, fileId: 'file-1' })
  })

  it('one byte over is 413, decided before sniffing or reading the task', async () => {
    const result = await completeTaskAttachmentUpload(claims(), new Uint8Array(TASK_ATTACHMENT_MAX_BYTES + 1))
    expect(result).toMatchObject({ ok: false, status: 413 })
    expect(db.task.findUnique).not.toHaveBeenCalled()
    expect(storeSecureUpload).not.toHaveBeenCalled()
  })

  it('an empty body is 400', async () => {
    expect(await completeTaskAttachmentUpload(claims(), new Uint8Array(0))).toMatchObject({ ok: false, status: 400 })
  })

  it('bytes that sniff as a different image than the ticket names are refused', async () => {
    const result = await completeTaskAttachmentUpload(claims({ mimeType: 'image/png' }), image(JPEG_SIG))
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(storeSecureUpload).not.toHaveBeenCalled()
  })

  it.each([
    ['image/gif', GIF_SIG, 'a.gif'],
    ['image/webp', WEBP_SIG, 'a.webp'],
    ['image/jpeg', JPEG_SIG, 'a.jpg'],
  ])('accepts %s bytes on a matching ticket', async (mimeType, signature, fileName) => {
    const result = await completeTaskAttachmentUpload(claims({ mimeType, fileName }), image(signature))
    expect(result.ok).toBe(true)
    expect(storeSecureUpload).toHaveBeenCalledWith(expect.objectContaining({ file: expect.any(File) }))
    const file = storeSecureUpload.mock.calls[0][0].file as File
    expect(file.type).toBe(mimeType)
  })
})

describe('completeTaskAttachmentUpload access re-check (AWTD-1342)', () => {
  it('a member removed after minting gets 404 and nothing is stored', async () => {
    db.task.findUnique.mockResolvedValue(taskRow({ lists: [sharedList([])] }))

    const result = await completeTaskAttachmentUpload(claims(), image(PNG_SIG))

    expect(result).toEqual({ ok: false, status: 404, error: 'Task not found or access denied' })
    expect(storeSecureUpload).not.toHaveBeenCalled()
    expect(createCommentWithSideEffects).not.toHaveBeenCalled()
  })

  it('a task deleted after minting gets 404 and nothing is stored', async () => {
    db.task.findUnique.mockResolvedValue(null)
    expect(await completeTaskAttachmentUpload(claims(), image(PNG_SIG))).toMatchObject({ ok: false, status: 404 })
    expect(storeSecureUpload).not.toHaveBeenCalled()
  })

  it('re-reads the ticket’s task with list members, not a cached copy', async () => {
    await completeTaskAttachmentUpload(claims(), image(PNG_SIG))
    expect(db.task.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        include: expect.objectContaining({
          lists: { select: expect.objectContaining({ listMembers: { select: { userId: true, role: true } } }) },
        }),
      }),
    )
  })

  it('the uploader is checked, not the comment author the ticket signs as', async () => {
    db.task.findUnique.mockResolvedValue(taskRow({ lists: [sharedList(['agent'])] }))
    const result = await completeTaskAttachmentUpload(claims({ userId: 'member', authorId: 'agent' }), image(PNG_SIG))
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('stores under a per-task key and posts the ATTACHMENT comment with the default caption', async () => {
    await completeTaskAttachmentUpload(claims(), image(PNG_SIG))
    expect(storeSecureUpload).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'member', attachTarget: 'task', clientRequestId: 'task-attachment:task-1:req-1' }),
    )
    expect(createCommentWithSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ATTACHMENT', content: 'Attached: shot.png', file: { id: 'file-1', linkerUserId: 'member' } }),
    )
  })

  it('maps a comment conflict to 409 and an invalid comment to 400', async () => {
    createCommentWithSideEffects.mockResolvedValueOnce({ kind: 'conflict', error: 'key reused' })
    expect(await completeTaskAttachmentUpload(claims(), image(PNG_SIG))).toEqual({ ok: false, status: 409, error: 'key reused' })
    createCommentWithSideEffects.mockResolvedValueOnce({ kind: 'invalid', error: 'bad' })
    expect(await completeTaskAttachmentUpload(claims(), image(PNG_SIG))).toEqual({ ok: false, status: 400, error: 'bad' })
  })
})

describe('mintTaskAttachmentUpload (AWTD-1342)', () => {
  const mint = (args: Record<string, unknown>) =>
    mintTaskAttachmentUpload({ taskId: 'task-1', userId: 'member', authorId: 'member', fileName: 'shot.png', ...args })

  it('infers the MIME type from the extension, case-insensitively', async () => {
    const result = await mint({ fileName: 'SHOT.PNG' })
    expect(result).toMatchObject({ ok: true, claims: { mimeType: 'image/png', fileName: 'SHOT.PNG' } })
  })

  it('refuses a MIME type that disagrees with the extension, and a non-image', async () => {
    expect(await mint({ mimeType: 'image/jpeg' })).toMatchObject({ ok: false, status: 400 })
    expect(await mint({ fileName: 'x.svg' })).toMatchObject({ ok: false, status: 400 })
    expect(db.task.findUnique).not.toHaveBeenCalled()
  })

  it('a stranger on a PUBLIC list cannot mint', async () => {
    db.task.findUnique.mockResolvedValue(taskRow({ lists: [{ ...sharedList([]), privacy: 'PUBLIC' }] }))
    expect(await mint({ userId: 'stranger' })).toEqual({ ok: false, status: 404, error: 'Task not found or access denied' })
  })

  it('the creator and the assignee can mint without a list role', async () => {
    db.task.findUnique.mockResolvedValue(taskRow({ creatorId: 'c', assigneeId: 'a' }))
    expect((await mint({ userId: 'c' })).ok).toBe(true)
    expect((await mint({ userId: 'a' })).ok).toBe(true)
  })

  it('always mints a clientRequestId so a retried PUT is a replay', async () => {
    const result = await mint({})
    expect(result.ok && result.claims.clientRequestId).toMatch(/^[0-9a-f-]{36}$/)
  })
})
