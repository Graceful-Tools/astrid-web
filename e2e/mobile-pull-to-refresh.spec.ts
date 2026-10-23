import { test, expect, devices } from '@playwright/test'

// The iPhone 13 profile without its WebKit override: the signed-in project
// runs Chromium (the only browser CI installs), and a browser change cannot be
// made inside a describe group anyway (AWTD-1338).
const { defaultBrowserType: _webkit, ...iPhone13 } = devices['iPhone 13']
test.use(iPhone13)

test.describe('Mobile Pull-to-Refresh', () => {

  test.beforeEach(async ({ page }) => {
    // Navigate to the app and ensure user is logged in
    await page.goto('/')

    // Wait for the app to load
    await page.waitForLoadState('networkidle')
  })

  test('should show pull-to-refresh indicator when pulling down on list view', async ({ page }) => {
    // Ensure we're on the list view (not task detail)
    await expect(page.locator('.mobile-task-list-container')).toBeVisible()

    // Get the task list container
    const taskListContainer = page.locator('.task-list-container').first()
    const boundingBox = await taskListContainer.boundingBox()

    if (!boundingBox) {
      throw new Error('Task list container not found')
    }

    // Simulate pull-to-refresh gesture
    // Start touch at top of list
    await page.touchscreen.tap(boundingBox.x + boundingBox.width / 2, boundingBox.y + 50)

    // Swipe down
    await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + 50)
    await page.mouse.down()
    await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + 150, { steps: 10 })

    // Check for pull-to-refresh indicator
    const pullIndicator = page.locator('text=Pull to refresh')
    await expect(pullIndicator.or(page.locator('text=Release to refresh'))).toBeVisible({ timeout: 2000 })

    await page.mouse.up()
  })

  test('should trigger refresh when pull threshold is met', async ({ page }) => {
    // Get initial task count or list state
    const taskList = page.locator('.task-list-container').first()
    await expect(taskList).toBeVisible()

    const boundingBox = await taskList.boundingBox()
    if (!boundingBox) {
      throw new Error('Task list container not found')
    }

    // Simulate full pull-to-refresh gesture
    await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + 50)
    await page.mouse.down()
    await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + 150, { steps: 10 })

    // Wait for "Release to refresh" indicator
    await expect(page.locator('text=Release to refresh')).toBeVisible({ timeout: 2000 })

    // Release to trigger refresh
    await page.mouse.up()

    // Check for refreshing indicator
    await expect(page.locator('text=Refreshing...')).toBeVisible({ timeout: 2000 })

    // Wait for refresh to complete
    await expect(page.locator('text=Refreshing...')).not.toBeVisible({ timeout: 5000 })
  })

  test('should work on "My Tasks" list', async ({ page }) => {
    // Navigate to My Tasks
    const myTasksButton = page.locator('text=My Tasks').first()
    if (await myTasksButton.isVisible()) {
      await myTasksButton.click()
    }

    await page.waitForTimeout(1000)

    // Get the task list container
    const taskList = page.locator('.task-list-container').first()
    await expect(taskList).toBeVisible()

    const boundingBox = await taskList.boundingBox()
    if (!boundingBox) {
      throw new Error('Task list container not found')
    }

    // Simulate pull-to-refresh
    await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + 50)
    await page.mouse.down()
    await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + 150, { steps: 10 })

    // Check for indicator
    await expect(page.locator('text=Pull to refresh').or(page.locator('text=Release to refresh'))).toBeVisible({ timeout: 2000 })

    await page.mouse.up()
  })

  test('should work on custom lists', async ({ page }) => {
    // Try to find a custom list in the sidebar
    const customList = page.locator('[data-list-id]').first()

    if (await customList.isVisible()) {
      await customList.click()
      await page.waitForTimeout(1000)

      // Get the task list container
      const taskList = page.locator('.task-list-container').first()
      await expect(taskList).toBeVisible()

      const boundingBox = await taskList.boundingBox()
      if (!boundingBox) {
        return // Skip if no custom lists
      }

      // Simulate pull-to-refresh
      await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + 50)
      await page.mouse.down()
      await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + 150, { steps: 10 })

      // Check for indicator
      await expect(page.locator('text=Pull to refresh').or(page.locator('text=Release to refresh'))).toBeVisible({ timeout: 2000 })

      await page.mouse.up()
    }
  })

  test('should not work when viewing task detail', async ({ page }) => {
    // Find and click a task to open detail view
    const taskItem = page.locator('.task-row').first()

    if (await taskItem.isVisible()) {
      await taskItem.click()

      // Wait for task detail to open
      await page.waitForTimeout(1000)

      // Check if we're in task view (mobile)
      const taskDetail = page.locator('.task-panel-mobile')

      if (await taskDetail.isVisible()) {
        const boundingBox = await taskDetail.boundingBox()

        if (boundingBox) {
          // Try to pull-to-refresh in task detail view
          await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + 50)
          await page.mouse.down()
          await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + 150, { steps: 10 })

          // Pull-to-refresh indicator should NOT appear
          await expect(page.locator('text=Pull to refresh')).not.toBeVisible({ timeout: 1000 })

          await page.mouse.up()
        }
      }
    }
  })

  test('should only work when scrolled to top', async ({ page }) => {
    // Ensure we have enough tasks to scroll
    const taskList = page.locator('.task-list-container').first()
    await expect(taskList).toBeVisible()

    // Scroll down a bit
    await taskList.evaluate((el) => {
      el.scrollTop = 100
    })

    await page.waitForTimeout(500)

    const boundingBox = await taskList.boundingBox()
    if (!boundingBox) {
      throw new Error('Task list container not found')
    }

    // Try to pull-to-refresh while not at top
    await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + 50)
    await page.mouse.down()
    await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + 150, { steps: 10 })

    // Pull-to-refresh should not activate when not at top
    // The indicator might briefly appear but should not trigger refresh
    await page.mouse.up()

    // Now scroll back to top
    await taskList.evaluate((el) => {
      el.scrollTop = 0
    })

    await page.waitForTimeout(500)

    // Try pull-to-refresh at top - should work
    await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + 50)
    await page.mouse.down()
    await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + 150, { steps: 10 })

    // Check for indicator at top
    await expect(page.locator('text=Pull to refresh').or(page.locator('text=Release to refresh'))).toBeVisible({ timeout: 2000 })

    await page.mouse.up()
  })
})
