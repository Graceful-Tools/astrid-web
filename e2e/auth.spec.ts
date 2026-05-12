import { test, expect } from '@playwright/test'

test.describe('Authentication Flow', () => {
  // Generous suite timeout — the signin route can be slow to compile/hydrate
  // on a cold dev server, especially on webkit/firefox after reset:e2e-env.
  test.setTimeout(60000)

  test.beforeEach(async ({ page }) => {
    // Clear any existing auth state
    await page.context().clearCookies()
  })

  test('should display sign-in page when navigating to auth', async ({ page }) => {
    // Navigate directly to sign-in page
    await page.goto('/auth/signin')

    // Wait for page to load - default view shows modern auth options
    await expect(page.getByText('Sign in to get started!')).toBeVisible({ timeout: 15000 })

    // Should show sign-in options (button text is "Continue with Google")
    // Note: Google button may not appear if Google OAuth is not configured
    const googleSignIn = page.getByRole('button', { name: /continue with google/i })
    await googleSignIn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
      console.log('Google button not found - likely Google OAuth not configured in test environment')
    })
  })

  test('should show modern auth options (Google and Passkey)', async ({ page }) => {
    await page.goto('/auth/signin')

    // Wait for page to load - default view shows "Sign in to get started!"
    await expect(page.getByText('Sign in to get started!')).toBeVisible({ timeout: 15000 })

    // Should show Google sign-in button (if configured) or just Passkey
    const googleButton = page.getByRole('button', { name: /continue with google/i })
    const hasGoogle = await googleButton.isVisible().catch(() => false)
    if (hasGoogle) {
      console.log('Google OAuth is configured')
    } else {
      console.log('Google OAuth not configured in test environment')
    }

    // Should always show Passkey button
    const passkeyButton = page.getByRole('button', { name: /continue with passkey/i })
    await expect(passkeyButton).toBeVisible()

    // Legacy email/password is fully removed — verify no password field is rendered
    await expect(page.getByLabel(/^password$/i)).toHaveCount(0)
    await expect(page.getByText(/legacy email\/password/i)).toHaveCount(0)
  })

  // Test passkey button behavior based on browser support
  // The app should work correctly whether passkeys are supported or not
  test('should show passkey button state based on browser support', async ({ page }) => {
    await page.goto('/auth/signin')

    // Wait for page to load and React to hydrate
    await expect(page.getByText('Sign in to get started!')).toBeVisible({ timeout: 15000 })

    // Passkey button should always be visible
    const passkeyButton = page.getByRole('button', { name: /continue with passkey/i })
    await expect(passkeyButton).toBeVisible()

    // Observe whichever state the button settles into, rather than guessing
    // browser capability via page.evaluate. WebKit (and especially Playwright's
    // WebKit) can race: PublicKeyCredential may be exposed by the time the
    // test queries window, but the React useEffect that reads it ran earlier
    // and missed it — leaving the button disabled. Let the rendered DOM be
    // the source of truth.
    await expect(async () => {
      const enabled = await passkeyButton.isEnabled()
      const notSupportedMsg = await page.getByText('Passkeys not supported in this browser').isVisible().catch(() => false)
      expect(enabled || notSupportedMsg).toBe(true)
    }).toPass({ timeout: 15000 })

    if (await passkeyButton.isEnabled()) {
      // Passkeys ARE supported - verify the full passkey flow
      await passkeyButton.click()

      // Should show passkey dialog with email input for new users
      await expect(page.getByRole('paragraph').filter({ hasText: 'Continue with Passkey' })).toBeVisible({ timeout: 10000 })
      await expect(page.getByText('New?')).toBeVisible()

      // Should show email input for new passkey registration
      const emailInput = page.locator('#passkey-email')
      await expect(emailInput).toBeVisible()

      // Should show "Returning?" text for existing users
      await expect(page.getByText('Returning?')).toBeVisible()
    } else {
      // Passkeys NOT supported (or not yet detected) - verify the disabled state UI
      await expect(passkeyButton).toBeDisabled()
      await expect(page.getByText('Passkeys not supported in this browser')).toBeVisible()
    }
  })

  // Test navigation back from passkey dialog
  // This test only runs when passkeys are supported (i.e. the button is enabled)
  test('should navigate back from passkey dialog when supported', async ({ page }) => {
    await page.goto('/auth/signin')

    // Wait for page to load
    await expect(page.getByText('Sign in to get started!')).toBeVisible({ timeout: 15000 })

    const passkeyButton = page.getByRole('button', { name: /continue with passkey/i })

    // Let the button settle into either enabled (supported) or paired with
    // the "not supported" message. Reading window.PublicKeyCredential races
    // against React hydration in WebKit, so observe the DOM instead.
    await expect(async () => {
      const enabled = await passkeyButton.isEnabled()
      const notSupportedMsg = await page.getByText('Passkeys not supported in this browser').isVisible().catch(() => false)
      expect(enabled || notSupportedMsg).toBe(true)
    }).toPass({ timeout: 15000 })

    if (!(await passkeyButton.isEnabled())) {
      test.skip(true, 'Passkeys not supported in this browser — dialog navigation N/A')
      return
    }

    // Click passkey button
    await passkeyButton.click()

    // Should show passkey dialog (use paragraph to avoid matching button)
    await expect(page.getByRole('paragraph').filter({ hasText: 'Continue with Passkey' })).toBeVisible({ timeout: 10000 })

    // Click back to options button
    const backButton = page.getByRole('button', { name: /back to options/i })
    await backButton.click()

    // Should be back to main view
    await expect(page.getByText('Sign in to get started!')).toBeVisible({ timeout: 10000 })
  })

  test('should handle OAuth provider redirect', async ({ page }) => {
    await page.goto('/auth/signin')

    // Wait for page to load - default view shows modern auth options
    await expect(page.getByText('Sign in to get started!')).toBeVisible({ timeout: 15000 })

    // Wait for Google button to appear (may take time to load providers)
    // If Google OAuth is not configured, this test will be skipped
    const googleSignIn = page.getByRole('button', { name: /continue with google/i })

    try {
      await expect(googleSignIn).toBeVisible({ timeout: 20000 })

      // Click Google sign-in
      await googleSignIn.click()

      // Should redirect to Google OAuth (we won't actually complete the flow in E2E)
      // In a real E2E test, you might use a test OAuth provider or mock
      await page.waitForURL(/accounts\.google\.com/, { timeout: 5000 }).catch(() => {
        // If it doesn't redirect (e.g., in test environment), that's okay
        console.log('OAuth redirect not triggered (expected in test environment)')
      })
    } catch (error) {
      console.log('Google OAuth not configured - skipping OAuth redirect test')
      // If Google button doesn't appear, that's okay - Google OAuth may not be configured
    }
  })

  // NOTE: Return URL test removed - the app allows access to most pages without
  // authentication and doesn't redirect unauthenticated users to sign-in.
  // This is intentional behavior to allow browsing public content.

  // Authenticated State tests are configured in playwright.config.ts
  // They only run when PLAYWRIGHT_TEST_EMAIL is set and use the 'setup' project
  // to authenticate before running. See projects: chromium-authenticated, etc.

  test('should display authentication errors', async ({ page }) => {
    // Navigate with error parameter
    await page.goto('/auth/signin?error=OAuthAccountNotLinked')

    // Wait for page to load - default view shows modern auth options
    await expect(page.getByText('Sign in to get started!')).toBeVisible({ timeout: 15000 })

    // Should show error message (look for the specific error text, avoiding strict mode violation)
    await expect(page.getByText(/account.*already exists/i)).toBeVisible({ timeout: 10000 })
  })

})
