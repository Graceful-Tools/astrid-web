import { test, expect, devices } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

test.use({ ...devices['Pixel 5'] })

type ApiList = { id: string; name: string }
type ApiTask = { id: string; title: string }

async function createJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

test.describe('Mobile 1-column: header stays on list name when tapping a task row (bug 35c1ad50)', () => {
  test('tapping a task row keeps the list name in the header — does NOT swap to the task title', async ({ page, request }) => {
    const suffix = Date.now()
    const listName = `Header anchor ${suffix}`
    const taskTitle = `Tap me ${suffix}`

    const list = await createJson<ApiList>(request, '/api/lists', {
      name: listName,
      description: '',
      privacy: 'PRIVATE',
    })

    const task = await createJson<ApiTask>(request, '/api/tasks', {
      title: taskTitle,
      description: '',
      listIds: [list.id],
      priority: 0,
      repeating: 'never',
    })

    await gotoWithRetry(page, `/lists/${list.id}`)

    const header = page.locator('[data-tour-id="task-list-header"], header').first()
    // Sanity check: on the list view the list name is in the header.
    await expect(page.getByText(listName, { exact: false }).first()).toBeVisible()

    // Tap the task row to navigate to its detail in 1-column mobile.
    await page.getByText(taskTitle, { exact: false }).first().tap()

    // The list name MUST still be visible in the chrome (header).
    await expect(page.getByText(listName, { exact: false }).first()).toBeVisible()
    // And the task title MUST NOT appear in the top header. (It can still
    // appear in the detail body — we limit the assertion to the header.)
    if ((await header.count()) > 0) {
      await expect(header.getByText(taskTitle, { exact: false })).toHaveCount(0)
    }
    // And the back button now exists (regression for the leading-button swap).
    await expect(page.getByTestId('mobile-header-back')).toBeVisible()
  })
})
