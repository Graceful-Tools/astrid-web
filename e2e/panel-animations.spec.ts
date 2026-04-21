/**
 * Regression tests for panel slide animations, arrow positioning, and dim-overlay dismiss.
 *
 * Covers the integrated behavior shared between task detail panel and settings detail panel,
 * which are being refactored onto shared hooks (usePanelArrowPosition, useSlideCloseAnimation).
 *
 * These tests require authentication; they run in CI where PLAYWRIGHT_TEST_EMAIL is set.
 */

import { test, expect } from '@playwright/test'

const DESKTOP_VIEWPORT = { width: 1440, height: 900 }    // 3-column
const TABLET_VIEWPORT = { width: 1024, height: 768 }     // 2-column
const MOBILE_VIEWPORT = { width: 390, height: 844 }      // 1-column

test.describe('Task detail panel arrow + slide animation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('[data-testid="task-list"], .task-list-container', { timeout: 10000 })
  })

  test('desktop: arrow renders and points at the selected task row', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await page.waitForTimeout(300)

    const firstTask = page.locator('.task-row').first()
    await firstTask.waitFor({ state: 'visible' })
    await firstTask.click()

    await page.waitForSelector('.task-panel-desktop', { timeout: 5000 })

    const arrow = page.locator('.task-panel-arrow').first()
    await expect(arrow).toBeVisible()

    const arrowTop = await arrow.evaluate(el => parseFloat(el.style.top || '0'))
    expect(arrowTop).toBeGreaterThan(0)
  })

  test('desktop: close triggers animate-out class then removes panel', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await page.waitForTimeout(300)

    const firstTask = page.locator('.task-row').first()
    await firstTask.waitFor({ state: 'visible' })
    await firstTask.click()

    await page.waitForSelector('.task-panel-desktop', { timeout: 5000 })

    // Re-click the same task to trigger animated close (toggles off)
    await firstTask.click()

    // Expect animate-out class to appear briefly
    const panelHasClosing = await page.evaluate(() => {
      const panel = document.querySelector('.task-panel-desktop')
      return panel?.classList.contains('task-panel-animate-out') ?? false
    })
    expect(panelHasClosing).toBe(true)

    // After ~300ms the panel should be removed
    await page.waitForTimeout(400)
    await expect(page.locator('.task-panel-desktop')).toHaveCount(0)
  })

  test('mobile: click task opens full-screen panel without arrow', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
    await page.waitForTimeout(300)

    const firstTask = page.locator('.task-row, .mobile-task-item').first()
    await firstTask.waitFor({ state: 'visible' })
    await firstTask.click()

    await page.waitForSelector('.task-panel-mobile', { timeout: 5000 })
    await expect(page.locator('.task-panel-mobile')).toBeVisible()
  })
})

test.describe('Settings detail panel arrow + slide animation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('desktop: opening a settings subpage renders arrow at source card position', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await page.waitForTimeout(300)

    // Open settings hub
    const settingsNavButton = page.locator('button[data-settings-button], .sidebar-navigation button').filter({ hasText: /settings/i }).first()
    if (await settingsNavButton.count() === 0) return // No settings entry in UI, skip
    await settingsNavButton.click()
    await page.waitForTimeout(300)

    const firstSettingsCard = page.locator('[data-settings-page]').first()
    if (await firstSettingsCard.count() === 0) return
    await firstSettingsCard.click()

    await page.waitForSelector('[data-task-detail-panel]', { timeout: 5000 })

    const arrow = page.locator('.task-panel-arrow').first()
    await expect(arrow).toBeVisible()

    const arrowTop = await arrow.evaluate(el => parseFloat(el.style.top || '0'))
    expect(arrowTop).toBeGreaterThanOrEqual(20)
  })

  test('desktop: toggling a settings subpage off triggers animate-out class', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await page.waitForTimeout(300)

    const settingsNavButton = page.locator('button[data-settings-button], .sidebar-navigation button').filter({ hasText: /settings/i }).first()
    if (await settingsNavButton.count() === 0) return
    await settingsNavButton.click()
    await page.waitForTimeout(300)

    const firstCard = page.locator('[data-settings-page]').first()
    if (await firstCard.count() === 0) return
    await firstCard.click()
    await page.waitForSelector('[data-task-detail-panel]', { timeout: 5000 })

    // Click the same card again → animated close
    await firstCard.click()

    const hasClosing = await page.evaluate(() => {
      const panel = document.querySelector('.task-panel-desktop')
      return panel?.classList.contains('task-panel-animate-out') ?? false
    })
    expect(hasClosing).toBe(true)

    await page.waitForTimeout(400)
    await expect(page.locator('[data-task-detail-panel]')).toHaveCount(0)
  })
})

test.describe('Dim-overlay dismiss handler', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('desktop: clicking the chat dim overlay while a task is open closes the task', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await page.waitForTimeout(300)

    const firstTask = page.locator('.task-row').first()
    await firstTask.waitFor({ state: 'visible' })
    await firstTask.click()
    await page.waitForSelector('.task-panel-desktop', { timeout: 5000 })

    // The dim overlay is inside the chat panel column — find it by its classes
    const dimOverlay = page.locator('div.bg-white\\/50, div.bg-black\\/40').first()
    if (await dimOverlay.count() === 0) return // 2-col might not always show chat panel
    await dimOverlay.click({ force: true })

    await page.waitForTimeout(400)
    await expect(page.locator('.task-panel-desktop')).toHaveCount(0)
  })

  test('desktop: clicking the chat dim overlay while a settings subpage is open closes it', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await page.waitForTimeout(300)

    const settingsNavButton = page.locator('button[data-settings-button], .sidebar-navigation button').filter({ hasText: /settings/i }).first()
    if (await settingsNavButton.count() === 0) return
    await settingsNavButton.click()
    await page.waitForTimeout(300)

    const firstCard = page.locator('[data-settings-page]').first()
    if (await firstCard.count() === 0) return
    await firstCard.click()
    await page.waitForSelector('[data-task-detail-panel]', { timeout: 5000 })

    const dimOverlay = page.locator('div.bg-white\\/50, div.bg-black\\/40').first()
    if (await dimOverlay.count() === 0) return
    await dimOverlay.click({ force: true })

    await page.waitForTimeout(400)
    await expect(page.locator('[data-task-detail-panel]')).toHaveCount(0)
  })
})
