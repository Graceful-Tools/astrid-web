/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1653 — on a phone, a board card opens task details (core DS30).
 * AITD-679 — and on every other width too, never by expanding in place.
 *
 * A list row and a board card open task details the same way, through the
 * same handler: a phone pushes the full-screen view, a multi-column board
 * floats the callout beside the card (components/TaskManager/BoardTaskCallout,
 * tested in tests/components/board-task-callout-aitd-679.test.tsx).
 *
 * Expanded in place, the card was replaced by an inline TaskDetail panel, so
 * "did not expand" is asserted as "no inline panel rendered".
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { buildTaskList } from '../fixtures/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectStatusBoard } from '@/components/project-status-board'
import { ThemeProvider } from '@/contexts/theme-context'
import { SettingsProvider } from '@/contexts/settings-context'
import type { Task, TaskList, User } from '@/types/task'

vi.mock('@/contexts/feature-flag-context', () => ({
  useFeatureFlags: () => ({ isEnabled: () => true }),
}))

vi.mock('@/hooks/use-sse-subscription', () => ({
  useSSESubscription: vi.fn(),
}))

vi.mock('@/hooks/use-coding-assignment-detector', () => ({
  useCodingAssignmentDetector: vi.fn(),
}))

vi.mock('@/lib/reminder-manager', () => ({
  useReminders: vi.fn(() => ({ triggerManualReminder: vi.fn() })),
}))

beforeEach(() => {
  ;(Element.prototype as unknown as { scrollTo: unknown }).scrollTo = vi.fn()
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const owner = {
  id: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} as unknown as User

// Rebuilt on tests/fixtures/domain (AWTD-916). The literal these replace
// passed `id`/`name` through twice, carried fields the app-facing types do not
// have, and was held together by `as unknown as` — which is what let all of
// that through.
function makeList(overrides: Partial<TaskList> & { id: string; name: string }): TaskList {
  return buildTaskList({ owner, ownerId: owner.id, ...overrides })
}

const projectId = 'project-1'
const domain = makeList({ id: 'domain', name: 'Astrid Web', projectId, listType: 'regular' })
const status = makeList({
  id: 'ready', name: 'Ready', projectId,
  listType: 'status',
})

const task = {
  id: 'task-1',
  title: 'Card task',
  description: '',
  creator: owner,
  creatorId: 'user-1',
  priority: 0,
  lists: [domain, status],
  isPrivate: false,
  completed: false,
  attachments: [],
  comments: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  repeating: 'never',
  repeatFrom: 'COMPLETION_DATE',
  occurrenceCount: 0,
} as unknown as Task


function renderBoard(props: { isOneColumn: boolean; onOpenTask?: (taskId: string, anchor?: HTMLElement) => void; selectedTaskId?: string | null }) {
  return render(
    <ThemeProvider>
      <SettingsProvider>
      <ProjectStatusBoard
        allTasks={[task]}
        lists={[domain, status]}
        selectedListId={domain.id}
        currentUser={owner}
        onUpdateTask={() => {}}
        onCreateTask={async () => null}
        isOneColumn={props.isOneColumn}
        onOpenTask={props.onOpenTask}
        selectedTaskId={props.selectedTaskId}
      />
      </SettingsProvider>
    </ThemeProvider>,
  )
}

describe('a board card opens task details like a list row (AWTD-1653, core DS30, AITD-679)', () => {
  it('opens the task through the list-row path on a one-column board, without expanding', async () => {
    const u = userEvent.setup()
    const onOpenTask = vi.fn()
    renderBoard({ isOneColumn: true, onOpenTask })

    const card = screen.getByTestId('status-card-task-1')
    await u.click(card)

    expect(onOpenTask).toHaveBeenCalledWith('task-1', card)
    expect(document.querySelector('[data-task-detail-panel]')).toBeNull()
  })

  it('opens it from the keyboard the same way', async () => {
    const u = userEvent.setup()
    const onOpenTask = vi.fn()
    renderBoard({ isOneColumn: true, onOpenTask })

    const card = screen.getByTestId('status-card-task-1')
    card.focus()
    await u.keyboard('{Enter}')

    expect(onOpenTask).toHaveBeenCalledWith('task-1', card)
  })

  it('AITD-679: on a wide board (iPad, desktop) the card opens the same way and never expands in place', async () => {
    const u = userEvent.setup()
    const onOpenTask = vi.fn()
    renderBoard({ isOneColumn: false, onOpenTask })

    const card = screen.getByTestId('status-card-task-1')
    await u.click(card)

    // The card is the callout's anchor, so it is passed along with the id.
    expect(onOpenTask).toHaveBeenCalledWith('task-1', card)
    expect(document.querySelector('[data-task-detail-panel]')).toBeNull()
    expect(screen.getByTestId('status-card-task-1')).toBe(card)
  })

  it('AITD-679: a card carries data-task-id like a row, so click-outside leaves it to open', () => {
    renderBoard({ isOneColumn: false, onOpenTask: vi.fn() })
    expect(screen.getByTestId('status-card-task-1')).toHaveAttribute('data-task-id', 'task-1')
  })

  it('AITD-679: the open card reads as selected, as the open row does', () => {
    renderBoard({ isOneColumn: false, onOpenTask: vi.fn(), selectedTaskId: 'task-1' })
    expect(screen.getByTestId('status-card-task-1').className).toMatch(/\btask-row-selected\b/)
  })
})
