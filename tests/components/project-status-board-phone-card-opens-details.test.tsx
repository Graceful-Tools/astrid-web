/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1653 — on a phone, a board card opens task details (core DS30).
 *
 * In a one-pane view a list row and a board card open task details the same
 * way: the ordinary full-screen push, never a card expanding in place. List
 * rows already did; cards expanded inline at every width. The wide board keeps
 * its in-place expansion, which DS30 does not cover.
 *
 * Expanded in place, the card is replaced by an inline TaskDetail panel, so
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


function renderBoard(props: { isOneColumn: boolean; onOpenTask?: (taskId: string) => void }) {
  return render(
    <ThemeProvider>
      <SettingsProvider>
      <ProjectStatusBoard
        allTasks={[task]}
        lists={[domain, status]}
        selectedListId={domain.id}
        currentUser={owner}
        onUpdateTask={() => {}}
        onDeleteTask={() => {}}
        onCreateTask={async () => null}
        isOneColumn={props.isOneColumn}
        onOpenTask={props.onOpenTask}
      />
      </SettingsProvider>
    </ThemeProvider>,
  )
}

describe('a board card on a phone opens task details (AWTD-1653, core DS30)', () => {
  it('opens the task through the list-row path on a one-column board, without expanding', async () => {
    const u = userEvent.setup()
    const onOpenTask = vi.fn()
    renderBoard({ isOneColumn: true, onOpenTask })

    await u.click(screen.getByTestId('status-card-task-1'))

    expect(onOpenTask).toHaveBeenCalledWith('task-1')
    expect(screen.getByTestId('status-card-task-1')).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('[data-task-detail-panel]')).toBeNull()
  })

  it('opens it from the keyboard the same way', async () => {
    const u = userEvent.setup()
    const onOpenTask = vi.fn()
    renderBoard({ isOneColumn: true, onOpenTask })

    screen.getByTestId('status-card-task-1').focus()
    await u.keyboard('{Enter}')

    expect(onOpenTask).toHaveBeenCalledWith('task-1')
    expect(screen.getByTestId('status-card-task-1')).toHaveAttribute('aria-expanded', 'false')
  })

  it('still expands the card in place on a wide board', async () => {
    const u = userEvent.setup()
    const onOpenTask = vi.fn()
    renderBoard({ isOneColumn: false, onOpenTask })

    await u.click(screen.getByTestId('status-card-task-1'))

    expect(onOpenTask).not.toHaveBeenCalled()
    expect(document.querySelector('[data-task-detail-panel]')).not.toBeNull()
  })
})
