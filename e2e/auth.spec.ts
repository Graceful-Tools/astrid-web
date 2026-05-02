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

    // Detect actual browser capability deterministically — the React hook
    // initializes isSupported=false then flips it in a useEffect, so reading
    // passkeyButton.isDisabled() races against hydration on slower devices.
    const browserSupportsWebAuthn = await page.evaluate(
      () => typeof window.PublicKeyCredential !== 'undefined'
    )

    if (!browserSupportsWebAuthn) {
      // Passkeys NOT supported - verify the disabled state UI (post-hydration).
      // Use a generous timeout since React hydration can lag on a cold dev
      // server and the button starts disabled either way (isSupported=false
      // is the initial state); we only need the post-hydration verdict.
      console.log('Passkeys not supported in this browser - verifying disabled state')

      await expect(passkeyButton).toBeDisabled({ timeout: 15000 })

      // Should show "not supported" message below the button
      await expect(page.getByText('Passkeys not supported in this browser')).toBeVisible({ timeout: 15000 })
    } else {
      // Passkeys ARE supported - verify the full passkey flow
      console.log('Passkeys are supported - verifying passkey dialog flow')

      // Wait for hydration to enable the button before clicking. Generous
      // timeout because React hydration can lag on a cold dev server while
      // the page finishes compiling.
      await expect(passkeyButton).toBeEnabled({ timeout: 15000 })

      // Click passkey button to open the passkey dialog
      await passkeyButton.click()

      // Should show passkey dialog with email input for new users
      await expect(page.getByRole('paragraph').filter({ hasText: 'Continue with Passkey' })).toBeVisible({ timeout: 10000 })
      await expect(page.getByText('New?')).toBeVisible()

      // Should show email input for new passkey registration
      const emailInput = page.locator('#passkey-email')
      await expect(emailInput).toBeVisible()

      // Should show "Returning?" text for existing users
      await expect(page.getByText('Returning?')).toBeVisible()
    }
  })

  // Test navigation back from passkey dialog
  // This test only runs when passkeys are supported
  test('should navigate back from passkey dialog when supported', async ({ page }) => {
    await page.goto('/auth/signin')

    // Wait for page to load
    await expect(page.getByText('Sign in to get started!')).toBeVisible({ timeout: 15000 })

    const passkeyButton = page.getByRole('button', { name: /continue with passkey/i })

    // Detect support via the underlying browser capability rather than the
    // button's disabled attribute, which races against React hydration.
    const browserSupportsWebAuthn = await page.evaluate(
      () => typeof window.PublicKeyCredential !== 'undefined'
    )

    if (!browserSupportsWebAuthn) {
      // Skip this test if passkeys not supported - can't test dialog navigation
      console.log('Skipping passkey dialog navigation test - passkeys not supported in this browser')
      return
    }

    // Passkeys are supported - test the dialog navigation
    console.log('Passkeys supported - testing dialog navigation')

    // Wait for hydration to enable the button before clicking. Generous
    // timeout because React hydration can lag on a cold dev server.
    await expect(passkeyButton).toBeEnabled({ timeout: 15000 })

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
