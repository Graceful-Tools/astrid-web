import { test, expect } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

/**
 * E2E Tests for Locale Navigation
 *
 * Verifies that users can navigate to different locale URLs and the pages load correctly.
 * Tests the fix for the 404 error when visiting locale-prefixed routes like /es, /fr, etc.
 */

// Extend timeout for locale tests - server may need time to compile pages
test.describe('Locale Navigation', () => {
  // Set longer timeout for all tests in this suite (60 seconds)
  test.setTimeout(60000)

  test.describe('Direct locale URL access', () => {
    test('should load Spanish locale page without 404', async ({ page }) => {
      const response = await gotoWithRetry(page, '/es')

      // Should not get 404 error
      expect(response?.status()).not.toBe(404)
      expect(response?.status()).toBeLessThan(400)

      // Use domcontentloaded instead of networkidle to avoid timeout on SSE connections
      await page.waitForLoadState('domcontentloaded')
      // Check for html lang attribute with extended timeout for hydration
      const html = page.locator('html')
      await expect(html).toHaveAttribute('lang', 'es', { timeout: 10000 })
    })

    test('should load French locale page without 404', async ({ page }) => {
      const response = await gotoWithRetry(page, '/fr')

      expect(response?.status()).not.toBe(404)
      expect(response?.status()).toBeLessThan(400)

      await page.waitForLoadState('domcontentloaded')
      const html = page.locator('html')
      await expect(html).toHaveAttribute('lang', 'fr', { timeout: 10000 })
    })

    test('should load German locale page without 404', async ({ page }) => {
      const response = await gotoWithRetry(page, '/de')

      expect(response?.status()).not.toBe(404)
      expect(response?.status()).toBeLessThan(400)

      await page.waitForLoadState('domcontentloaded')
      const html = page.locator('html')
      await expect(html).toHaveAttribute('lang', 'de', { timeout: 10000 })
    })

    test('should load English locale page without 404', async ({ page }) => {
      const response = await gotoWithRetry(page, '/en')

      expect(response?.status()).not.toBe(404)
      expect(response?.status()).toBeLessThan(400)

      await page.waitForLoadState('domcontentloaded')
      const html = page.locator('html')
      await expect(html).toHaveAttribute('lang', 'en', { timeout: 10000 })
    })
  })

  test.describe('Locale-prefixed auth routes', () => {
    test('should load Spanish auth signin page without 404', async ({ page }) => {
      const response = await gotoWithRetry(page, '/es/auth/signin')

      // Should not get 404 error
      expect(response?.status()).not.toBe(404)
      expect(response?.status()).toBeLessThan(400)

      await page.waitForLoadState('domcontentloaded')
    })

    test('should load French auth signin page without 404', async ({ page }) => {
      const response = await gotoWithRetry(page, '/fr/auth/signin')

      expect(response?.status()).not.toBe(404)
      expect(response?.status()).toBeLessThan(400)

      await page.waitForLoadState('domcontentloaded')
    })
  })

  test.describe('Root URL access (backward compatibility)', () => {
    test('should load root URL without locale prefix', async ({ page }) => {
      const response = await gotoWithRetry(page, '/')

      expect(response?.status()).not.toBe(404)
      expect(response?.status()).toBeLessThan(400)

      await page.waitForLoadState('domcontentloaded')
      // Should have an html element with a lang attribute
      const html = page.locator('html')
      await expect(html).toHaveAttribute('lang', /\w{2}/, { timeout: 10000 })
    })

    test('should load auth signin without locale prefix', async ({ page }) => {
      const response = await gotoWithRetry(page, '/auth/signin')

      // Should not get 404 error (may redirect but should not 404)
      expect(response?.status()).not.toBe(404)

      await page.waitForLoadState('domcontentloaded')
    })
  })

  test.describe('Language switcher integration', () => {
    test('should allow switching between locales', async ({ page }) => {
      // Start at root
      await page.goto('/')
      await page.waitForLoadState('domcontentloaded')

      // Try to find language switcher (may require auth)
      const languageSwitcher = page.locator('[data-testid="language-switcher"]').or(
        page.getByRole('button', { name: /language/i })
      ).or(
        page.locator('button:has-text("EN")').or(page.locator('button:has-text("ES")'))
      )

      // If language switcher exists, test it
      if (await languageSwitcher.isVisible({ timeout: 2000 }).catch(() => false)) {
        await languageSwitcher.click()

        // Look for Spanish option
        const spanishOption = page.getByRole('menuitem', { name: /español/i }).or(
          page.getByText(/español/i)
        )

        if (await spanishOption.isVisible({ timeout: 2000 }).catch(() => false)) {
          await spanishOption.click()

          // Wait for navigation
          await page.waitForLoadState('domcontentloaded')

          // URL should include /es
          expect(page.url()).toContain('/es')

          // Page should have Spanish locale
          const html = page.locator('html')
          await expect(html).toHaveAttribute('lang', 'es', { timeout: 10000 })
        }
      }
    })
  })

  test.describe('Invalid locale handling', () => {
    test('should handle invalid locale gracefully', async ({ page }) => {
      const response = await page.goto('/xx')

      // Should either redirect or show content, but not crash (500)
      expect(response?.status()).toBeLessThan(500)

      await page.waitForLoadState('domcontentloaded')
    })
  })

  test.describe('Locale URL formatting', () => {
    test('should accept locale URLs with trailing slash', async ({ page }) => {
      const response = await gotoWithRetry(page, '/es/')

      expect(response?.status()).not.toBe(404)
      expect(response?.status()).toBeLessThan(400)

      // Use domcontentloaded instead of networkidle to avoid timeout on slow connections
      await page.waitForLoadState('domcontentloaded')
    })
  })

  test.describe('API routes should not be affected by locale', () => {
    test('should access API routes without locale prefix', async ({ page }) => {
      // API routes should work without locale prefix
      const response = await page.request.get('/api/health')

      // Should not be affected by locale middleware
      expect(response.status()).not.toBe(404)
    })
  })
})
