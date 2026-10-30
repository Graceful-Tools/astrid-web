import { test, expect, devices } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

/**
 * Pull-to-refresh on the phone task list (AWTD-1425).
 *
 * The gesture is TOUCH (hooks/use-pull-to-refresh.ts listens for touchstart /
 * touchmove / touchend); the old spec drove it with mouse events, which never
 * reach those listeners, and waited for networkidle, which the live SSE
 * connection never reaches. Touches go through CDP here, and a refresh is
 * proven by the reload it fires, not by the spinner alone.
 */

// The iPhone 13 profile without its WebKit override: the signed-in project
// runs Chromium (the only browser CI installs), and a browser change cannot be
// made inside a describe group anyway (AWTD-1338).
const { defaultBrowserType: _webkit, ...iPhone13 } = devices['iPhone 13']
test.use(iPhone13)

async function seededList(request: APIRequestContext, taskCount: number): Promise<string> {
  const listResponse = await request.post('/api/v1/lists', { data: { name: `Pull ${Date.now()}`, privacy: 'PRIVATE' } })
  expect(listResponse.ok(), await listResponse.text()).toBeTruthy()
  const listId = ((await listResponse.json()) as { list: { id: string } }).list.id
  for (let i = 0; i < taskCount; i++) {
    const response = await request.post('/api/v1/tasks', { data: { title: `Pull task ${i + 1}`, listIds: [listId] } })
    expect(response.ok()).toBeTruthy()
  }
  return listId
}

/** A one-finger drag from (x, fromY) to (x, toY); lifted unless `hold`. */
async function touchDrag(page: Page, x: number, fromY: number, toY: number, { hold = false } = {}) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: fromY }] })
  const steps = 12
  for (let i = 1; i <= steps; i++) {
    const y = fromY + ((toY - fromY) * i) / steps
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
  }
  const release = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  if (!hold) await release()
  return release
}

const list = (page: Page) => page.locator('.mobile-task-list-container')
const reloadsTasks = (page: Page) =>
  page.waitForRequest(r => r.method() === 'GET' && new URL(r.url()).pathname === '/api/v1/tasks', { timeout: 5000 })

test.describe('Mobile pull-to-refresh', () => {
  test('pulling past the threshold at the top of a list refreshes it', async ({ page, request }) => {
    const listId = await seededList(request, 3)
    await gotoWithRetry(page, `/lists/${listId}`)
    await expect(list(page)).toBeVisible()
    const box = (await list(page).boundingBox())!
    const x = box.x + box.width / 2

    // Mid-pull, the indicator says what letting go will do. The hook halves
    // the finger's travel, so 160px of drag is 80px of pull: past the 60px threshold.
    const release = await touchDrag(page, x, box.y + 20, box.y + 180, { hold: true })
    await expect(page.getByText('Release to refresh')).toBeVisible()

    const reloaded = reloadsTasks(page)
    await release()
    await reloaded
    await expect(page.getByText('Refreshing...')).toHaveCount(0, { timeout: 10_000 })
  })

  test('a short pull does not refresh', async ({ page, request }) => {
    const listId = await seededList(request, 3)
    await gotoWithRetry(page, `/lists/${listId}`)
    await expect(list(page)).toBeVisible()
    const box = (await list(page).boundingBox())!

    const release = await touchDrag(page, box.x + box.width / 2, box.y + 20, box.y + 80, { hold: true })
    await expect(page.getByText('Pull to refresh')).toBeVisible()
    let refreshed = false
    page.on('request', r => {
      if (r.method() === 'GET' && new URL(r.url()).pathname === '/api/v1/tasks') refreshed = true
    })
    await release()
    await expect(page.getByText('Pull to refresh')).toHaveCount(0)
    await page.waitForTimeout(1000) // a refresh would have been requested by now
    expect(refreshed).toBe(false)
  })

  test('pulling down while scrolled into the list scrolls, without refreshing', async ({ page, request }) => {
    const listId = await seededList(request, 30)
    await gotoWithRetry(page, `/lists/${listId}`)
    await expect(list(page)).toBeVisible()
    await list(page).evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect.poll(() => list(page).evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    const box = (await list(page).boundingBox())!

    await touchDrag(page, box.x + box.width / 2, box.y + 20, box.y + 180, { hold: true })
    await expect(page.getByText(/Release to refresh|Pull to refresh|Refreshing/)).toHaveCount(0)
  })
})
