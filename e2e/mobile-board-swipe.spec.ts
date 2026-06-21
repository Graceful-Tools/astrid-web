import { test, expect, devices } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

test.use({ ...devices['Pixel 5'] })

type ApiList = {
  id: string
  name: string
  projectId?: string | null
  listType?: string | null
}

async function createJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

test.describe('Mobile board view — body swipe does not change the header', () => {
  test('swipe-left on the board carousel keeps you on the board view', async ({ page, request }) => {
    const suffix = Date.now()
    // Turn a plain list into a board via the Create-Board flow (the list is the
    // management entity; "from-list" creates the backing project + status cols).
    const domainList = await createJson<ApiList>(request, '/api/lists', {
      name: `Mobile board host ${suffix}`,
      description: 'Domain list',
      privacy: 'SHARED',
      listType: 'regular',
    })

    await createJson(request, '/api/projects/from-list', {
      listId: domainList.id,
    })

    await createJson(request, '/api/tasks', {
      title: `Mobile swipe sample ${suffix}`,
      description: '',
      listIds: [domainList.id],
      priority: 0,
      repeating: 'never',
    })

    await gotoWithRetry(page, `/lists/${domainList.id}`)
    await page.getByRole('button', { name: 'Board' }).click()

    const board = page.getByTestId('project-status-board')
    await expect(board).toBeVisible()

    const box = await board.boundingBox()
    expect(box, 'board should have a bounding box').toBeTruthy()
    if (!box) return

    const startX = box.x + box.width * 0.85
    const endX = box.x + box.width * 0.15
    const y = box.y + box.height / 2

    // Synthetic right-to-left swipe across the board's column carousel.
    // The body-level swipe handler must NOT fire here — that handler would
    // flip the layout into the mobile "task" view and change the header.
    await page.mouse.move(startX, y)
    await page.mouse.down()
    for (let step = 1; step <= 10; step += 1) {
      const x = startX + ((endX - startX) * step) / 10
      await page.mouse.move(x, y)
    }
    await page.mouse.up()

    // Board still visible == mobileView did not flip to 'task'.
    await expect(page.getByTestId('project-status-board')).toBeVisible()
  })
})
