import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'
import { OUTSIDER_EMAIL, addMember, detail, freshList, listTasks, row, seat } from './utils/v1-seed'

/**
 * The empty-list state: Astrid with a message that fits the list (AWTD-1419).
 *
 * Rewrites the pre-AWTD-1338 empty-state spec, which had never run. Dropped
 * from it: the animation-class and dark-mode cases (CSS, not behaviour), and
 * the "featured list" case, which was a placeholder that asserted nothing — a
 * featured list is one of at most two suggested public lists in the sidebar,
 * which a test cannot pin. The copy is the en locale's emptyState.* keys.
 */

const emptyState = (page: Page) => page.getByTestId('empty-state')

const PERSONAL = 'Ready to capture your thoughts? Tap add a task to create your first task!'

test.describe('Empty list state (AWTD-1419)', () => {
  test('an empty list shows Astrid; the first task replaces it, deleting the last brings it back', async ({
    page,
    request,
  }) => {
    const list = await freshList(request, 'Empty')
    await gotoWithRetry(page, `/lists/${list.id}`)
    await expect(emptyState(page)).toContainText(PERSONAL)

    const title = `First task ${Date.now()}`
    const quickAdd = page.getByPlaceholder('Add a task...').first()
    await quickAdd.fill(title)
    await quickAdd.press('Enter')
    await expect(row(page, title)).toHaveCount(1)
    await expect(emptyState(page)).toHaveCount(0)
    await expect.poll(async () => (await listTasks(request, list.id)).map((t) => t.title)).toEqual([title])

    await row(page, title).click()
    await detail(page).getByRole('button', { name: 'Task actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    await page.getByTestId('task-delete-confirm').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.poll(async () => (await listTasks(request, list.id)).length).toBe(0)
    await expect(emptyState(page)).toContainText(PERSONAL)
  })

  test('a shared list and a public list each say so', async ({ page, request }) => {
    const shared = await freshList(request, 'Empty shared')
    await addMember(request, shared.id, OUTSIDER_EMAIL)
    await gotoWithRetry(page, `/lists/${shared.id}`)
    await expect(emptyState(page)).toContainText('Start collaborating! Add a task to get this shared list going.')

    const open = await freshList(request, 'Empty public', 'PUBLIC')
    await gotoWithRetry(page, `/lists/${open.id}`)
    await expect(emptyState(page)).toContainText(
      'Share your ideas with the world! Add tasks - anyone can see this public list.',
    )
  })

  test('nothing assigned and nothing due: My Tasks and the Today view say so', async ({ browser }) => {
    // The viewer seat is never given a task by any spec, so its My Tasks is
    // empty by construction; the owner's never is, in a shared test database.
    const viewer = await seat(browser, 'viewer.json')
    try {
      const page = await viewer.newPage()
      await gotoWithRetry(page, '/')
      await expect(page.getByRole('heading', { level: 1, name: 'My Tasks' })).toBeVisible()
      await expect(emptyState(page)).toContainText("You're all caught up! No tasks assigned to you right now. Time to relax!")

      // "d" jumps to the Today view (the "?" hotkey listing).
      await page.keyboard.press('d')
      await expect(emptyState(page)).toContainText('Nothing scheduled for today! Enjoy the free time, or add something new.')
    } finally {
      await viewer.close()
    }
  })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 667 } })

    test('the empty state points down to the add-task bar', async ({ page, request }) => {
      const list = await freshList(request, 'Empty phone')
      await gotoWithRetry(page, `/lists/${list.id}`)
      await expect(emptyState(page)).toContainText(PERSONAL)
      // The hint is md:hidden — phones only.
      await expect(emptyState(page).getByText('Add task', { exact: true })).toBeVisible()
    })
  })
})
