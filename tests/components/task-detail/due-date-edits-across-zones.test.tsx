/**
 * AWTD-1270 — the detail pane's date and time edits keep the task's calendar day
 * in every zone.
 *
 * All-day dates are stored at UTC midnight of the calendar day (lib/date-comparison.ts,
 * astrid-core `all_day_instant`). The editor got there with `setUTCHours(0,0,0,0)` on
 * whatever instant it held, and combined a picked time with `setHours` on the stored
 * UTC midnight — both of which read the day in the wrong zone:
 *
 * - clearing the time on 08:00 2 Nov in Tokyo (23:00Z on the 1st) stored the 1st;
 * - clearing it on 20:00 2 Nov in Los Angeles (04:00Z on the 3rd) stored the 3rd;
 * - picking 2 Nov in the calendar in Tokyo (local midnight = 15:00Z on the 1st) stored the 1st;
 * - picking 09:30 for an all-day 2 Nov in Los Angeles landed on 1 Nov (D48).
 *
 * The rule: a timed task's day is its LOCAL day, an all-day task's day is its UTC day,
 * and an all-day write is UTC midnight of that day.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskFieldEditors } from '@/components/task-detail/TaskFieldEditors'
import { buildTask, buildUser } from '../../fixtures/domain'

vi.mock('@/components/ui/time-picker', () => ({
  formatConciseTime: () => '9:30 AM',
  TimePicker: ({ onChange }: { onChange: (t: Date | null) => void }) => (
    <div>
      <button onClick={() => onChange(null)}>clear-time</button>
      <button onClick={() => onChange(new Date(2000, 0, 1, 9, 30))}>pick-0930</button>
    </div>
  ),
}))

vi.mock('@/components/ui/calendar', () => ({
  // react-day-picker hands back local midnight of the clicked day.
  Calendar: ({ onSelect }: { onSelect: (d: Date) => void }) => (
    <button onClick={() => onSelect(new Date(2026, 10, 2))}>pick-nov-2</button>
  ),
}))

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

function renderEditors(task: ReturnType<typeof buildTask>, editing: 'time' | 'when') {
  const onUpdate = vi.fn()
  const noop = vi.fn()
  render(
    <TaskFieldEditors
      {...({
        task,
        currentUser: user,
        availableLists: [],
        onUpdate,
        onInviteUser: noop,
        editingTitle: false, setEditingTitle: noop,
        editingDescription: false, setEditingDescription: noop,
        editingWhen: editing === 'when', setEditingWhen: noop,
        editingTime: editing === 'time', setEditingTime: noop,
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
  return onUpdate
}

function written(onUpdate: ReturnType<typeof vi.fn>) {
  expect(onUpdate).toHaveBeenCalledTimes(1)
  const t = onUpdate.mock.calls[0][0]
  return { iso: new Date(t.dueDateTime).toISOString(), isAllDay: t.isAllDay }
}

describe('AWTD-1270: due date edits keep the calendar day across zones', () => {
  let originalTZ: string | undefined
  beforeEach(() => { originalTZ = process.env.TZ })
  afterEach(() => {
    if (originalTZ === undefined) delete process.env.TZ
    else process.env.TZ = originalTZ
  })

  it('AWTD-1270: clearing the time east of UTC stores UTC midnight of the local day', () => {
    process.env.TZ = 'Asia/Tokyo'
    // 08:00 on 2 Nov in Tokyo is 23:00Z on 1 Nov.
    const task = buildTask({ dueDateTime: new Date('2026-11-01T23:00:00Z'), isAllDay: false })
    const onUpdate = renderEditors(task, 'time')
    fireEvent.click(screen.getByText('clear-time'))
    expect(written(onUpdate)).toEqual({ iso: '2026-11-02T00:00:00.000Z', isAllDay: true })
  })

  it('AWTD-1270: clearing the time west of UTC stores UTC midnight of the local day', () => {
    process.env.TZ = 'America/Los_Angeles'
    // 20:00 on 2 Nov in Los Angeles is 04:00Z on 3 Nov.
    const task = buildTask({ dueDateTime: new Date('2026-11-03T04:00:00Z'), isAllDay: false })
    const onUpdate = renderEditors(task, 'time')
    fireEvent.click(screen.getByText('clear-time'))
    expect(written(onUpdate)).toEqual({ iso: '2026-11-02T00:00:00.000Z', isAllDay: true })
  })

  it('AWTD-1270: clearing the time on an all-day task keeps its day', () => {
    process.env.TZ = 'America/Los_Angeles'
    const task = buildTask({ dueDateTime: new Date('2026-11-02T00:00:00Z'), isAllDay: true })
    const onUpdate = renderEditors(task, 'time')
    fireEvent.click(screen.getByText('clear-time'))
    expect(written(onUpdate)).toEqual({ iso: '2026-11-02T00:00:00.000Z', isAllDay: true })
  })

  it('AWTD-1270: a time picked on an all-day task lands on its day west of UTC (D48)', () => {
    process.env.TZ = 'America/Los_Angeles'
    const task = buildTask({ dueDateTime: new Date('2026-11-02T00:00:00Z'), isAllDay: true })
    const onUpdate = renderEditors(task, 'time')
    fireEvent.click(screen.getByText('pick-0930'))
    // 09:30 PST on 2 Nov (DST has ended) is 17:30Z.
    expect(written(onUpdate)).toEqual({ iso: '2026-11-02T17:30:00.000Z', isAllDay: false })
  })

  it('AWTD-1270: a calendar pick east of UTC stores UTC midnight of the picked day', () => {
    process.env.TZ = 'Asia/Tokyo'
    const task = buildTask({ dueDateTime: null, isAllDay: false })
    const onUpdate = renderEditors(task, 'when')
    fireEvent.click(screen.getByText('pick-nov-2'))
    expect(written(onUpdate)).toEqual({ iso: '2026-11-02T00:00:00.000Z', isAllDay: true })
  })
})
