/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-56: web drops the "Project" task layout, and completing a task that is
 * not yours — including one nobody owns — asks first.
 *
 * Jon: "remove the 'Project mode' task layout. Now that we open board items in
 * popout it isn't necessary. But show confirmation before completing a task
 * that isn't [assigned to me] (including unassigned)."
 *
 * `taskDisplayMode` stays STORED — iOS, Mac and astrid-core still read and
 * write it, and `project` is still a valid value there. Web simply stops
 * acting on it: a user whose stored value is `project` gets the list layout,
 * where the checkbox on their own task completes it in one tap.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AppearanceSettings from '@/components/Settings/AppearanceSettings'
import { TaskLeadingControl } from '@/components/task-leading-control'
import { PriorityAssigneePicker } from '@/components/priority-assignee-picker'

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({
    t: (key: string, replacements?: Record<string, string>) =>
      replacements
        ? `${key} ${Object.values(replacements).join(' ')}`.trim()
        : key,
  }),
}))
vi.mock('@/contexts/theme-context', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}))
vi.mock('@/components/keyboard-shortcuts-menu', () => ({
  KeyboardShortcutsMenu: () => null,
}))

const ME = 'user-me'

/**
 * A stored `project` value, passed the way an older caller would have. Spread
 * through a cast because the prop no longer exists — which is the point: the
 * control must not act on it even if something still hands it over.
 */
const STORED_PROJECT = { displayMode: 'project' } as object

function tapTheControl(container: HTMLElement) {
  const target = container.querySelector('[class*="cursor-pointer"]')
  expect(target, 'the leading control rendered nothing tappable').toBeTruthy()
  fireEvent.click(target as Element)
}

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ taskDisplayMode: 'project', users: [] }),
  }) as never
})

describe('Appearance offers no task layout choice (ADEV-56)', () => {
  it('does not render the layout selector, even for a user whose stored value is project', async () => {
    render(<AppearanceSettings onNavigate={vi.fn()} />)

    // Wait for the stored settings to load, so a selector that only appears
    // after the fetch would be caught too.
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())

    expect(screen.queryByText('settingsPages.appearancePage.taskDisplayMode.title')).toBeNull()
    expect(screen.queryByText('settingsPages.appearancePage.taskDisplayMode.project')).toBeNull()
  })
})

describe('the leading control is always the list layout on web (ADEV-56)', () => {
  it('completes your own task on a checkbox tap, whatever the stored layout', () => {
    const onToggleComplete = vi.fn()
    const onOpenOptions = vi.fn()
    const { container } = render(
      <TaskLeadingControl
        assigneeId={ME}
        currentUserId={ME}
        completed={false}
        priority={0}
        onToggleComplete={onToggleComplete}
        onOpenOptions={onOpenOptions}
        {...STORED_PROJECT}
      />,
    )

    tapTheControl(container)

    expect(onToggleComplete).toHaveBeenCalledTimes(1)
    expect(onOpenOptions).not.toHaveBeenCalled()
  })

  it('still opens the options sheet from an unassigned task\'s mark (AWTD-919)', () => {
    const onToggleComplete = vi.fn()
    const onOpenOptions = vi.fn()
    const { container } = render(
      <TaskLeadingControl
        assigneeId={null}
        currentUserId={ME}
        completed={false}
        priority={0}
        onToggleComplete={onToggleComplete}
        onOpenOptions={onOpenOptions}
      />,
    )

    tapTheControl(container)

    expect(onOpenOptions).toHaveBeenCalledTimes(1)
    expect(onToggleComplete).not.toHaveBeenCalled()
  })
})

describe('completing a task that is not yours asks first (ADEV-56)', () => {
  it('an unassigned mark with no sheet to open asks rather than completing', () => {
    const onToggleComplete = vi.fn()
    const { container } = render(
      <TaskLeadingControl
        assigneeId={null}
        currentUserId={ME}
        completed={false}
        priority={0}
        onToggleComplete={onToggleComplete}
      />,
    )

    tapTheControl(container)

    expect(onToggleComplete).not.toHaveBeenCalled()
    expect(screen.getByText('tasks.confirmCompleteUnassigned')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'common.complete' }))
    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })

  it('the options sheet\'s Complete asks for an unassigned task, and says nobody owns it', () => {
    const onToggleComplete = vi.fn()
    render(
      <PriorityAssigneePicker
        isOpen
        onClose={vi.fn()}
        onSelect={vi.fn()}
        selectedPriority={0}
        selectedAssignee={null}
        availableUsers={[]}
        currentUserId={ME}
        completed={false}
        onToggleComplete={onToggleComplete}
      />,
    )

    // Since ADEV-71 the sheet opens on the question itself: it says nobody owns
    // the task before anything is pressed, and Cancel completes nothing.
    expect(screen.getByText('tasks.confirmCompleteUnassigned')).toBeTruthy()

    fireEvent.click(screen.getByTestId('task-options-complete-cancel'))
    expect(onToggleComplete).not.toHaveBeenCalled()
  })

  it('reopening an unassigned task never asks', () => {
    const onToggleComplete = vi.fn()
    const { container } = render(
      <TaskLeadingControl
        assigneeId={null}
        currentUserId={ME}
        completed
        priority={0}
        onToggleComplete={onToggleComplete}
      />,
    )

    tapTheControl(container)

    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })
})
