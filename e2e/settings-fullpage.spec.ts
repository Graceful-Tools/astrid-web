import { test, expect } from '@playwright/test'

/**
 * Settings Full Page View Tests
 *
 * When navigating to /settings/<page>?fullpage=1, the settings page
 * should render in a clean full-viewport layout without sidebar,
 * header, task list, or chat panel.
 */

test.describe('Settings Full Page View', () => {
  test('should render settings content without sidebar or task list', async ({ page }) => {
    // Navigate directly to a settings page with ?fullpage=1
    await page.goto('/settings/account?fullpage=1')
    await page.waitForLoadState('networkidle')

    // The settings content should be visible
    await expect(page.locator('text=Account')).toBeVisible({ timeout: 10000 })

    // The sidebar should NOT be visible
    const sidebar = page.locator('.app-sidebar, .app-sidebar-mobile')
    await expect(sidebar).toHaveCount(0)

    // The header should NOT be visible
    const header = page.locator('.app-header')
    await expect(header).toHaveCount(0)

    // The task list container should NOT be visible
    const taskList = page.locator('.task-list-container')
    await expect(taskList).toHaveCount(0)

    // The chat panel should NOT be visible
    const chatPanel = page.locator('[class*="order-last"]')
    await expect(chatPanel).toHaveCount(0)
  })

  test('should render fullpage at correct max width', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/settings/appearance?fullpage=1')
    await page.waitForLoadState('networkidle')

    // Content should be visible
    await expect(page.locator('text=Appearance')).toBeVisible({ timeout: 10000 })

    // The content container should be centered with max-w-3xl
    const container = page.locator('.max-w-3xl')
    await expect(container).toBeVisible()
  })

  test('should NOT show fullpage layout without query param', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/settings/account')
    await page.waitForLoadState('networkidle')

    // The header SHOULD be visible (normal settings view)
    const header = page.locator('.app-header')
    await expect(header).toBeVisible({ timeout: 10000 })
  })
})
