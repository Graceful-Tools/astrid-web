import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'
import { freshList, row, seedTask } from './utils/v1-seed'

/**
 * A repeating task, completed in the UI (ADEV-297).
 *
 * Every other spec seeds `repeating: 'never'`, so nothing drove the roll-forward through the app:
 * completing a daily task keeps the same task, takes the check off it, moves its date on a day and
 * counts the occurrence. The roll-forward is read back from the API, so a pass means it was saved.
 */

type Rolled = { completed: boolean; dueDateTime: string | null; occurrenceCount: number }

async function readRolled(request: APIRequestContext, id: string): Promise<Rolled> {
  const response = await request.get(`/api/v1/tasks/${id}`)
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { task: Rolled }).task
}

const DAY_MS = 24 * 60 * 60 * 1000

test.describe('Repeating tasks (ADEV-297)', () => {
  test('completing a daily repeating task rolls it to the next day and counts the occurrence', async ({
    page,
    request,
  }) => {
    const list = await freshList(request, 'Repeating')
    // Repeating from the due date makes the next date exactly one day on, whatever the clock says.
    const due = new Date(Date.now() - DAY_MS)
    due.setUTCMinutes(0, 0, 0)
    const task = await seedTask(request, [list.id], `Daily ${Date.now()}`, {
      repeating: 'daily',
      repeatFrom: 'DUE_DATE',
      dueDateTime: due.toISOString(),
    })
    const before = await readRolled(request, task.id)
    expect(before.occurrenceCount).toBe(0)

    await gotoWithRetry(page, `/lists/${list.id}`)
    await row(page, task.title).getByRole('checkbox', { name: 'Mark complete' }).click()

    await expect.poll(async () => (await readRolled(request, task.id)).occurrenceCount).toBe(1)
    const after = await readRolled(request, task.id)
    expect(after.completed).toBe(false)
    expect(new Date(after.dueDateTime!).getTime() - due.getTime()).toBe(DAY_MS)

    // After a reload it is still one open task, not a completed one plus a copy.
    await gotoWithRetry(page, `/lists/${list.id}`)
    await expect(row(page, task.title)).toHaveCount(1)
    await expect(row(page, task.title).getByRole('checkbox', { name: 'Mark complete' })).toBeVisible()
  })

  test('a task that never repeats stays completed', async ({ page, request }) => {
    const list = await freshList(request, 'Not repeating')
    const task = await seedTask(request, [list.id], `Once ${Date.now()}`)

    await gotoWithRetry(page, `/lists/${list.id}`)
    await row(page, task.title).getByRole('checkbox', { name: 'Mark complete' }).click()

    await expect.poll(async () => (await readRolled(request, task.id)).completed).toBe(true)
    expect((await readRolled(request, task.id)).occurrenceCount).toBe(0)
  })
})
