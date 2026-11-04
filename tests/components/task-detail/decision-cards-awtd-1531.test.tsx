/**
 * AWTD-1531: review findings left open on "Decision cards and trade-off grids in comments" (#660).
 *
 * - A card answer that fails to post must leave the composer alone: it never took the draft or
 *   the staged files, so it has nothing to give back.
 * - A link inside an option opens the link; only a click on the card answers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { row } from '../../fixtures/prisma-rows'
import { buildTask, buildUser } from '../../fixtures/domain'
import { CommentSection } from '@/components/task-detail/CommentSection'
import type { Task, User } from '@/types/task'

vi.mock('@/lib/layout-detection', () => ({
  isMobileDevice: vi.fn(() => false),
  isIPadDevice: vi.fn(() => false),
  is1ColumnView: vi.fn(() => false),
}))

const me: User = buildUser({ id: 'user-1', email: 'me@example.com', name: 'Me', image: null })
const agent: User = buildUser({ id: 'agent-1', email: 'agent@example.com', name: 'Claude Agent', image: null })

const DECISION =
  '**Decision:** Where should we go?\n\n- **A.** Lisbon (recommended)\n- **B.** [Cabin](https://example.com/cabin) in the hills'

function taskWithDecision(): Task {
  return buildTask({
    id: 'task-1',
    title: 'Offsite',
    lists: [],
    creator: me,
    creatorId: 'user-1',
    comments: [
      {
        id: 'c-decision',
        content: DECISION,
        type: 'MARKDOWN',
        author: agent,
        authorId: 'agent-1',
        taskId: 'task-1',
        createdAt: new Date('2026-11-03T10:00:00Z'),
        updatedAt: new Date('2026-11-03T10:00:00Z'),
        replies: [],
      },
    ],
  })
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    task: taskWithDecision(),
    currentUser: me,
    onUpdate: vi.fn(),
    newComment: 'my half-written draft',
    setNewComment: vi.fn(),
    uploadingFile: false,
    setUploadingFile: vi.fn(),
    attachedFiles: [],
    setAttachedFiles: vi.fn(),
    replyingTo: null,
    setReplyingTo: vi.fn(),
    replyContent: '',
    setReplyContent: vi.fn(),
    replyAttachedFiles: [],
    setReplyAttachedFiles: vi.fn(),
    uploadingReplyFile: false,
    setUploadingReplyFile: vi.fn(),
    showingActionsFor: null,
    setShowingActionsFor: vi.fn(),
    ...overrides,
  }
}

function postedComments(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/comments') && init?.method === 'POST')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Decision cards (AWTD-1531)', () => {
  it('a card answer that fails to post leaves the draft and staged files alone', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      String(url).includes('/comments') && init?.method === 'POST'
        ? row({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
        : row({ ok: true, json: async () => ({}) }),
    )
    global.fetch = fetchMock as never
    const setNewComment = vi.fn()
    const setAttachedFiles = vi.fn()
    render(<CommentSection {...props({ setNewComment, setAttachedFiles })} />)

    fireEvent.click(screen.getByText('Lisbon'))

    await waitFor(() => expect(postedComments(fetchMock).length).toBeGreaterThan(0))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(setNewComment).not.toHaveBeenCalled()
    expect(setAttachedFiles).not.toHaveBeenCalled()
  })

  it('clicking a link inside an option does not answer', async () => {
    const fetchMock = vi.fn(async () => row({ ok: true, json: async () => ({}) }))
    global.fetch = fetchMock as never
    render(<CommentSection {...props()} />)

    const link = screen.getByText('Cabin').closest('a')!
    link.addEventListener('click', e => e.preventDefault())
    fireEvent.click(link)

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(postedComments(fetchMock)).toHaveLength(0)
  })
})
