import { test, expect, devices } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

test.use({ ...devices['Pixel 5'] })

type ApiList = { id: string }

async function createJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

test.describe('Mobile 1-column header view rotator (task a1e5c0ff, AWTD-1183)', () => {
  test('one header icon steps list → messages → board when a board is enabled', async ({ page, request }) => {
    const suffix = Date.now()

    // Create a plain list, then turn it into a board via the Create-Board flow.
    const list = await createJson<ApiList>(request, '/api/lists', {
      name: `Unified toggle host ${suffix}`,
      description: '',
      privacy: 'SHARED',
      listType: 'regular',
    })

    await createJson(request, '/api/projects/from-list', {
      listId: list.id,
    })

    await gotoWithRetry(page, `/lists/${list.id}`)

    // One icon, as on iPhone, in place of the old 3-way segmented strip.
    const rotator = page.getByTestId('header-view-rotator')
    await expect(rotator).toBeVisible()
    await expect(page.getByTestId('header-unified-toggle')).toHaveCount(0)

    // List is the default view on a freshly-opened list.
    await expect(rotator).toHaveAttribute('data-current', 'list')

    await rotator.tap()
    await expect(rotator).toHaveAttribute('data-current', 'messages')

    await rotator.tap()
    await expect(rotator).toHaveAttribute('data-current', 'board')

    // And back around to the list.
    await rotator.tap()
    await expect(rotator).toHaveAttribute('data-current', 'list')
  })
})
