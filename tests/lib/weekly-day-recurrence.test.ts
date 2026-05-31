import { describe, it, expect } from 'vitest'
import { parseTaskInput } from '@/lib/task-manager-utils'
import { mapTaskDataForApi } from '@/lib/task-creation-utils'

/**
 * Task 713399d4 — "weekly Monday exercise" should create a *repeating* task,
 * not just a Monday due date.
 *
 * This locks in the full web create path that was previously only covered at
 * the parser level: parseTaskInput → mapTaskDataForApi (the exact payload sent
 * to POST /api/tasks). The earlier symptom (title kept "weekly", no repeat)
 * would regress this test, since it asserts the API payload carries
 * repeating:'custom' + the weekday pattern that the recurrence engine needs.
 */
describe('weekly + day natural language → repeating API payload (task 713399d4)', () => {
  const session = { user: { id: 'u1' } }

  function payloadFor(input: string) {
    const parsed = parseTaskInput(input, 'my-tasks', session, [])
    return {
      parsed,
      api: mapTaskDataForApi({
        title: parsed.title,
        description: '',
        listIds: [],
        priority: parsed.priority,
        dueDateTime: parsed.dueDateTime || undefined,
        isAllDay: false,
        assigneeId: parsed.assigneeId,
        repeating: parsed.repeating,
        isPrivate: parsed.isPrivate,
        customRepeatingData: parsed.customRepeatingData || null,
      } as never),
    }
  }

  it('strips "weekly Monday" from the title, leaving only the task name', () => {
    const { parsed } = payloadFor('weekly Monday exercise')
    expect(parsed.title).toBe('exercise')
  })

  it('sends repeating:"custom" with the Monday weekday to the API', () => {
    const { api } = payloadFor('weekly Monday exercise')
    expect(api.repeating).toBe('custom')
    expect(api.customRepeatingData).not.toBeNull()
    expect(api.customRepeatingData?.unit).toBe('weeks')
    expect(api.customRepeatingData?.weekdays).toEqual(['monday'])
  })

  it('also sets the next Monday as the due date (so both date AND repeat are set)', () => {
    const { api } = payloadFor('weekly Monday exercise')
    expect(api.dueDateTime).toBeTruthy()
    // The parsed due date must land on a Monday (getUTCDay/getDay both = 1 here).
    const due = new Date(api.dueDateTime as string)
    expect(due.getDay()).toBe(1)
  })

  it('handles multiple days: "weekly Monday and Thursday standup"', () => {
    const { parsed, api } = payloadFor('weekly Monday and Thursday standup')
    expect(parsed.title).toBe('standup')
    expect(api.repeating).toBe('custom')
    expect(api.customRepeatingData?.weekdays).toEqual(['monday', 'thursday'])
  })
})
