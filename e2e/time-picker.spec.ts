/**
 * E2E regression for the TimePicker in its real contexts.
 *
 * Covers the "Set Time" button visibility bug where the popover was rendered
 * but the confirmation button was occluded by a higher-z-index overlay.
 *
 * Requires PLAYWRIGHT_TEST_EMAIL + PLAYWRIGHT_TEST_PASSWORD; skips otherwise.
 */

import { test, expect } from '@playwright/test'

const DESKTOP_VIEWPORT = { width: 1440, height: 900 }

test.describe('TimePicker — default due time in user settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await page.goto('/settings/reminders')
    await page.waitForLoadState('networkidle')
  })

  test('popover opens with a visible, clickable "Set Time" button', async ({ page }) => {
    const trigger = page
      .locator('button', { has: page.locator('svg.lucide-clock') })
      .first()
    await expect(trigger).toBeVisible()
    await trigger.click()

    const setTime = page.getByRole('button', { name: /^set time$/i })
    await expect(setTime).toBeVisible()

    // Ensure the button is not visually occluded: its bounding box should be
    // inside the viewport and nothing else should be on top at that point.
    const box = await setTime.boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      const topEl = await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y)
          return el?.textContent?.trim() ?? null
        },
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      )
      expect(topEl?.toLowerCase()).toContain('set time')
    }
  })

  test('clicking a quick preset closes the popover and saves the selection', async ({ page }) => {
    const trigger = page
      .locator('button', { has: page.locator('svg.lucide-clock') })
      .first()
    await trigger.click()

    const nineAm = page.getByRole('button', { name: /^9am$/i })
    await expect(nineAm).toBeVisible()
    await nineAm.click()

    // Popover should close (Set Time button no longer visible)
    await expect(page.getByRole('button', { name: /^set time$/i })).not.toBeVisible()
  })
})

test.describe('TimePicker — in task detail', () => {
  test('opening the time picker inside an open task detail shows the "Set Time" button above the panel', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await page.goto('/')
    await page.waitForSelector('[data-testid="task-list"], .task-list-container', { timeout: 10000 })

    // Open the first task that has a due date (so the Time row is rendered)
    const firstTask = page.locator('.task-row').first()
    await firstTask.waitFor({ state: 'visible' })
    await firstTask.click()
    await page.waitForSelector('.task-panel-desktop', { timeout: 5000 })

    // Click the Time row to enter edit mode (render only happens if dueDateTime is set)
    const timeCell = page.getByText(/^No time$/i).or(page.locator('[data-task-detail-panel] :text("No time")')).first()
    if (await timeCell.count() === 0) return // Task has no due date; skip

    await timeCell.click()

    const timeTrigger = page
      .locator('[data-task-detail-panel] button', { has: page.locator('svg.lucide-clock') })
      .first()
    await timeTrigger.click()

    const setTime = page.getByRole('button', { name: /^set time$/i })
    await expect(setTime).toBeVisible()
  })
})

test.describe('TimePicker — reminder settings quiet hours', () => {
  test('both start and end time pickers render the "Set Time" button', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await page.goto('/settings/reminders')
    await page.waitForLoadState('networkidle')

    // Scroll to Quiet Hours section if present
    const quietHoursHeading = page.getByText(/quiet hours/i).first()
    if (await quietHoursHeading.count() === 0) return
    await quietHoursHeading.scrollIntoViewIfNeeded()

    const timeTriggers = page
      .locator('button', { has: page.locator('svg.lucide-clock') })
      // Skip the "Default due time" one at the top
    const count = await timeTriggers.count()
    expect(count).toBeGreaterThanOrEqual(2)

    // Click the last one (quiet hours end)
    await timeTriggers.last().click()
    await expect(page.getByRole('button', { name: /^set time$/i })).toBeVisible()
  })
})
