/**
 * AWTD-1274 — an all-day task "reverts to 4pm" in Pacific time.
 *
 * All-day dates are stored at UTC midnight of their day, which is 5pm (PDT) or 4pm
 * (PST) the evening before in Los Angeles. The time editor handed that instant to the
 * TimePicker as its value, so an all-day task's picker read "4pm": choosing "All day"
 * saved correctly, and the next look at the time showed 4pm again.
 *
 * An all-day task has no time, so the picker must show none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskFieldEditors } from '@/components/task-detail/TaskFieldEditors'
import { buildTask, buildUser } from '../../fixtures/domain'

vi.mock('@/components/user-picker', () => ({ UserPicker: () => null }))
vi.mock('@/components/custom-repeating-editor', () => ({ CustomRepeatingEditor: () => null }))
vi.mock('@/hooks/shared/useMobileKeyboard', () => ({
  useMobileKeyboard: () => ({
    keyboardVisible: false,
    viewportHeight: 800,
    shouldPreventFocus: false,
    needsProtection: false,
    shouldIgnoreTouch: false,
    focusProtectionThreshold: 300,
  }),
}))

const user = buildUser({ id: 'user-1', email: 'test@example.com', name: 'Test User' })

function renderTimeEditor(task: ReturnType<typeof buildTask>) {
  const noop = vi.fn()
  render(
    <TaskFieldEditors
      {...({
        task,
        currentUser: user,
        availableLists: [],
        onUpdate: noop,
        onInviteUser: noop,
        editingTitle: false, setEditingTitle: noop,
        editingDescription: false, setEditingDescription: noop,
        editingWhen: false, setEditingWhen: noop,
        editingTime: true, setEditingTime: noop,
        editingPriority: false, setEditingPriority: noop,
        editingRepeating: false, setEditingRepeating: noop,
        editingLists: false, setEditingLists: noop,
        editingAssignee: false, setEditingAssignee: noop,
        assigneeRef: { current: null },
        descriptionRef: { current: null },
        descriptionTextareaRef: { current: null },
        tempTitle: task.title, setTempTitle: noop,
        tempDescription: '', setTempDescription: noop,
        tempWhen: task.dueDateTime ? new Date(task.dueDateTime) : undefined, setTempWhen: noop,
        tempPriority: 0, setTempPriority: noop,
        tempRepeating: 'never', setTempRepeating: noop,
        tempRepeatingData: undefined, setTempRepeatingData: noop,
        tempLists: [], setTempLists: noop,
      } as any)}
    />,
  )
  return screen.getByTestId('when-time')
}

describe('AWTD-1274: an all-day task shows no time in the time editor', () => {
  let originalTZ: string | undefined
  beforeEach(() => { originalTZ = process.env.TZ; process.env.TZ = 'America/Los_Angeles' })
  afterEach(() => {
    if (originalTZ === undefined) delete process.env.TZ
    else process.env.TZ = originalTZ
  })

  it('AWTD-1274: an all-day task after DST ends does not read 4pm', () => {
    const task = buildTask({ dueDateTime: new Date('2026-11-10T00:00:00Z'), isAllDay: true })
    const row = renderTimeEditor(task)
    expect(row.textContent).not.toMatch(/\d(:\d\d)?\s?pm/i)
  })

  it('AWTD-1274: an all-day task during DST does not read 5pm', () => {
    const task = buildTask({ dueDateTime: new Date('2026-10-20T00:00:00Z'), isAllDay: true })
    const row = renderTimeEditor(task)
    expect(row.textContent).not.toMatch(/\d(:\d\d)?\s?pm/i)
  })

  it('AWTD-1274: a timed task still shows its own time', () => {
    // 9:30 PDT on 20 Oct is 16:30Z.
    const task = buildTask({ dueDateTime: new Date('2026-10-20T16:30:00Z'), isAllDay: false })
    const row = renderTimeEditor(task)
    expect(row.textContent).toContain('9:30am')
  })
})
