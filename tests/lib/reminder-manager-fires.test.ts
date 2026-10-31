import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildTask } from '../fixtures/domain'
import { reminderManager } from '@/lib/reminder-manager'

// AWTD-1418: checkReminders found a due reminder, logged "task data needed" and
// skipped it, so the in-app popover could never fire. And nothing scheduled
// from reminderTime, so the only source was a due date.
describe('reminder manager fires due reminders (AWTD-1418)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-31T12:00:00Z'))
    reminderManager.clearAllReminders()
  })
  afterEach(() => {
    reminderManager.clearAllReminders()
    vi.useRealTimers()
  })

  it('shows a popover reminder once a due-date reminder time arrives', () => {
    const task = buildTask({ id: 't1', dueDateTime: new Date('2026-10-31T12:30:00Z') })
    reminderManager.scheduleTaskReminders(task, 'u1')
    expect(reminderManager.getActiveReminders('u1')).toHaveLength(0)

    vi.setSystemTime(new Date('2026-10-31T12:16:00Z'))
    reminderManager.checkNow()

    const active = reminderManager.getActiveReminders('u1')
    expect(active).toHaveLength(1)
    expect(active[0].task.id).toBe('t1')
  })

  it('schedules from reminderTime, not only from the due date', () => {
    const task = buildTask({ id: 't2', dueDateTime: null, reminderTime: new Date('2026-10-31T12:05:00Z') })
    reminderManager.scheduleTaskReminders(task, 'u1')

    vi.setSystemTime(new Date('2026-10-31T12:06:00Z'))
    reminderManager.checkNow()

    expect(reminderManager.getActiveReminders('u1').map(r => r.task.id)).toEqual(['t2'])
  })

  it('does not resurrect a long-past reminderTime on page load', () => {
    const task = buildTask({ id: 't3', dueDateTime: null, reminderTime: new Date('2026-10-30T09:00:00Z') })
    reminderManager.scheduleTaskReminders(task, 'u1')
    reminderManager.checkNow()
    expect(reminderManager.getActiveReminders('u1')).toHaveLength(0)
  })

  it('does not show a reminder for a completed task', () => {
    const task = buildTask({ id: 't4', completed: true, reminderTime: new Date('2026-10-31T12:05:00Z') })
    reminderManager.updateTaskReminders(task, 'u1')
    vi.setSystemTime(new Date('2026-10-31T12:06:00Z'))
    reminderManager.checkNow()
    expect(reminderManager.getActiveReminders('u1')).toHaveLength(0)
  })
})
