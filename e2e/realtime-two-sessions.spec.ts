import { test, expect } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'
import { addMember, freshList, OUTSIDER_EMAIL, row, seat, seedTask } from './utils/v1-seed'

/**
 * Realtime across two sessions (ADEV-297).
 *
 * Two people have the same list open. One edits, and the other sees it with no reload: the change
 * reaches them over the SSE stream (/api/sse). Nothing exercised that end to end before.
 */

test.describe('Realtime across two sessions (ADEV-297)', () => {
  test('a new task, a rename and a completion in one session appear in the other without a reload', async ({
    page,
    request,
    browser,
  }) => {
    const list = await freshList(request, 'Realtime')
    await addMember(request, list.id, OUTSIDER_EMAIL)
    const existing = await seedTask(request, [list.id], `Existing ${Date.now()}`)
    const completable = await seedTask(request, [list.id], `Completable ${Date.now()}`)

    const other = await seat(browser, 'outsider.json')
    try {
      const watcher = await other.newPage()
      // The stream is open before anything changes, so what follows can only arrive over it.
      const streamOpen = watcher.waitForResponse(r => new URL(r.url()).pathname === '/api/sse')
      await gotoWithRetry(watcher, `/lists/${list.id}`)
      await streamOpen
      await expect(row(watcher, existing.title)).toHaveCount(1)
      // A reload would clear this; it is how the test knows the page was never reloaded.
      await watcher.evaluate(() => {
        ;(window as unknown as { __noReload: boolean }).__noReload = true
      })

      // The owner adds a task with quick add.
      await gotoWithRetry(page, `/lists/${list.id}`)
      const title = `Added live ${Date.now()}`
      const quickAdd = page.getByPlaceholder('Add a task...').first()
      await quickAdd.fill(title)
      await quickAdd.press('Enter')
      await expect(row(page, title)).toHaveCount(1)
      await expect(row(watcher, title)).toHaveCount(1, { timeout: 15_000 })

      // The owner renames the existing task.
      const renamed = `${existing.title} (renamed)`
      await row(page, existing.title).click()
      await page.getByTestId('task-detail-title').click()
      const titleInput = page.getByTestId('task-detail-title-input')
      await titleInput.fill(renamed)
      await titleInput.press('Enter')
      await expect(row(watcher, renamed)).toHaveCount(1, { timeout: 15_000 })
      await expect(row(watcher, existing.title)).toHaveCount(1) // the one row, renamed in place

      // The owner completes the other task from its row. A different task on purpose: the list
      // hook drops a second update to the same task within 500ms (handleTaskUpdated's dedup), so
      // a rename then a completion in quick succession is lost. That is filed as its own bug.
      await row(page, completable.title).getByRole('checkbox', { name: 'Mark complete' }).click()
      await expect(watcher.locator('.task-row-completed').filter({ hasText: completable.title })).toHaveCount(1, {
        timeout: 15_000,
      })

      expect(await watcher.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
    } finally {
      await other.close()
    }
  })
})
