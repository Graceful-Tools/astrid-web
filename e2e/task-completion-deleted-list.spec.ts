import { test, expect } from '@playwright/test'

test.describe('Task Completion with Deleted Lists', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/')

    // Wait for auth or redirect
    await page.waitForURL(/.*\//, { timeout: 10000 })
  })

  test('should handle completing a task after its list is deleted', async ({ page }) => {
    const currentUrl = page.url()
    expect(currentUrl).not.toMatch(/signin|login/)

    // Step 1: Create a new list
    const testListName = `Test List ${Date.now()}`
    await page.click('button:has-text("New List")')
    await page.fill('input[placeholder*="list name" i]', testListName)
    await page.click('button:has-text("Create")')

    // Wait for list to be created
    await expect(page.locator(`text="${testListName}"`).first()).toBeVisible({ timeout: 5000 })

    // Step 2: Select the new list
    await page.click(`text="${testListName}"`)
    await page.waitForTimeout(500)

    // Step 3: Create a task in this list
    const testTaskTitle = `Test Task ${Date.now()}`
    const taskInput = page.locator('input[placeholder*="new task" i], input[placeholder*="add task" i]').first()
    await taskInput.fill(testTaskTitle)
    await taskInput.press('Enter')

    // Wait for task to appear
    await expect(page.locator(`text="${testTaskTitle}"`).first()).toBeVisible({ timeout: 5000 })

    // Step 4: Delete the list
    // Open list settings
    await page.click('[data-testid="list-settings-button"], button:has-text("Settings")')
    await page.waitForTimeout(300)

    // Click delete list
    await page.click('button:has-text("Delete List")')
    await page.waitForTimeout(300)

    // Confirm deletion
    const confirmButton = page.locator('button:has-text("Delete"), button:has-text("Confirm")')
    if (await confirmButton.isVisible()) {
      await confirmButton.click()
    }

    // Wait for list to be deleted
    await expect(page.locator(`text="${testListName}"`)).not.toBeVisible({ timeout: 5000 })

    // Step 5: Try to view "My Tasks" - the task should still be there
    await page.click('text="My Tasks"')
    await page.waitForTimeout(500)

    // Task should be visible in My Tasks
    await expect(page.locator(`text="${testTaskTitle}"`).first()).toBeVisible({ timeout: 5000 })

    // Step 6: Complete the task - this should NOT error
    const taskCheckbox = page.locator(`[data-task-id]:has-text("${testTaskTitle}") input[type="checkbox"]`).first()
    await taskCheckbox.click()

    // Wait a moment for the completion to process
    await page.waitForTimeout(1000)

    // Step 7: Verify no errors occurred
    // Check that the page is still functional
    const pageTitle = await page.title()
    expect(pageTitle).toBeTruthy()

    // Task should still be visible (within 24-hour recently completed window)
    await expect(page.locator(`text="${testTaskTitle}"`).first()).toBeVisible({ timeout: 5000 })

    // Step 8: Click on the completed task to view details - should not error
    await page.click(`text="${testTaskTitle}"`)
    await page.waitForTimeout(500)

    // Task detail pane should open without errors
    await expect(page.locator('[data-testid="task-detail"], .task-detail')).toBeVisible({ timeout: 3000 })

    // Clean up: Delete the task
    const deleteButton = page.locator('button:has-text("Delete")').first()
    if (await deleteButton.isVisible()) {
      await deleteButton.click()

      // Confirm deletion if needed
      const confirmDeleteButton = page.locator('button:has-text("Delete"), button:has-text("Confirm")').last()
      if (await confirmDeleteButton.isVisible()) {
        await confirmDeleteButton.click()
      }
    }
  })

  test('should gracefully handle tasks with multiple lists where some are deleted', async ({ page }) => {
    const currentUrl = page.url()
    expect(currentUrl).not.toMatch(/signin|login/)

    // Create two lists
    const testList1 = `List One ${Date.now()}`
    const testList2 = `List Two ${Date.now()}`

    // Create first list
    await page.click('button:has-text("New List")')
    await page.fill('input[placeholder*="list name" i]', testList1)
    await page.click('button:has-text("Create")')
    await expect(page.locator(`text="${testList1}"`).first()).toBeVisible({ timeout: 5000 })

    // Create second list
    await page.click('button:has-text("New List")')
    await page.fill('input[placeholder*="list name" i]', testList2)
    await page.click('button:has-text("Create")')
    await expect(page.locator(`text="${testList2}"`).first()).toBeVisible({ timeout: 5000 })

    // Create a task in first list
    await page.click(`text="${testList1}"`)
    await page.waitForTimeout(500)

    const testTaskTitle = `Multi-List Task ${Date.now()}`
    const taskInput = page.locator('input[placeholder*="new task" i], input[placeholder*="add task" i]').first()
    await taskInput.fill(testTaskTitle)
    await taskInput.press('Enter')
    await expect(page.locator(`text="${testTaskTitle}"`).first()).toBeVisible({ timeout: 5000 })

    // Open task detail and add to second list
    await page.click(`text="${testTaskTitle}"`)
    await page.waitForTimeout(500)

    // Look for lists section and click to edit
    const listsSection = page.locator('[data-testid="task-lists"], .task-lists, text="Lists"').first()
    if (await listsSection.isVisible()) {
      await listsSection.click()
      await page.waitForTimeout(300)

      // Try to add second list
      const list2Option = page.locator(`text="${testList2}"`).last()
      if (await list2Option.isVisible()) {
        await list2Option.click()
      }
    }

    // Close task detail
    await page.press('body', 'Escape')

    // Delete the first list
    await page.click(`text="${testList1}"`)
    await page.waitForTimeout(300)

    await page.click('[data-testid="list-settings-button"], button:has-text("Settings")')
    await page.waitForTimeout(300)

    await page.click('button:has-text("Delete List")')
    await page.waitForTimeout(300)

    const confirmButton = page.locator('button:has-text("Delete"), button:has-text("Confirm")')
    if (await confirmButton.isVisible()) {
      await confirmButton.click()
    }

    // Navigate to second list - task should still be there
    await page.click(`text="${testList2}"`)
    await page.waitForTimeout(500)

    // Task should be visible without errors
    await expect(page.locator(`text="${testTaskTitle}"`).first()).toBeVisible({ timeout: 5000 })

    // Complete the task - should not error
    const taskCheckbox = page.locator(`[data-task-id]:has-text("${testTaskTitle}") input[type="checkbox"]`).first()
    await taskCheckbox.click()
    await page.waitForTimeout(1000)

    // Verify no crash - page should still be functional
    const pageTitle = await page.title()
    expect(pageTitle).toBeTruthy()

    // Clean up: Delete the second list (which will delete the task)
    await page.click('[data-testid="list-settings-button"], button:has-text("Settings")')
    await page.waitForTimeout(300)

    await page.click('button:has-text("Delete List")')
    await page.waitForTimeout(300)

    const confirmButton2 = page.locator('button:has-text("Delete"), button:has-text("Confirm")')
    if (await confirmButton2.isVisible()) {
      await confirmButton2.click()
    }
  })
})
