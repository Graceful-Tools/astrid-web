/**
 * E2E tests for scroll-to-close task detail behavior
 *
 * Tests the user-facing behavior of closing task details when scrolling
 * the task list in 2-column and 3-column layouts.
 *
 * Every wait names the state it waits for (panel open, list scrolled, panel
 * closed). There are no fixed sleeps: on CI a sleep that was too short failed,
 * passed on retry and nobody saw it (AWTD-1538).
 */

import { test, expect, type Page } from '@playwright/test'

const DESKTOP_PANEL = '.task-panel-desktop'
const MOBILE_PANEL = '.task-panel-mobile'

/**
 * Resize, wait for the layout to switch, then open the first task. The click and
 * the panel check retry as one unit: a click that lands mid-switch opens the wrong
 * panel (or none).
 */
async function resizeAndOpenFirstTask(page: Page, width: number, height: number, panel: string) {
  await page.setViewportSize({ width, height })
  // The layout switches on a 100ms-debounced resize (useTaskManagerLayout), and both desktop
  // layouts render the same panel, so the panel alone cannot tell 2-column from 3-column. The
  // hamburger drawer wrapper is set in the same update: present below 1100px, absent above.
  await expect(page.locator('.ios-drawer-content')).toHaveCount(width < 1100 ? 1 : 0)
  const firstTask = page.locator('.task-row, .mobile-task-item').first()
  await expect(firstTask).toBeVisible()
  await expect(async () => {
    await firstTask.click()
    await expect(page.locator(panel)).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10000 })
}

/** The list really scrolled, so "panel still open" cannot mean "never scrolled". */
async function expectListScrolled(page: Page) {
  const list = page.locator('.task-list-container').first()
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
}

/**
 * Scroll the list and wait until the app has HANDLED it: the scroll event fired (the list's
 * onScroll closes the panel synchronously in 2/3-column layouts) and React has committed. A
 * "panel still open" check right after setting scrollTop would pass before the handler ran, so
 * it could never fail.
 */
async function scrollListAndSettle(page: Page, top: number) {
  await page.locator('.task-list-container').first().evaluate(
    (el, to) =>
      new Promise<void>((resolve) => {
        el.addEventListener('scroll', () => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }, { once: true })
        el.scrollTop = to
      }),
    top,
  )
}

test.describe('Scroll-to-close task detail in multi-column layouts', () => {
  test.beforeEach(async ({ page, request }) => {
    // Its own list, long enough to scroll. This used to open '/' and take
    // whatever tasks earlier specs had left, so adding a spec that sorts
    // first changed what it scrolled, and whether it could (AWTD-1405).
    const created = await request.post('/api/v1/lists', { data: { name: `Scroll ${Date.now()}`, privacy: 'PRIVATE' } })
    expect(created.ok()).toBeTruthy()
    const { list } = (await created.json()) as { list: { id: string } }
    for (let i = 1; i <= 30; i++) {
      const task = await request.post('/api/v1/tasks', { data: { title: `Scroll task ${i}`, listIds: [list.id] } })
      expect(task.ok()).toBeTruthy()
    }
    await page.goto(`/lists/${list.id}`)

    await page.waitForSelector('[data-testid="task-list"], .task-list-container', { timeout: 10000 })
  })

  test('should close task detail on scroll in 2-column layout (tablet portrait)', async ({ page }) => {
    // 2-column layout: 910px - 1099px
    await resizeAndOpenFirstTask(page, 1000, 768, DESKTOP_PANEL)
    const taskPanel = page.locator(DESKTOP_PANEL)

    await page.locator('.task-list-container').first().evaluate((el) => {
      el.scrollTop = 100
    })
    await expectListScrolled(page)

    await expect(taskPanel).toBeHidden()
  })

  test('should close task detail on scroll in 3-column layout (desktop wide)', async ({ page }) => {
    // 3-column layout: >= 1100px
    await resizeAndOpenFirstTask(page, 1400, 900, DESKTOP_PANEL)
    const taskPanel = page.locator(DESKTOP_PANEL)

    await page.locator('.task-list-container').first().evaluate((el) => {
      el.scrollTop = 100
    })
    await expectListScrolled(page)

    await expect(taskPanel).toBeHidden()
  })

  test('should NOT close task detail on scroll in 1-column mobile layout', async ({ page }) => {
    // 1-column layout: < 910px
    await resizeAndOpenFirstTask(page, 375, 667, MOBILE_PANEL)
    const taskPanelMobile = page.locator(MOBILE_PANEL)

    // Mobile view switches, so the list may be hidden behind the panel. When it
    // is visible, scrolling it must not close the detail.
    const taskListContainer = page.locator('.task-list-container').first()
    if (await taskListContainer.isVisible()) {
      await scrollListAndSettle(page, 100)
      await expectListScrolled(page)

      await expect(taskPanelMobile).toBeVisible()
    }
  })

  test('should close task detail with mouse wheel scroll in 2-column layout', async ({ page }) => {
    await resizeAndOpenFirstTask(page, 1000, 768, DESKTOP_PANEL)
    const taskPanel = page.locator(DESKTOP_PANEL)

    await page.locator('.task-list-container').first().hover()
    await page.mouse.wheel(0, 100)
    await expectListScrolled(page)

    await expect(taskPanel).toBeHidden()
  })

  test('should close task detail with trackpad scroll in 3-column layout', async ({ page }) => {
    await resizeAndOpenFirstTask(page, 1400, 900, DESKTOP_PANEL)
    const taskPanel = page.locator(DESKTOP_PANEL)

    await page.locator('.task-list-container').first().evaluate((el) => {
      el.scrollTop = 50
      el.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await expectListScrolled(page)

    await expect(taskPanel).toBeHidden()
  })

  test('should work correctly when switching between layouts', async ({ page }) => {
    // Start in 3-column layout, open task detail, scroll - should close
    await resizeAndOpenFirstTask(page, 1400, 900, DESKTOP_PANEL)
    const taskListContainer = page.locator('.task-list-container').first()
    await taskListContainer.evaluate((el) => { el.scrollTop = 100 })
    await expect(page.locator(DESKTOP_PANEL)).toBeHidden()

    // Resize to 2-column layout, open again, scroll further - should still close
    await resizeAndOpenFirstTask(page, 1000, 768, DESKTOP_PANEL)
    await taskListContainer.evaluate((el) => { el.scrollTop = 200 })
    await expect(page.locator(DESKTOP_PANEL)).toBeHidden()

    // Resize to mobile (1-column): task detail takes over the view, so the test
    // passes if the mobile panel appears
    await resizeAndOpenFirstTask(page, 375, 667, MOBILE_PANEL)
    await expect(page.locator(MOBILE_PANEL)).toBeVisible()
  })
})
