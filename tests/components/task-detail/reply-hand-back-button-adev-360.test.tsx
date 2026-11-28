/**
 * ADEV-360: the comment composer's one blue button — "Reply, Reassign & Ready". One tap posts
 * what's typed, then hands the task back to whoever asked; a reply that fails keeps the task.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Comment, Task, User } from '@/types/task'

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({
    t: (key: string, replacements?: Record<string, string>) =>
      replacements ? `${key} ${Object.values(replacements).join(' ')}`.trim() : key,
    tArray: () => [],
    locale: 'en',
    messages: null,
  }),
}))

vi.mock('@/components/shared/RichTextInput', () => ({
  RichTextInput: ({ onSend }: { onSend: () => void }) => (
    <button type="button" data-testid="plain-send" onClick={onSend}>send</button>
  ),
}))

const postPendingComments = vi.fn()
vi.mock('@/lib/comment-posting', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/comment-posting')>()),
  postPendingComments: (...args: unknown[]) => postPendingComments(...args),
}))

import { CommentInputBar } from '@/components/task-detail/CommentInputBar'

const me: User = { id: 'me', name: 'Jon', email: 'jon@example.com', createdAt: new Date() }
const agent: User = { id: 'agent', name: 'Claude', email: 'claude@example.com', createdAt: new Date(), isAIAgent: true }
const person: User = { id: 'pat', name: 'Pat', email: 'pat@example.com', createdAt: new Date() }

function asked(by: User): Comment {
  return { id: 'q', content: 'Which one?', type: 'TEXT', author: by, authorId: by.id, taskId: 't1', createdAt: new Date('2026-11-01'), updatedAt: new Date('2026-11-01') }
}

function task(extra: Partial<Task> = {}): Task {
  return { id: 't1', title: 'Q', assigneeId: 'me', assignee: me, completed: false, statusRole: 'doing', comments: [asked(agent)], lists: [], ...extra } as Task
}

function renderBar(t: Task, newComment: string, onUpdate = vi.fn()) {
  render(
    <CommentInputBar
      task={t}
      currentUser={me}
      onUpdate={onUpdate}
      onLocalUpdate={vi.fn()}
      newComment={newComment}
      setNewComment={vi.fn()}
      uploadingFile={false}
      setUploadingFile={vi.fn()}
      attachedFiles={[]}
      setAttachedFiles={vi.fn()}
    />,
  )
  return onUpdate
}

describe('ADEV-360 Reply, Reassign & Ready', () => {
  beforeEach(() => {
    postPendingComments.mockReset()
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ agents: [] }) })))
  })

  it('ADEV-360: an agent asker gets the reply, then the task in Ready', async () => {
    const order: string[] = []
    postPendingComments.mockImplementation(async () => { order.push('reply'); return true })
    const onUpdate = vi.fn(() => { order.push('handBack') })
    renderBar(task(), 'Use B', onUpdate)

    const button = screen.getByTestId('comment-hand-back')
    expect(button.textContent).toContain('tasks.commentsSection.handBack.replyReassignReady')
    expect(button.textContent).toContain('tasks.commentsSection.handBack.to Claude')
    expect(button.getAttribute('aria-label')).toBe('tasks.commentsSection.handBack.handBackTo Claude')

    fireEvent.click(button)
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(order).toEqual(['reply', 'handBack'])
    const sent = onUpdate.mock.calls[0][0] as Task
    expect(sent.assignee?.id).toBe('agent')
    expect(sent.assigneeId).toBe('agent')
    expect(sent.statusRole).toBe('ready')
  })

  it('ADEV-360: a failed reply does not hand the task back', async () => {
    postPendingComments.mockResolvedValue(false)
    const onUpdate = renderBar(task(), 'Use B')
    fireEvent.click(screen.getByTestId('comment-hand-back'))
    await waitFor(() => expect(postPendingComments).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('ADEV-360: nothing typed hands a person back without moving the column', async () => {
    const onUpdate = renderBar(task({ comments: [asked(person)] }), '')
    const button = screen.getByTestId('comment-hand-back')
    expect(button.textContent).toContain('tasks.commentsSection.handBack.reassign')
    expect(button.textContent).not.toContain('Ready')
    fireEvent.click(button)
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(postPendingComments).not.toHaveBeenCalled()
    const sent = onUpdate.mock.calls[0][0] as Task
    expect(sent.assignee?.id).toBe('pat')
    expect(sent.statusRole).toBe('doing')
  })

  it('ADEV-360: no button on a task that is not mine', () => {
    renderBar(task({ assigneeId: 'pat', assignee: person }), 'hi')
    expect(screen.queryByTestId('comment-hand-back')).toBeNull()
  })

  it('ADEV-360: plain Send still only posts', async () => {
    postPendingComments.mockResolvedValue(true)
    const onUpdate = renderBar(task(), 'Use B')
    fireEvent.click(screen.getByTestId('plain-send'))
    await waitFor(() => expect(postPendingComments).toHaveBeenCalled())
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
