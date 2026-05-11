import { test, expect, devices } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

test.use({ ...devices['Pixel 5'] })

type ApiList = { id: string }
type ApiProject = { id: string }

async function createJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

test.describe('Mobile 1-column unified header toggle (task a1e5c0ff)', () => {
  test('renders a single 3-way List / Board / Messages segmented control when a board is enabled', async ({ page, request }) => {
    const suffix = Date.now()

    const project = await createJson<ApiProject>(request, '/api/projects', {
      name: `Unified toggle ${suffix}`,
      description: '',
    })

    const list = await createJson<ApiList>(request, '/api/lists', {
      name: `Unified toggle host ${suffix}`,
      description: '',
      privacy: 'SHARED',
      projectId: project.id,
      listType: 'regular',
    })

    await gotoWithRetry(page, `/lists/${list.id}`)

    // The unified toggle replaces the old List/Board control + separate
    // ChatToggle icon on 1-col.
    const toggle = page.getByTestId('header-unified-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle.locator('[data-segment="list"]')).toBeVisible()
    await expect(toggle.locator('[data-segment="board"]')).toBeVisible()
    await expect(toggle.locator('[data-segment="messages"]')).toBeVisible()

    // List is the default active segment on a freshly-opened list.
    await expect(toggle.locator('[data-segment="list"]')).toHaveAttribute('aria-pressed', 'true')

    // Tapping Board flips the press state.
    await toggle.locator('[data-segment="board"]').tap()
    await expect(toggle.locator('[data-segment="board"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(toggle.locator('[data-segment="list"]')).toHaveAttribute('aria-pressed', 'false')

    // Tapping Messages flips to the chat panel.
    await toggle.locator('[data-segment="messages"]').tap()
    await expect(toggle.locator('[data-segment="messages"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(toggle.locator('[data-segment="board"]')).toHaveAttribute('aria-pressed', 'false')

    // Tapping List returns to the tasks panel + list view.
    await toggle.locator('[data-segment="list"]').tap()
    await expect(toggle.locator('[data-segment="list"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(toggle.locator('[data-segment="messages"]')).toHaveAttribute('aria-pressed', 'false')
  })
})
