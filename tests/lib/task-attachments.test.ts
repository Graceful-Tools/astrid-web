/**
 * Task-level attachments are readable again (Task b4a362f1).
 *
 * Attaching a file in the task form created a SecureFile row with `taskId` set,
 * and then nothing in the UI ever read it back: the form re-seeded from the
 * legacy `Attachment` model and the activity strip only walked comments. The
 * file was gone from the product the moment the form closed.
 *
 * The catch is that comment attachments ALSO carry `taskId` — the composer
 * uploads with `{ taskId }` context and `commentId` is stamped afterwards — so
 * "attached to the task" has to mean `commentId === null`, or every comment
 * attachment gets listed twice.
 */

import { describe, it, expect } from 'vitest'
import { collectTaskAttachments, taskLevelAttachments } from '@/lib/task-attachments'

const secureFile = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  blobUrl: `https://blob/${id}`,
  originalName: `${id}.png`,
  mimeType: 'image/png',
  fileSize: 10,
  uploadedBy: 'user-1',
  taskId: 'task-1',
  commentId: null,
  createdAt: new Date('2026-08-03T00:00:00Z'),
  updatedAt: new Date('2026-08-03T00:00:00Z'),
  ...over,
})

describe('collectTaskAttachments (Task b4a362f1)', () => {
  it('surfaces a file attached to the task itself', () => {
    const task = { secureFiles: [secureFile('f1')], comments: [] } as any

    expect(collectTaskAttachments(task)).toEqual([
      expect.objectContaining({ fileId: 'f1', name: 'f1.png', isTaskLevel: true }),
    ])
  })

  it('still surfaces files carried by comments', () => {
    const task = {
      secureFiles: [],
      comments: [
        { id: 'c1', createdAt: new Date('2026-08-03T01:00:00Z'), secureFiles: [secureFile('f2', { commentId: 'c1' })] },
      ],
    } as any

    expect(collectTaskAttachments(task)).toEqual([
      expect.objectContaining({ fileId: 'f2', isTaskLevel: false }),
    ])
  })

  it('does not list a comment attachment twice, even though it carries taskId', () => {
    // This is the shape the API actually returns: the same row appears under
    // task.secureFiles AND under the comment that owns it.
    const shared = secureFile('f3', { commentId: 'c1' })
    const task = {
      secureFiles: [shared],
      comments: [{ id: 'c1', createdAt: new Date(), secureFiles: [shared] }],
    } as any

    const result = collectTaskAttachments(task)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ fileId: 'f3', isTaskLevel: false })
  })

  it('lists task-level files before comment files', () => {
    const task = {
      secureFiles: [secureFile('direct')],
      comments: [{ id: 'c1', createdAt: new Date(), secureFiles: [secureFile('viaComment', { commentId: 'c1' })] }],
    } as any

    expect(collectTaskAttachments(task).map(a => a.fileId)).toEqual(['direct', 'viaComment'])
  })

  it('survives a task with neither field populated', () => {
    expect(collectTaskAttachments({} as any)).toEqual([])
  })
})

describe('taskLevelAttachments (Task b4a362f1)', () => {
  it('returns only the files hung directly on the task', () => {
    const task = {
      secureFiles: [secureFile('direct'), secureFile('viaComment', { commentId: 'c1' })],
      comments: [],
    } as any

    expect(taskLevelAttachments(task).map(a => a.fileId)).toEqual(['direct'])
  })

  it('gives the form the shape it renders — url, name, type, size', () => {
    const task = { secureFiles: [secureFile('f1', { originalName: 'receipt.pdf', mimeType: 'application/pdf', fileSize: 42 })] } as any

    expect(taskLevelAttachments(task)[0]).toMatchObject({
      id: 'f1',
      name: 'receipt.pdf',
      url: '/api/secure-files/f1',
      type: 'application/pdf',
      size: 42,
    })
  })
})

describe('abandoned composer uploads (Task ded31696)', () => {
  it('does not count a file still staged in the comment composer as a task attachment', () => {
    // The composer uploads with a { taskId } context — that is how the write is
    // authorized — and commentId is only stamped on when the comment is sent.
    // Between picking a file and sending, the row looks exactly like a
    // task-form upload, so intent has to be recorded at upload time.
    const task = {
      secureFiles: [secureFile('staged', { attachTarget: 'message' })],
      comments: [],
    } as any

    expect(taskLevelAttachments(task)).toEqual([])
    expect(collectTaskAttachments(task)).toEqual([])
  })

  it('counts a file the task form uploaded', () => {
    const task = { secureFiles: [secureFile('direct', { attachTarget: 'task' })] } as any

    expect(taskLevelAttachments(task).map(a => a.fileId)).toEqual(['direct'])
  })

  it('leaves rows written before the discriminator classified exactly as they were', () => {
    // attachTarget is null on every legacy row. Treating those as task-level
    // keeps today's behavior rather than silently reinterpreting old data.
    const task = { secureFiles: [secureFile('legacy', { attachTarget: null })] } as any

    expect(taskLevelAttachments(task).map(a => a.fileId)).toEqual(['legacy'])
  })

  it('still shows a message file once the comment carrying it exists', () => {
    const sent = secureFile('sent', { attachTarget: 'message', commentId: 'c1' })
    const task = {
      secureFiles: [sent],
      comments: [{ id: 'c1', createdAt: new Date(), secureFiles: [sent] }],
    } as any

    expect(collectTaskAttachments(task)).toEqual([
      expect.objectContaining({ fileId: 'sent', isTaskLevel: false }),
    ])
  })
})
