import { test, expect } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

/**
 * A reminder is queued, snoozed and completed, and the server's queue says so
 * at every step (AWTD-1405).
 *
 * On web a reminder reaches people as a notification from the service worker,
 * and its Snooze and Complete buttons call the server from there. Both used to
 * call routes AWTD-839 deleted, so both 404'd. They now send the v1 requests
 * the native apps send (AWTD-1038). Playwright cannot press a system
 * notification's buttons, so this sends those exact requests from the
 * signed-in page, with the session cookie as the worker does, and
 * tests/lib/sw-notification-actions.test.ts pins that public/sw.js sends them.
 * A timer is not proof: everything is read back from /api/v1/reminders.
 */

type ApiReminder = { id: string; type: string; scheduledFor: string; task: { id: string } | null }

const MIN = 60_000

async function postJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

async function remindersFor(request: APIRequestContext, taskId: string): Promise<ApiReminder[]> {
  const body = (await (await request.get('/api/v1/reminders?limit=100')).json()) as { reminders: ApiReminder[] }
  return body.reminders.filter((reminder) => reminder.task?.id === taskId)
}

/** What public/sw.js sends for a notification action: same URL, method, body and cookie. */
async function notificationAction(page: Page, taskId: string, body: unknown): Promise<number> {
  return page.evaluate(
    `fetch('/api/v1/tasks/${taskId}', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: ${JSON.stringify(JSON.stringify(body))},
    }).then((response) => response.status)`,
  ) as Promise<number>
}

test.describe('Reminders (AWTD-1405)', () => {
  test('a due task is reminded, a snooze re-arms the reminder, and completing it clears it', async ({
    page,
    request,
  }) => {
    const { list } = await postJson<{ list: { id: string } }>(request, '/api/v1/lists', {
      name: `Reminders ${Date.now()}`,
      privacy: 'PRIVATE',
    })
    const due = new Date(Date.now() + 120 * MIN)
    const { task } = await postJson<{ task: { id: string } }>(request, '/api/v1/tasks', {
      title: `Remind me ${Date.now()}`,
      listIds: [list.id],
      dueDateTime: due.toISOString(),
    })

    // The due date queues a reminder 15 minutes before it.
    await expect
      .poll(async () => (await remindersFor(request, task.id)).map((r) => r.type).sort())
      .toContain('due_reminder')
    const dueReminder = (await remindersFor(request, task.id)).find((r) => r.type === 'due_reminder')!
    expect(new Date(dueReminder.scheduledFor).getTime()).toBe(due.getTime() - 15 * MIN)

    // Snooze it for an hour from the notification.
    await gotoWithRetry(page, `/lists/${list.id}`)
    const snoozedTo = new Date(Date.now() + 60 * MIN)
    expect(await notificationAction(page, task.id, { reminderTime: snoozedTo.toISOString() })).toBe(200)

    // The queue now holds exactly one reminder, at the snoozed time; the
    // original is no longer pending, so push and email follow the snooze.
    await expect
      .poll(async () => (await remindersFor(request, task.id)).map((r) => new Date(r.scheduledFor).getTime()))
      .toEqual([snoozedTo.getTime()])

    // Completing it from the notification clears the queue.
    expect(await notificationAction(page, task.id, { completed: true })).toBe(200)
    await expect.poll(async () => (await remindersFor(request, task.id)).length).toBe(0)
    const after = (await (await request.get(`/api/v1/tasks/${task.id}`)).json()) as { task: { completed: boolean } }
    expect(after.task.completed).toBe(true)
  })
})
