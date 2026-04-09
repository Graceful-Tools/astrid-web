import { test, expect } from '@playwright/test'

/**
 * Example E2E Test
 *
 * This is a template showing how to write E2E tests for Astrid.
 * Use this as a reference when creating new test files.
 */

test.describe('Example Test Suite', () => {
  // Run before each test in this suite
  test.beforeEach(async ({ page }) => {
    // Navigate to the page you want to test
    await page.goto('/')

    // Wait for page to be ready (if needed)
    await page.waitForLoadState('networkidle')
  })

  test('should load the home page', async ({ page }) => {
    // Check that main content is visible
    const main = page.getByRole('main')
    await expect(main).toBeVisible()

    // Check for specific heading
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toBeVisible()
  })

  test('should interact with a button', async ({ page }) => {
    // Find button by role and name
    const button = page.getByRole('button', { name: /click me/i })

    // Click the button
    await button.click()

    // Verify the result
    await expect(page.getByText('Button clicked!')).toBeVisible()
  })

  test('should fill and submit a form', async ({ page }) => {
    // Find form inputs
    const nameInput = page.getByLabel(/name/i)
    const emailInput = page.getByLabel(/email/i)

    // Fill the form
    await nameInput.fill('John Doe')
    await emailInput.fill('john@example.com')

    // Submit the form
    const submitButton = page.getByRole('button', { name: /submit/i })
    await submitButton.click()

    // Wait for API response
    await page.waitForResponse(response =>
      response.url().includes('/api/submit') && response.status() === 200
    )

    // Verify success message
    await expect(page.getByText(/success/i)).toBeVisible()
  })

  test('should handle keyboard navigation', async ({ page }) => {
    // Press Tab to focus first element
    await page.keyboard.press('Tab')

    // Verify focus is on expected element
    const focused = page.locator(':focus')
    await expect(focused).toBeVisible()

    // Press Enter to activate
    await page.keyboard.press('Enter')
  })

  test('should handle mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })

    // Test mobile-specific UI
    const mobileMenu = page.getByRole('button', { name: /menu/i })
    await expect(mobileMenu).toBeVisible()
  })

  test('should wait for animations', async ({ page }) => {
    const button = page.getByRole('button', { name: /animate/i })
    await button.click()

    // Wait for animation to complete
    await page.waitForTimeout(500)

    // Or wait for specific state
    const animatedElement = page.locator('.animated')
    await expect(animatedElement).toHaveClass(/complete/)
  })

  test('should handle dynamic content', async ({ page }) => {
    // Wait for dynamic content to load
    await page.waitForSelector('[data-loaded="true"]')

    // Or wait for specific text
    await expect(page.getByText('Content loaded')).toBeVisible()
  })

  test('should test accessibility', async ({ page }) => {
    // Check for ARIA labels
    const button = page.getByRole('button', { name: /action/i })
    await expect(button).toHaveAttribute('aria-label')

    // Check for alt text on images
    const images = await page.locator('img').all()
    for (const img of images) {
      await expect(img).toHaveAttribute('alt')
    }
  })

  test('should handle errors gracefully', async ({ page }) => {
    // Trigger an error
    const errorButton = page.getByRole('button', { name: /cause error/i })
    await errorButton.click()

    // Verify error message is shown
    const errorMessage = page.getByRole('alert').or(
      page.getByText(/error/i)
    )
    await expect(errorMessage).toBeVisible()
  })

  test('should test with different locator strategies', async ({ page }) => {
    // By role (preferred)
    const button1 = page.getByRole('button', { name: /click/i })

    // By test ID
    const button2 = page.getByTestId('submit-button')

    // By label
    const input1 = page.getByLabel('Email')

    // By placeholder
    const input2 = page.getByPlaceholder('Enter your email')

    // By text
    const element1 = page.getByText('Hello World')

    // By CSS selector (avoid if possible)
    const element2 = page.locator('.my-class')

    // Chained locators
    const element3 = page.locator('.container').getByRole('button')

    // Filter locators
    const element4 = page.getByRole('listitem').filter({ hasText: 'Active' })
  })

  // Test with custom timeout
  test('should handle slow operation', async ({ page }) => {
    test.setTimeout(60000) // 60 seconds

    await page.goto('/slow-page')
    await expect(page.getByText('Loaded')).toBeVisible({ timeout: 30000 })
  })
})

// Test hooks
test.describe('Test Lifecycle Hooks', () => {
  test.beforeAll(async () => {
    // Run once before all tests in this suite
    console.log('Setting up test suite...')
  })

  test.beforeEach(async ({ page }) => {
    // Run before each test
    await page.goto('/')
  })

  test.afterEach(async ({ page }) => {
    // Run after each test (cleanup)
    await page.close()
  })

  test.afterAll(async () => {
    // Run once after all tests in this suite
    console.log('Cleaning up test suite...')
  })

  test('example test', async ({ page }) => {
    await expect(page.locator('main')).toBeVisible()
  })
})
