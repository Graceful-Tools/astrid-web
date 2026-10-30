import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'
import { freshList, readList, readTask, row, seedTask, sidebarList } from './utils/v1-seed'

/**
 * A task outlives its list (AWTD-1419).
 *
 * Deleting a list keeps its tasks — the confirmation says so — and they must
 * still open and complete afterwards. Rewrites the pre-AWTD-1338 spec of the
 * same name, which had never run.
 */

async function deleteListInUi(page: Page, listId: string, name: string) {
  await gotoWithRetry(page, `/lists/${listId}`)
  await page.getByRole('button', { name: 'Admin Settings' }).click()
  const settings = page.getByRole('dialog')
  await settings.getByRole('tab', { name: 'Admin Settings' }).click()
  await settings.getByRole('button', { name: 'Delete List' }).click()
  const confirm = page.getByTestId('list-delete-confirm')
  await expect(confirm).toContainText('All tasks in this list will remain')
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(sidebarList(page, name)).toHaveCount(0)
}

test.describe('Tasks of a deleted list (AWTD-1419)', () => {
  test('a task whose only list is deleted is still in My Tasks, and completes', async ({ page, request }) => {
    const list = await freshList(request, 'Doomed list')
    const task = await seedTask(request, [list.id], `Survivor ${Date.now()}`)

    await deleteListInUi(page, list.id, list.name)
    await expect.poll(async () => readList(request, list.id)).toBeNull()
    await expect.poll(async () => (await readTask(request, task.id))?.lists).toEqual([])

    // Find it from My Tasks by search: the owner seat's My Tasks grows with
    // every run of the suite, and past 150 rows the list is virtualized.
    await gotoWithRetry(page, '/')
    await expect(page.getByRole('heading', { level: 1, name: 'My Tasks' })).toBeVisible()
    await page.getByText('Search for tasks and users').first().click()
    await page.getByPlaceholder('Search tasks and users...').first().fill(task.title)
    await row(page, task.title).getByRole('checkbox', { name: 'Mark complete' }).click()
    await expect.poll(async () => (await readTask(request, task.id))?.completed).toBe(true)

    // Its detail still opens, list-less.
    await row(page, task.title).click()
    await expect(page.getByTestId('task-detail-title')).toHaveText(task.title)
  })

  test('a task in two lists keeps the other one when one is deleted', async ({ page, request }) => {
    const doomed = await freshList(request, 'Doomed of two')
    const kept = await freshList(request, 'Kept of two')
    const task = await seedTask(request, [doomed.id, kept.id], `Two homes ${Date.now()}`)

    await deleteListInUi(page, doomed.id, doomed.name)
    await expect.poll(async () => (await readTask(request, task.id))?.lists.map((l) => l.id)).toEqual([kept.id])

    await sidebarList(page, kept.name).click()
    await expect(page.getByRole('heading', { level: 1, name: kept.name })).toBeVisible()
    await row(page, task.title).getByRole('checkbox', { name: 'Mark complete' }).click()
    await expect.poll(async () => (await readTask(request, task.id))?.completed).toBe(true)
  })
})
