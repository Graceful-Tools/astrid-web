/**
 * Copying a task with its comments keeps the comments' files (AWTD-1530).
 *
 * copy-utils carried each comment's text and author only, so a copied task lost
 * every comment attachment. A SecureFile belongs to one comment and its blobUrl
 * is unique, so the copy duplicates the stored object and gets its own row; it
 * never re-links the original's.
 *
 * Matches iOS AITD-586: one file per comment, the text on the first, system
 * comments skipped.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const createTasksInBulk = vi.hoisted(() => vi.fn())
vi.mock('@/services/task-bulk-create', () => ({ createTasksInBulk }))
const copyStoredObject = vi.hoisted(() => vi.fn())
vi.mock('@/lib/secure-storage', () => ({ copyStoredObject }))

import { copyTask } from '@/lib/copy-utils'
import { mockPrisma } from '../setup'

const at = (n: number) => new Date(Date.UTC(2026, 10, 1, 12, 0, n))

function file(id: string, name: string, n: number) {
  return {
    id, blobUrl: `https://store.example/files/u-author/${id}.png`, originalName: name,
    mimeType: 'image/png', fileSize: 1234, uploadedBy: 'u-author', taskId: 'original-task-id',
    commentId: 'c', createdAt: at(n),
  }
}

function source() {
  return {
    id: 'original-task-id', title: 'T', description: '', priority: 0, repeating: 'never',
    repeatingData: null, repeatFrom: 'COMPLETION_DATE', dueDateTime: null, attachments: [], lists: [],
    comments: [
      { id: 'c-text', content: 'plain words', authorId: 'u-author', createdAt: at(1), secureFiles: [] },
      { id: 'c-two', content: 'see these', authorId: 'u-author', createdAt: at(2),
        secureFiles: [file('f2', 'second.png', 4), file('f1', 'first.png', 3)] },
      { id: 'c-sys', content: 'Jon created this task', authorId: null, createdAt: at(0),
        secureFiles: [file('f-sys', 'sys.png', 0)] },
      { id: 'c-lost', content: 'gone missing', authorId: 'u-other', createdAt: at(5),
        secureFiles: [file('f-lost', 'lost.png', 5)] },
    ],
  }
}

function handedComments() {
  return createTasksInBulk.mock.calls[0][0].tasks[0].comments as Array<{
    content: string; authorId: string | null; files?: Array<Record<string, unknown>>
  }>
}

describe('AWTD-1530 copying comments copies their files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createTasksInBulk.mockImplementation(async ({ tasks }: { tasks: Array<{ data: object }> }) => ({
      tasks: tasks.map((t, i) => ({ id: `copy-${i}`, ...t.data })),
    }))
    copyStoredObject.mockImplementation(async (url: string, pathname: string) => {
      if (url.includes('f-lost')) throw new Error('object gone')
      return { url: `https://store.example/${pathname}`, pathname }
    })
    mockPrisma.task.findUnique.mockResolvedValue(source())
  })

  it('reads comments oldest first, with their files', async () => {
    await copyTask('original-task-id', { newOwnerId: 'u-copier', includeComments: true })
    const include = mockPrisma.task.findUnique.mock.calls[0][0].include
    expect(include.comments).toMatchObject({
      orderBy: { createdAt: 'asc' },
      include: { secureFiles: { orderBy: { createdAt: 'asc' } } },
    })
  })

  it('splits a two-file comment into one comment per file, text on the first, files in order', async () => {
    await copyTask('original-task-id', { newOwnerId: 'u-copier', includeComments: true })
    const comments = handedComments()
    expect(comments.map(c => c.content)).toEqual(['plain words', 'see these', '', 'gone missing'])
    expect(comments[0].files).toBeUndefined()
    expect(comments[1].files?.map(f => f.originalName)).toEqual(['first.png'])
    expect(comments[2].files?.map(f => f.originalName)).toEqual(['second.png'])
    expect(comments[2].authorId).toBe('u-author')
  })

  it('duplicates each stored object under the copier, never re-using the original URL', async () => {
    await copyTask('original-task-id', { newOwnerId: 'u-copier', includeComments: true })
    const copied = handedComments()[1].files![0]
    expect(copyStoredObject).toHaveBeenCalledWith(
      'https://store.example/files/u-author/f1.png',
      expect.stringMatching(/^files\/u-copier\/[0-9a-f-]{36}\.png$/),
      { contentType: 'image/png' },
    )
    expect(copied.blobUrl).not.toBe('https://store.example/files/u-author/f1.png')
    expect(copied).toMatchObject({
      originalName: 'first.png', mimeType: 'image/png', fileSize: 1234,
      uploadedBy: 'u-copier', attachTarget: 'message',
    })
  })

  it('skips system comments and their files', async () => {
    await copyTask('original-task-id', { newOwnerId: 'u-copier', includeComments: true })
    expect(copyStoredObject).not.toHaveBeenCalledWith(expect.stringContaining('f-sys'), expect.anything(), expect.anything())
  })

  it('a file whose object cannot be copied is left out, and the copy still succeeds with the text', async () => {
    const result = await copyTask('original-task-id', { newOwnerId: 'u-copier', includeComments: true })
    expect(result.success).toBe(true)
    const lost = handedComments()[3]
    expect(lost.content).toBe('gone missing')
    expect(lost.files ?? []).toEqual([])
  })

  it('copies no objects when comments are not copied', async () => {
    await copyTask('original-task-id', { newOwnerId: 'u-copier' })
    expect(copyStoredObject).not.toHaveBeenCalled()
  })
})
