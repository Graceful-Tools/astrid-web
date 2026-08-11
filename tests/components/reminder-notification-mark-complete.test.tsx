/**
 * @vitest-environment jsdom
 */

/**
 * Task cde681e4 — "Mark complete" on a reminder notification never worked.
 *
 * The handler sent PATCH to `/api/tasks/[id]`, and that route exports only
 * GET, PUT and DELETE. In the App Router an unexported method is a 405, so
 * `response.ok` was false every time and the click fell straight into the
 * error path. Not a regression — the route has never had a PATCH handler, so
 * the button has never once completed a task.
 *
 * Switching to legacy PUT would not have fixed it either: that handler rejects
 * a body with no title (`Title is required`), and this caller sends only
 * `{ completed: true }`. `PUT /api/v1/tasks/[id]` does partial updates, so the
 * fix is the v1 path — which is also one call site off the legacy surface
 * (641a7615 step 3).
 *
 * The test asserts the method and path rather than the toast, because the bug
 * was entirely in which endpoint got called.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReminderNotification } from '@/components/reminder-notification'

const toast = vi.fn()
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))

function renderNotification() {
  return render(
    <ReminderNotification
      reminderId="rem-1"
      taskId="task-1"
      taskTitle="Water the plants"
      scheduledFor={new Date('2026-08-09T10:00:00Z')}
      type="due_reminder"
      onDismiss={vi.fn()}
      onSnooze={vi.fn()}
      onComplete={vi.fn()}
    />
  )
}

/** Every request this component makes, in order. */
function fetchCalls() {
  return (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
}

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
  ) as typeof fetch
})

describe('ReminderNotification mark-complete (task cde681e4)', () => {
  it('completes the task with a method the route actually implements', async () => {
    renderNotification()

    await userEvent.click(screen.getByRole('button', { name: /complete/i }))

    await waitFor(() => expect(fetchCalls().length).toBeGreaterThan(0))
    const [url, init] = fetchCalls()[0] as [string, RequestInit]

    expect(String(url)).toContain('task-1')
    // PATCH is a 405 on this resource — the whole bug.
    expect(init.method).not.toBe('PATCH')
    expect(init.method).toBe('PUT')
  })

  it('sends the completion to v1, which accepts a partial update', async () => {
    // Legacy PUT would 400 on this body: it requires a title.
    renderNotification()

    await userEvent.click(screen.getByRole('button', { name: /complete/i }))

    await waitFor(() => expect(fetchCalls().length).toBeGreaterThan(0))
    const [url, init] = fetchCalls()[0] as [string, RequestInit]

    expect(String(url)).toBe('/api/v1/tasks/task-1')
    expect(JSON.parse(String(init.body))).toEqual({ completed: true })
  })
})
