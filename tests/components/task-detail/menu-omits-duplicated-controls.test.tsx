/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1252 — "Remove status and copy task id from web task details context
 * menu."
 *
 * Taken as *remove the duplicates*, not *remove the controls*, because each one
 * is the only control in a case the detail rows do not cover:
 *
 * - **Status.** `TaskDetailBoardStateRow` needs the task to be on a project
 *   list and the mode not to be `project`. For a task on an ordinary list the
 *   menu is the only way to reach `statusRole: "ready"` — which is exactly what
 *   `get_agent_queue` requires, and what task ba1a4c4c put the control here
 *   for: a user could otherwise assign a dozen tasks to an agent and get
 *   `empty: true` for ever with nothing saying why.
 * - **Copy task id.** `TaskDetailIdentifierRow` needs a project list too, and
 *   lib/task-identifier-links.ts states the menu's rule in as many words:
 *   "Copy task id is offered whenever an id exists, shown or not."
 *
 * So the pane decides: where it shows the control itself, the menu omits it.
 * These pin both directions, since getting the second one wrong is a silent
 * regression — a menu that looks tidier and has lost its only path to Ready.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Task, User } from '@/types/task'

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({ t: (key: string) => key }),
}))
const toast = vi.fn()
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))
vi.mock('@/contexts/feature-flag-context', () => ({
  useFeatureFlags: () => ({ isEnabled: () => true }),
}))

import { TaskActionMenu } from '@/components/task-detail/TaskActionMenu'

/** Radix drives its menu from pointer events, and jsdom ships none. */
beforeAll(() => {
  const w = window as unknown as Record<string, unknown>
  w.PointerEvent ??= MouseEvent
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => {}
  proto.releasePointerCapture ??= () => {}
  proto.scrollIntoView ??= () => {}
})

const currentUser: User = {
  id: 'u1',
  email: 'u@example.com',
  name: 'U',
  createdAt: new Date(),
} as User

const task = {
  id: 't1',
  title: 'A task',
  identifier: 'AWTD-1252',
  completed: false,
  lists: [{ id: 'board', name: 'Board', privacy: 'PRIVATE' }],
} as unknown as Task

function renderMenu(over: Record<string, unknown> = {}) {
  return render(
    <TaskActionMenu
      task={task}
      currentUser={currentUser}
      onCopy={() => {}}
      onShare={() => {}}
      onDelete={() => {}}
      onTestReminder={() => {}}
      reminderDebugMode={false}
      {...over}
    />,
  )
}

/** Open the menu the way a user does. */
async function open() {
  const userEvent = (await import('@testing-library/user-event')).default
  await userEvent.click(screen.getByLabelText('Task actions'))
}

describe('the menu omits what the pane already shows (AWTD-1252)', () => {
  beforeEach(() => toast.mockClear())

  it('omits "copy task id" when the identifier row shows it', async () => {
    renderMenu({ hideCopyIdentifier: true })
    await open()
    expect(screen.queryByText('tasks.taskId.copy')).toBeNull()
  })

  it('keeps "copy task id" when the row does not render it', async () => {
    // The ordinary-list case: no identifier row, so this is the only way to
    // copy an id.
    renderMenu({ hideCopyIdentifier: false })
    await open()
    expect(screen.getByText('tasks.taskId.copy')).toBeTruthy()
  })

  it('omits the status submenu when the board-state row shows it', async () => {
    // The pane withholds onStatusSelect, which is what hides the submenu.
    renderMenu({ onStatusSelect: undefined })
    await open()
    expect(screen.queryByText('tasks.status')).toBeNull()
  })

  it('keeps the status submenu when nothing else offers it (ba1a4c4c)', async () => {
    renderMenu({ onStatusSelect: () => {} })
    await open()
    expect(screen.getByText('tasks.status')).toBeTruthy()
  })

  it('still offers the actions that were never duplicated', async () => {
    renderMenu({ hideCopyIdentifier: true, onStatusSelect: undefined })
    await open()
    expect(screen.getByText('Copy')).toBeTruthy()
    expect(screen.getByText('Share')).toBeTruthy()
  })
})
