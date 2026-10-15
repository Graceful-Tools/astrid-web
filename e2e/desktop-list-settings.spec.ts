import { test, expect } from '@playwright/test'
import { ListHelpers, TaskHelpers } from './utils/test-helpers'

test.describe('Desktop List Settings Gear Icon', () => {
  let listHelpers: ListHelpers
  let taskHelpers: TaskHelpers

  test.beforeEach(async ({ page }) => {
    listHelpers = new ListHelpers(page)
    taskHelpers = new TaskHelpers(page)

    // Navigate to home page (requires authentication)
    await page.goto('/')
  })

  test('admin user should see full settings popover with all tabs', async ({ page }) => {
    // Set viewport to desktop size (3-column layout)
    await page.setViewportSize({ width: 1920, height: 1080 })

    // Create a test list
    const listName = `Test List Admin ${Date.now()}`
    await listHelpers.createList(listName)

    // Wait for navigation to the new list
    await page.waitForLoadState('networkidle')

    // Find and click the gear (Settings) icon
    const settingsButton = page.locator('button:has(svg.lucide-settings)').first()
    await expect(settingsButton).toBeVisible()
    await settingsButton.click()

    // Verify the full settings popover appears (not just "Leave List")
    await expect(page.getByRole('heading', { name: /list settings/i })).toBeVisible()

    // Membership and Admin Settings — and NOT Sort & Filters, which has not
    // been a tab here since task aa4e7eb0 moved it out to its own per-user
    // control. This spec went on asserting the old tab for a month because it
    // only runs under PLAYWRIGHT_AUTHENTICATED=1 (AWTD-1175).
    await expect(page.getByRole('tab', { name: /membership/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /admin settings/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /sort & filters/i })).toHaveCount(0)

    // In 3 columns the way to sort & filters is the funnel in the header, so
    // this modal must not grow a second route to it either (AWTD-1175).
    await expect(page.getByTestId('sort-filters-entry')).toHaveCount(0)
  })

  test('non-admin member should see Membership tab with Leave List option', async ({ page }) => {
    // Note: This test assumes the user is a member of at least one shared list
    // Set viewport to desktop size (2-column layout)
    await page.setViewportSize({ width: 1024, height: 768 })

    // For simplicity, this test verifies the UI structure exists
    // A full integration test would require multi-user setup

    // Create a test list (user will be admin/owner)
    const listName = `Test List ${Date.now()}`
    await listHelpers.createList(listName)

    // Wait for navigation to the new list
    await page.waitForLoadState('networkidle')

    // Find and click the gear (Settings) icon
    const settingsButton = page.locator('button:has(svg.lucide-settings)').first()
    await expect(settingsButton).toBeVisible()
    await settingsButton.click()

    // Verify the full settings popover appears
    await expect(page.getByRole('heading', { name: /list settings/i })).toBeVisible()

    // Verify Membership tab is present (which contains Leave List for non-admins)
    await expect(page.getByRole('tab', { name: /membership/i })).toBeVisible()

    // Click on Membership tab
    await page.getByRole('tab', { name: /membership/i }).click()

    // For owner/admin, the "Leave List" button should also be available
    // (though it behaves differently - shows succession dialog)
    await expect(page.locator('text=/Leave List/i')).toBeVisible()

    // 1024px is a 2-column layout, where the header has only the gear — so
    // this modal is the way into Sort & Filters (AWTD-1175). Before that fix
    // there was no way at all: the funnel renders in 3 columns only.
    await expect(page.getByTestId('sort-filters-entry')).toBeVisible()

    // And it OPENS the per-user panel rather than being a tab in this one.
    await page.getByTestId('sort-filters-entry').click()
    await expect(page.getByRole('heading', { name: /sort & filters/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /list settings/i })).toHaveCount(0)
  })

  test('desktop gear icon should match mobile behavior', async ({ page }) => {
    // Create a test list
    const listName = `Test List Desktop vs Mobile ${Date.now()}`
    await listHelpers.createList(listName)

    // Test 1: Desktop view (3-column) - already on the list from creation
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.waitForLoadState('networkidle')

    const desktopSettingsButton = page.locator('button:has(svg.lucide-settings)').first()
    await expect(desktopSettingsButton).toBeVisible()
    await desktopSettingsButton.click()

    // Capture desktop behavior
    const desktopHasFullPopover = await page.getByRole('heading', { name: /list settings/i }).isVisible()
    const desktopHasTabs = await page.getByRole('tab', { name: /membership/i }).isVisible()

    await page.keyboard.press('Escape')

    // Test 2: Mobile view (1-column)
    await page.setViewportSize({ width: 375, height: 667 })
    await page.reload()
    await page.waitForLoadState('networkidle')

    // On mobile, need to open the list first via hamburger menu
    const hamburgerButton = page.locator('button:has(svg.lucide-menu)')
    if (await hamburgerButton.isVisible()) {
      await hamburgerButton.click()
      await page.getByText(listName).click()
    }

    // Find settings button in mobile header
    const mobileSettingsButton = page.locator('button:has(svg.lucide-settings)').first()
    await expect(mobileSettingsButton).toBeVisible()
    await mobileSettingsButton.click()

    // Capture mobile behavior
    const mobileHasFullPopover = await page.getByRole('heading', { name: /list settings/i }).isVisible()
    const mobileHasTabs = await page.getByRole('tab', { name: /membership/i }).isVisible()

    // Assert desktop and mobile behaviors match
    expect(desktopHasFullPopover).toBe(mobileHasFullPopover)
    expect(desktopHasTabs).toBe(mobileHasTabs)
  })
})
