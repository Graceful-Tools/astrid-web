/**
 * E2E tests for scroll-to-close task detail behavior
 *
 * Tests the user-facing behavior of closing task details when scrolling
 * the task list in 2-column and 3-column layouts
 */

import { test, expect } from '@playwright/test'

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

    // Wait for the app to load (adjust selector based on your app)
    await page.waitForSelector('[data-testid="task-list"], .task-list-container', { timeout: 10000 })
  })

  test('should close task detail on scroll in 2-column layout (tablet portrait)', async ({ page }) => {
    // Set viewport to tablet portrait size (2-column layout: 910px - 1099px)
    await page.setViewportSize({ width: 1000, height: 768 })

    // Wait for layout to adjust
    await page.waitForTimeout(500)

    // Find and click on a task to open task detail
    const firstTask = page.locator('.task-row').first()
    await firstTask.waitFor({ state: 'visible' })
    await firstTask.click()

    // Wait for task detail panel to appear
    await page.waitForSelector('.task-panel-desktop', { timeout: 5000 })

    // Verify task detail is open
    const taskPanel = page.locator('.task-panel-desktop')
    await expect(taskPanel).toBeVisible()

    // Scroll the task list container
    const taskListContainer = page.locator('.task-list-container').first()
    await taskListContainer.evaluate((el) => {
      el.scrollTop = 100 // Scroll down
    })

    // Wait a bit for scroll handler to execute
    await page.waitForTimeout(300)

    // Verify task detail panel is now closed
    await expect(taskPanel).not.toBeVisible()
  })

  test('should close task detail on scroll in 3-column layout (desktop wide)', async ({ page }) => {
    // Set viewport to desktop wide size (3-column layout: >= 1100px)
    await page.setViewportSize({ width: 1400, height: 900 })

    // Wait for layout to adjust
    await page.waitForTimeout(500)

    // Find and click on a task to open task detail
    const firstTask = page.locator('.task-row').first()
    await firstTask.waitFor({ state: 'visible' })
    await firstTask.click()

    // Wait for task detail panel to appear
    await page.waitForSelector('.task-panel-desktop', { timeout: 5000 })

    // Verify task detail is open
    const taskPanel = page.locator('.task-panel-desktop')
    await expect(taskPanel).toBeVisible()

    // Scroll the task list container
    const taskListContainer = page.locator('.task-list-container').first()
    await taskListContainer.evaluate((el) => {
      el.scrollTop = 100 // Scroll down
    })

    // Wait a bit for scroll handler to execute
    await page.waitForTimeout(300)

    // Verify task detail panel is now closed
    await expect(taskPanel).not.toBeVisible()
  })

  test('should NOT close task detail on scroll in 1-column mobile layout', async ({ page }) => {
    // Set viewport to mobile size (1-column layout: < 910px)
    await page.setViewportSize({ width: 375, height: 667 })

    // Wait for layout to adjust
    await page.waitForTimeout(500)

    // Find and click on a task to open task detail
    const firstTask = page.locator('.task-row, .mobile-task-item').first()
    await firstTask.waitFor({ state: 'visible' })
    await firstTask.click()

    // Wait for mobile task detail panel to appear
    await page.waitForSelector('.task-panel-mobile', { timeout: 5000 })

    // Verify task detail is open
    const taskPanelMobile = page.locator('.task-panel-mobile')
    await expect(taskPanelMobile).toBeVisible()

    // Scroll the task list container (note: mobile view switches, so this may not have effect)
    // But the point is that scrolling should NOT close the task detail in mobile
    const taskListContainer = page.locator('.task-list-container').first()
    if (await taskListContainer.isVisible()) {
      await taskListContainer.evaluate((el) => {
        el.scrollTop = 100 // Scroll down
      })

      // Wait a bit
      await page.waitForTimeout(300)

      // Verify task detail is STILL open (should not close on scroll in mobile)
      await expect(taskPanelMobile).toBeVisible()
    }
  })

  test('should close task detail with mouse wheel scroll in 2-column layout', async ({ page }) => {
    // Set viewport to 2-column layout
    await page.setViewportSize({ width: 1000, height: 768 })
    await page.waitForTimeout(500)

    // Click on a task
    const firstTask = page.locator('.task-row').first()
    await firstTask.waitFor({ state: 'visible' })
    await firstTask.click()

    // Wait for task detail
    await page.waitForSelector('.task-panel-desktop', { timeout: 5000 })
    const taskPanel = page.locator('.task-panel-desktop')
    await expect(taskPanel).toBeVisible()

    // Simulate mouse wheel scroll
    const taskListContainer = page.locator('.task-list-container').first()
    await taskListContainer.hover()
    await page.mouse.wheel(0, 100) // Scroll down with mouse wheel

    // Wait for scroll handler
    await page.waitForTimeout(300)

    // Verify closed
    await expect(taskPanel).not.toBeVisible()
  })

  test('should close task detail with trackpad scroll in 3-column layout', async ({ page }) => {
    // Set viewport to 3-column layout
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.waitForTimeout(500)

    // Click on a task
    const firstTask = page.locator('.task-row').first()
    await firstTask.waitFor({ state: 'visible' })
    await firstTask.click()

    // Wait for task detail
    await page.waitForSelector('.task-panel-desktop', { timeout: 5000 })
    const taskPanel = page.locator('.task-panel-desktop')
    await expect(taskPanel).toBeVisible()

    // Simulate trackpad/smooth scroll
    const taskListContainer = page.locator('.task-list-container').first()
    await taskListContainer.evaluate((el) => {
      // Trigger smooth scroll event
      const scrollEvent = new Event('scroll', { bubbles: true })
      el.scrollTop = 50
      el.dispatchEvent(scrollEvent)
    })

    // Wait for scroll handler
    await page.waitForTimeout(300)

    // Verify closed
    await expect(taskPanel).not.toBeVisible()
  })

  test('should work correctly when switching between layouts', async ({ page }) => {
    // Start in 3-column layout
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.waitForTimeout(500)

    // Open task detail
    const firstTask = page.locator('.task-row').first()
    await firstTask.waitFor({ state: 'visible' })
    await firstTask.click()
    await page.waitForSelector('.task-panel-desktop', { timeout: 5000 })

    // Scroll - should close
    const taskListContainer = page.locator('.task-list-container').first()
    await taskListContainer.evaluate((el) => { el.scrollTop = 100 })
    await page.waitForTimeout(300)
    await expect(page.locator('.task-panel-desktop')).not.toBeVisible()

    // Resize to 2-column layout
    await page.setViewportSize({ width: 1000, height: 768 })
    await page.waitForTimeout(500)

    // Open task detail again
    await firstTask.click()
    await page.waitForSelector('.task-panel-desktop', { timeout: 5000 })

    // Scroll - should still close in 2-column
    await taskListContainer.evaluate((el) => { el.scrollTop = 200 })
    await page.waitForTimeout(300)
    await expect(page.locator('.task-panel-desktop')).not.toBeVisible()

    // Resize to mobile (1-column)
    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForTimeout(500)

    // Open task detail in mobile view
    const mobileTask = page.locator('.task-row, .mobile-task-item').first()
    await mobileTask.waitFor({ state: 'visible' })
    await mobileTask.click()

    // In mobile, task detail takes over the view, so scrolling behavior is different
    // The test passes if the mobile panel appears
    await expect(page.locator('.task-panel-mobile')).toBeVisible({ timeout: 5000 })
  })
})
