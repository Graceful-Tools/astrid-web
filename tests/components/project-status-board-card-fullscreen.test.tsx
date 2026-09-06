/**
 * @vitest-environment jsdom
 */

/**
 * Task 52bf1efb — a board card's expanded task details can go full screen.
 *
 * When the full-screen toggle shipped (task 0ea0b818) the inline/board panel
 * was deliberately excluded — `canFullScreen = !inline && allowFullScreen` —
 * on the reasoning that a card is a peek, not a pane. This task overrides that
 * call, so the guard is what changes; passing `allowFullScreen` from the board
 * alone would still be blocked by `!inline`.
 *
 * The trap worth testing for: `absolute inset-0` is what the desktop pane uses,
 * and it works there only because an ancestor (`.task-panel-desktop`) expands
 * to the viewport underneath it. A board card has no such ancestor, so the same
 * class would size the "full screen" panel to the card. These tests assert the
 * inline case positions against the VIEWPORT, which is the thing that would
 * silently be wrong.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
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

function makeList(overrides: Partial<TaskList> & { id: string; name: string }): TaskList {
  return {
    id: overrides.id,
    name: overrides.name,
    privacy: 'PRIVATE',
    owner,
    ownerId: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lists: [],
    ...overrides,
  } as unknown as TaskList
}

const projectId = 'project-1'
const domain = makeList({ id: 'domain', name: 'Astrid Web', projectId, listType: 'regular' })
const status = makeList({
  id: 'ready', name: 'Ready', projectId,
  listType: 'status', statusRole: 'ready', statusOrder: 0,
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

function renderBoard() {
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
        onCreateTask={async () => {}}
      />
      </SettingsProvider>
    </ThemeProvider>,
  )
}

/** Expand the card so its inline TaskDetail renders. */
async function expandCard(u: ReturnType<typeof userEvent.setup>) {
  const card = screen.getByTestId('status-card-task-1')
  await u.click(card)
}

async function enterFullScreen(u: ReturnType<typeof userEvent.setup>) {
  const trigger = document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')
  expect(trigger).not.toBeNull()
  await u.click(trigger!)
  await u.click(screen.getByRole('menuitem', { name: 'Full screen' }))
}

describe('Board card task details — full screen (task 52bf1efb)', () => {
  it('offers full screen from the expanded card action menu (AWTD-754)', async () => {
    const u = userEvent.setup()
    renderBoard()
    await expandCard(u)

    expect(screen.queryByLabelText('Full screen')).not.toBeInTheDocument()
    const trigger = document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')
    expect(trigger).not.toBeNull()
    await u.click(trigger!)
    expect(screen.getByRole('menuitem', { name: 'Full screen' })).toBeInTheDocument()
  })

  it('expands against the viewport, not the card', async () => {
    const u = userEvent.setup()
    renderBoard()
    await expandCard(u)
    await enterFullScreen(u)

    const panel = document.querySelector('[data-task-detail-panel][data-fullscreen="true"]')
    expect(panel).toBeTruthy()

    // The desktop pane's `.task-panel-expanded` is `absolute inset-0`, which
    // works only because `.task-panel-desktop` expands to the viewport
    // underneath it. Used from a card it would size the "full screen" panel to
    // the card — a control that visibly does nothing. The inline case must use
    // the viewport-positioned class instead.
    //
    // jsdom does not load the stylesheet, so this asserts WHICH class is used
    // rather than the resulting geometry. The geometry itself was measured in a
    // real browser with Playwright; see the task's completion report.
    expect(panel!.className).toMatch(/\btask-panel-expanded-viewport\b/)
    expect(panel!.className).not.toMatch(/\btask-panel-expanded\b(?!-)/)

    // The root also drops its trailing `relative`: Tailwind emits `.relative`
    // after `.fixed`, so leaving it would quietly win and pin the panel back
    // into the card. That exact ordering bug cost a debugging session on the
    // desktop pane (task 0ea0b818).
    expect(panel!.className).not.toMatch(/\brelative\b/)
  })

  it('drops back to the card when toggled off', async () => {
    const u = userEvent.setup()
    renderBoard()
    await expandCard(u)

    await enterFullScreen(u)
    expect(document.querySelector('[data-fullscreen="true"]')).toBeTruthy()

    await u.click(screen.getByLabelText('Exit full screen'))
    expect(document.querySelector('[data-fullscreen="true"]')).toBeNull()
    // and the card's own inline panel is still there
    expect(screen.getByTestId('status-card-task-1')).toBeInTheDocument()
  })
})
