/**
 * Panel slide animations, arrow positioning, and the dim-overlay dismiss, for
 * the task detail panel and the settings detail panel (which share
 * usePanelArrowPosition and useSlideCloseAnimation).
 *
 * Revived signed in (AWTD-1425). It used to read whatever tasks the account
 * had, sleep, check the closing class once, and return early — passing — when
 * a selector found nothing, so a green run could have tested nothing. Each
 * test now seeds its own list, and the closing animation is recorded by a
 * MutationObserver installed before the close, so a 300ms class is not a race.
 */

import { test, expect } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

const DESKTOP_VIEWPORT = { width: 1440, height: 900 } // 3-column
const MOBILE_VIEWPORT = { width: 390, height: 844 } // 1-column

async function seededList(request: APIRequestContext): Promise<{ listId: string; title: string }> {
  const listResponse = await request.post('/api/v1/lists', { data: { name: `Panels ${Date.now()}`, privacy: 'PRIVATE' } })
  expect(listResponse.ok(), await listResponse.text()).toBeTruthy()
  const listId = ((await listResponse.json()) as { list: { id: string } }).list.id
  const title = `Panel task ${Date.now()}`
  const taskResponse = await request.post('/api/v1/tasks', { data: { title, listIds: [listId] } })
  expect(taskResponse.ok(), await taskResponse.text()).toBeTruthy()
  return { listId, title }
}

const row = (page: Page, title: string) => page.locator('[data-task-id]').filter({ hasText: title })

/** Start recording whether any desktop panel gets the closing class. */
async function watchForAnimateOut(page: Page) {
  await page.evaluate(`
    window.__sawAnimateOut = false;
    new MutationObserver(() => {
      if (document.querySelector('.task-panel-desktop.task-panel-animate-out')) window.__sawAnimateOut = true;
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
  `)
}
const sawAnimateOut = (page: Page) => page.evaluate('window.__sawAnimateOut') as Promise<boolean>

test.describe('Task detail panel arrow + slide animation', () => {
  test('desktop: the arrow points at the selected row', async ({ page, request }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    const { listId, title } = await seededList(request)
    await gotoWithRetry(page, `/lists/${listId}`)

    await row(page, title).click()
    await expect(page.locator('.task-panel-desktop')).toBeVisible()
    const arrow = page.locator('.task-panel-arrow:visible').first()
    await expect(arrow).toBeVisible()

    // The arrow's middle sits within the row it points at.
    const rowBox = (await row(page, title).boundingBox())!
    const arrowBox = (await arrow.boundingBox())!
    const arrowMiddle = arrowBox.y + arrowBox.height / 2
    expect(arrowMiddle).toBeGreaterThanOrEqual(rowBox.y - 4)
    expect(arrowMiddle).toBeLessThanOrEqual(rowBox.y + rowBox.height + 4)
  })

  test('desktop: closing animates out, then removes the panel', async ({ page, request }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    const { listId, title } = await seededList(request)
    await gotoWithRetry(page, `/lists/${listId}`)

    await row(page, title).click()
    await expect(page.locator('.task-panel-desktop')).toBeVisible()

    await watchForAnimateOut(page)
    await row(page, title).click() // the same row again closes it
    await expect(page.locator('.task-panel-desktop')).toHaveCount(0)
    expect(await sawAnimateOut(page)).toBe(true)
  })

  test('mobile: a task opens full screen, without an arrow', async ({ page, request }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
    const { listId, title } = await seededList(request)
    await gotoWithRetry(page, `/lists/${listId}`)

    await row(page, title).click()
    await expect(page.locator('.task-panel-mobile')).toBeVisible()
    await expect(page.locator('.task-panel-arrow:visible')).toHaveCount(0)
  })
})

test.describe('Settings detail panel arrow + slide animation', () => {
  test('desktop: a settings page opens with its arrow, and closing it again animates out', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await gotoWithRetry(page, '/settings')

    const card = page.locator('[data-settings-page]').first()
    await expect(card).toBeVisible()
    await card.click()
    await expect(page.locator('[data-task-detail-panel]')).toBeVisible()
    await expect(page.locator('.task-panel-arrow:visible').first()).toBeVisible()

    await watchForAnimateOut(page)
    await card.click()
    await expect(page.locator('[data-task-detail-panel]')).toHaveCount(0)
    expect(await sawAnimateOut(page)).toBe(true)
  })
})

test.describe('Dim-overlay dismiss handler', () => {
  test('desktop: clicking the dimmed chat pane while a task is open closes the task', async ({ page, request }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    const { listId, title } = await seededList(request)
    await gotoWithRetry(page, `/lists/${listId}`)

    await row(page, title).click()
    await expect(page.locator('.task-panel-desktop')).toBeVisible()
    const dimmer = page.getByTestId('chat-pane-dimmer')
    await expect(dimmer).toBeVisible()
    // The task panel can overlap the dimmed pane (it covered its middle on
    // CI's runner), so click the middle of the part left uncovered, as a user would.
    const dim = (await dimmer.boundingBox())!
    const panel = (await page.locator('.task-panel-desktop').boundingBox())!
    const clearFrom = Math.max(dim.x, panel.x + panel.width)
    expect(clearFrom, 'the task panel covers the whole dimmed pane').toBeLessThan(dim.x + dim.width - 8)
    await page.mouse.click((clearFrom + dim.x + dim.width) / 2, dim.y + dim.height / 2)
    await expect(page.locator('.task-panel-desktop')).toHaveCount(0)
  })
  // No settings counterpart: the settings view has no chat pane to dim.
})
