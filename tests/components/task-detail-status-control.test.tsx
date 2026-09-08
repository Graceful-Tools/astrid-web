/**
 * RED for task ba1a4c4c.
 *
 * `get_agent_queue` returns a task only when it is assigned to the agent AND
 * carries `statusRole: "ready"`. Assignment is reachable from several places.
 * Ready was reachable from one shape of the UI: the status picker renders only
 * when `usesCompactTaskDetail(displayMode)` — project mode — or when a board is
 * present (components/task-detail.tsx, MainContent/TaskRow.tsx). On an ordinary
 * list, neither the row nor the task detail offered any way to reach it.
 *
 * So a user could follow the published setup end to end — assign a dozen tasks
 * to `claude`, poll the queue — and get `empty: true` forever with nothing
 * anywhere saying what was missing.
 *
 * Note this is NOT the cause the report guessed at. `boardColumnsFor(null)`
 * returns the full column set unconditionally, so Ready does not depend on the
 * list being agent-configured. It depended on the viewer's display mode.
 *
 * The fix puts the status control in the task-detail action menu, which every
 * display mode renders. That was chosen over a fifth field row because the
 * rows are a cross-platform contract Jon set explicitly — Who, Date, Priority,
 * Lists (lib/task-detail-field-order.ts) — and this must not renegotiate it.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TaskActionMenu } from '@/components/task-detail/TaskActionMenu'
import { INBOX_COLUMN_ID } from '@/lib/task-status'
import type { Task, User } from '@/types/task'

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({ t: (key: string) => key }),
}))

/**
 * Radix drives menu selection from POINTER events, and jsdom ships none, so
 * without these the items render and are queryable but clicking one does
 * nothing — a menu that looks right in the DOM and cannot be used.
 */
beforeAll(() => {
  const w = window as unknown as Record<string, unknown>
  w.PointerEvent ??= MouseEvent
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => {}
  proto.releasePointerCapture ??= () => {}
  proto.scrollIntoView ??= () => {}
})

const currentUser = { id: 'u1', email: 'u1@example.com', name: 'Jon' } as User

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Wire the agent queue',
    completed: false,
    statusRole: null,
    priority: 0,
    lists: [{ id: 'list-1', name: 'Astrid Web To-do', privacy: 'PRIVATE' }],
    ...overrides,
  } as unknown as Task
}

/** Open the "..." menu, then its Status submenu. */
async function renderMenu(props: Record<string, unknown> = {}) {
  const user = userEvent.setup()
  const onStatusSelect = vi.fn()
  render(
    <TaskActionMenu
      task={makeTask()}
      currentUser={currentUser}
      reminderDebugMode={false}
      onCopy={vi.fn()}
      onShare={vi.fn()}
      onDelete={vi.fn()}
      onTestReminder={vi.fn()}
      onStatusSelect={onStatusSelect}
      {...props}
    />,
  )
  await user.click(screen.getByRole('button'))
  await user.click(await screen.findByText('tasks.status'))
  return { onStatusSelect, user }
}

/**
 * Activate a menu item by keyboard. Radix selects on pointer events that jsdom
 * only half-implements, so a click lands but never selects; Enter on the
 * focused item is the same code path a keyboard user takes.
 */
async function choose(user: ReturnType<typeof userEvent.setup>, name: string) {
  const item = await screen.findByRole('menuitemradio', { name })
  item.focus()
  await user.keyboard('{Enter}')
}

beforeEach(() => vi.clearAllMocks())

describe('the task action menu can reach Ready', () => {
  it('offers Ready without a board and without project display mode', async () => {
    await renderMenu()

    // The menu is the one surface every display mode renders, so Ready being
    // here is what makes the agent queue reachable at all.
    expect(await screen.findByRole('menuitemradio', { name: 'Ready' })).toBeInTheDocument()
  })

  it('reports the chosen column by its status role, which is what the queue reads', async () => {
    const { onStatusSelect, user } = await renderMenu()

    await choose(user, 'Ready')

    expect(onStatusSelect).toHaveBeenCalledWith('ready')
  })

  it('offers Inbox so a task can be taken back out of the queue', async () => {
    const { onStatusSelect, user } = await renderMenu({ task: makeTask({ statusRole: 'ready' }) })

    await choose(user, 'Inbox')

    expect(onStatusSelect).toHaveBeenCalledWith(INBOX_COLUMN_ID)
  })

  it('marks the column the task is currently in', async () => {
    await renderMenu({ task: makeTask({ statusRole: 'ready' }) })

    expect(await screen.findByRole('menuitemradio', { name: 'Ready' })).toBeChecked()
  })

  it('marks Inbox when the task has no status role', async () => {
    await renderMenu()

    expect(await screen.findByRole('menuitemradio', { name: 'Inbox' })).toBeChecked()
  })

  it('leaves the menu unchanged for callers that do not handle status', async () => {
    // onStatusSelect is optional so existing call sites keep compiling and
    // rendering exactly as before.
    const user = userEvent.setup()
    render(
      <TaskActionMenu
        task={makeTask()}
        currentUser={currentUser}
        reminderDebugMode={false}
        onCopy={vi.fn()}
        onShare={vi.fn()}
        onDelete={vi.fn()}
        onTestReminder={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button'))

    expect(screen.queryByText('tasks.status')).not.toBeInTheDocument()
  })
})
