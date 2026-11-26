import { test, expect } from '@playwright/test'
import type { CDPSession, Page } from '@playwright/test'

/**
 * Passkey sign-up and sign-in, with a virtual authenticator (ADEV-297).
 *
 * auth.spec.ts checks only that the passkey button exists. This registers a new account with a
 * passkey through the sign-in page, drops the session, and signs in again as a returning user. The
 * authenticator is Chromium's CDP virtual one (WebAuthn.addVirtualAuthenticator): a resident,
 * user-verifying CTAP2 device that approves every ceremony on its own, so nothing here waits on a
 * prompt or a sleep. Each step is read back from the app, so a pass means the session is real.
 */

// The passkey routes allow 10 requests a minute per IP (passkeyRateLimiter) and this journey makes
// four, so it runs once per spec run. A --repeat-each above 2 inside one minute meets "Too many
// requests" from the limiter, not a flake in the flow.

// Start signed out: this spec makes its own account.
test.use({ storageState: { cookies: [], origins: [] } })

async function addVirtualAuthenticator(page: Page): Promise<{ cdp: CDPSession; authenticatorId: string }> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable', { enableUI: false })
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  return { cdp, authenticatorId }
}

async function openPasskeyDialog(page: Page) {
  await page.goto('/auth/signin')
  await expect(page.getByText('Sign in to get started!')).toBeVisible({ timeout: 15_000 })
  const passkey = page.getByRole('button', { name: /continue with passkey/i })
  await expect(passkey).toBeEnabled()
  await passkey.click()
  await expect(page.locator('#passkey-email')).toBeVisible()
}

async function currentUserEmail(page: Page): Promise<string | undefined> {
  const response = await page.request.get('/api/auth/session')
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { user?: { email?: string } } | null)?.user?.email
}

test.describe('Passkey sign-in (ADEV-297)', () => {
  test('a new account registers with a passkey, then a returning user signs in with it', async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000)
    const email = `passkey-${Date.now()}@example.test`
    const { cdp, authenticatorId } = await addVirtualAuthenticator(page)

    // New user: the email goes in, the authenticator makes the credential, and the app signs in.
    await openPasskeyDialog(page)
    await page.locator('#passkey-email').fill(email)
    await page.getByRole('button', { name: /continue with passkey/i }).click()
    await expect.poll(() => currentUserEmail(page), { timeout: 30_000 }).toBe(email)
    await expect(page).not.toHaveURL(/\/auth\/signin/)

    // The authenticator now holds the one credential the ceremony created.
    const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId })
    expect(credentials).toHaveLength(1)

    // Sign out by dropping the session. The credential stays on the authenticator.
    await context.clearCookies()
    expect(await currentUserEmail(page)).toBeUndefined()

    // Returning user: no email, and the discoverable credential signs them in.
    await openPasskeyDialog(page)
    await page.getByRole('button', { name: /continue with passkey/i }).click()
    await expect.poll(() => currentUserEmail(page), { timeout: 30_000 }).toBe(email)
  })
})
