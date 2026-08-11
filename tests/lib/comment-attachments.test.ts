/**
 * Multiple attachments on a web comment (Task 9f325964).
 *
 * Web held exactly one `attachedFile`: picking a second overwrote the first,
 * silently, after the user had already seen the first chip appear. iOS hit the
 * same bug and fixed it in AttachmentQueue.swift / CommentAttachmentBatch.swift;
 * these are the tests for the web twin of those two types.
 */

import { describe, it, expect } from 'vitest'
import {
  MAX_COMMENT_ATTACHMENTS,
  addAttachment,
  removeAttachment,
  isAttachmentQueueFull,
  fileIdFromUrl,
  commentDrafts,
} from '@/lib/comment-attachments'
import type { FileAttachment } from '@/hooks/task-detail/useTaskDetailState'

const file = (id: string, name = `${id}.png`): FileAttachment => ({
  url: `/api/v1/secure-files/${id}`,
  name,
  type: 'image/png',
  size: 1234,
})

describe('fileIdFromUrl', () => {
  it('pulls the id out of a secure-files url', () => {
    expect(fileIdFromUrl('/api/v1/secure-files/abc-123')).toBe('abc-123')
  })

  it('ignores a query string', () => {
    expect(fileIdFromUrl('/api/v1/secure-files/abc-123?download=1')).toBe('abc-123')
  })

  it('returns undefined for a url that carries no id', () => {
    expect(fileIdFromUrl('')).toBeUndefined()
    expect(fileIdFromUrl('/api/v1/secure-files/')).toBeUndefined()
  })
})

describe('addAttachment (Task 9f325964)', () => {
  it('queues a second file behind the first instead of replacing it', () => {
    const queue = addAttachment(addAttachment([], file('one')), file('two'))

    expect(queue.map(f => f.name)).toEqual(['one.png', 'two.png'])
  })

  it('keeps pick order across many files', () => {
    const queue = ['a', 'b', 'c', 'd'].reduce(
      (acc, id) => addAttachment(acc, file(id)),
      [] as FileAttachment[],
    )

    expect(queue.map(f => f.url)).toEqual([
      '/api/v1/secure-files/a',
      '/api/v1/secure-files/b',
      '/api/v1/secure-files/c',
      '/api/v1/secure-files/d',
    ])
  })

  it('does not queue the same file twice (re-fired change event / double click)', () => {
    const queue = addAttachment(addAttachment([], file('one')), file('one'))

    expect(queue).toHaveLength(1)
  })

  it('drops the NEW file at the cap rather than evicting a staged one', () => {
    const full = Array.from({ length: MAX_COMMENT_ATTACHMENTS }, (_, i) => file(`f${i}`))

    expect(isAttachmentQueueFull(full)).toBe(true)

    const queue = addAttachment(full, file('overflow'))

    expect(queue).toHaveLength(MAX_COMMENT_ATTACHMENTS)
    expect(queue.some(f => f.url.endsWith('overflow'))).toBe(false)
    expect(queue[0].url).toBe('/api/v1/secure-files/f0')
  })
})

describe('removeAttachment', () => {
  it('removes only the named file', () => {
    const queue = [file('one'), file('two'), file('three')]

    expect(removeAttachment(queue, 'two').map(f => f.name)).toEqual(['one.png', 'three.png'])
  })

  it('leaves the queue alone for an unknown id', () => {
    const queue = [file('one')]

    expect(removeAttachment(queue, 'nope')).toEqual(queue)
  })
})

describe('commentDrafts (Task 9f325964)', () => {
  it('sends nothing when there is neither text nor a file', () => {
    expect(commentDrafts('   ', [])).toEqual([])
  })

  it('sends one plain comment when there is text and no file', () => {
    expect(commentDrafts('  hello  ', [])).toEqual([
      { content: 'hello', type: 'TEXT', fileId: undefined },
    ])
  })

  it('fans out to one comment per file, in pick order', () => {
    const drafts = commentDrafts('', [file('a'), file('b'), file('c')])

    expect(drafts).toHaveLength(3)
    expect(drafts.map(d => d.fileId)).toEqual(['a', 'b', 'c'])
    expect(drafts.every(d => d.type === 'ATTACHMENT')).toBe(true)
  })

  it('rides the caption on the first comment and does not repeat it', () => {
    const drafts = commentDrafts('look at these', [file('a'), file('b')])

    expect(drafts[0].content).toBe('look at these')
    expect(drafts[1].content).not.toContain('look at these')
  })

  it('labels a captionless attachment with its filename, as the single-file path always did', () => {
    const drafts = commentDrafts('', [file('a', 'receipt.pdf')])

    expect(drafts).toEqual([
      { content: 'Attached: receipt.pdf', type: 'ATTACHMENT', fileId: 'a' },
    ])
  })

  it('labels every uncaptioned follow-up with its own filename', () => {
    const drafts = commentDrafts('here', [file('a', 'one.png'), file('b', 'two.png')])

    expect(drafts[1].content).toBe('Attached: two.png')
  })
})
