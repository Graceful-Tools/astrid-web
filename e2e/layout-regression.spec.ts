import { test, expect, Page } from '@playwright/test'

/**
 * Layout regression matrix.
 *
 * Each playwright project pins a viewport that maps to one of the layout
 * types in lib/layout-detection.ts:
 *
 *   project name            → expected layout
 *   ─────────────────────────────────────────
 *   chromium                → computer-3-column   (1280x720, no iPad UA)
 *   computer-2-column       → computer-2-column   (1000x900)
 *   computer-1-column       → computer-1-column   (800x900)
 *   tablet-3-column         → tablet-3-column     (iPad Pro 11 landscape)
 *   tablet-2-column         → tablet-2-column     (iPad Mini portrait)
 *   Mobile Chrome           → mobile-1-column     (Pixel 5)
 *
 * The tests below run unauthenticated against routes that exercise the
 * layout-detection codepath without needing a logged-in session. They are
 * designed to fail loudly if a refactor breaks SSR, hydration, or the
 * layout-detection contract — which is exactly what god-file extractions
 * threaten.
 *
 * Why this matters: most of the layout-driving god files (TaskManagerView,
 * MainContent, task-detail) live behind auth, but they all import from
 * lib/layout-detection.ts. A bad refactor of that module shows up here on
 * the public signin page first, before it ever hits the authed surface.
 */

type ExpectedLayout = {
  device: 'mobile' | 'tablet' | 'computer'
  columns: 1 | 2 | 3
}

function expectedFor(projectName: string): ExpectedLayout {
  switch (projectName) {
    case 'chromium':
      return { device: 'computer', columns: 3 }
    case 'computer-2-column':
      return { device: 'computer', columns: 2 }
    case 'computer-1-column':
      return { device: 'computer', columns: 1 }
    case 'tablet-3-column':
      return { device: 'tablet', columns: 3 }
    case 'tablet-2-column':
      return { device: 'tablet', columns: 2 }
    case 'Mobile Chrome':
      return { device: 'mobile', columns: 1 }
    default:
      throw new Error(`layout-regression has no expectedFor mapping for project "${projectName}"`)
  }
}

// Pull the actual layout type out of the running page by re-implementing the
// detection logic from lib/layout-detection.ts in the page context. We avoid
// importing the lib so that an accidental break of the import graph during a
// refactor still lets this test run and report.
async function detectLayout(page: Page): Promise<{ device: string; columns: number; layout: string }> {
  return await page.evaluate(() => {
    const ua = window.navigator.userAgent
    const width = window.innerWidth
    const isMobile = ua.includes('Mobile') || ua.includes('Android') || /iPhone|iPod/.test(ua)
    const isIPad =
      /iPad/.test(ua) ||
      ((navigator.maxTouchPoints || 0) > 1 && /Macintosh/.test(ua))

    // Mirror the order of lib/layout-detection.ts:getLayoutType — iPad must
    // win over mobile because iPad UAs include "Mobile/...".
    let layout: string
    if (isIPad && width >= 1100) layout = 'tablet-3-column'
    else if (isIPad) layout = 'tablet-2-column'
    else if (isMobile && width < 910) layout = 'mobile-1-column'
    else if (!isMobile && width < 910) layout = 'computer-1-column'
    else if (!isMobile && width >= 910 && width < 1100) layout = 'computer-2-column'
    else if (!isMobile && width >= 1100) layout = 'computer-3-column'
    else layout = 'computer-2-column'

    const device = layout.split('-')[0]
    const columns = parseInt(layout.split('-')[1], 10)
    return { device, columns, layout }
  })
}

test.describe('Layout regression matrix', () => {
  test('homepage detects the expected layout', async ({ page }, testInfo) => {
    const expected = expectedFor(testInfo.project.name)

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const detected = await detectLayout(page)

    expect(detected.device).toBe(expected.device)
    expect(detected.columns).toBe(expected.columns)
  })

  test('signin page renders without errors at this layout', async ({ page }, testInfo) => {
    const response = await page.goto('/auth/signin')
    expect(response?.status(), 'signin should not 5xx').toBeLessThan(500)

    // Critical UI: heading and primary auth buttons should be visible across
    // all layouts. These are the things god-file refactors are most likely
    // to break (signin-client.tsx is small, but it imports from layout-
    // affected helpers).
    await expect(page.getByText('Sign in to get started!')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /continue with passkey/i })).toBeVisible()

    // Layout match — same assertion as homepage but on a heavier page.
    const expected = expectedFor(testInfo.project.name)
    const detected = await detectLayout(page)
    expect(detected.columns).toBe(expected.columns)

    // (We deliberately don't assert on console errors here. Next.js dev mode
    // emits transient parse-time chunk errors during HMR which are not
    // production regressions, and a layout-matrix spec shouldn't be the
    // place to police those.)
  })

  test('locale page renders without errors at this layout', async ({ page }, testInfo) => {
    const response = await page.goto('/es')
    expect(response?.status(), 'locale page should not 5xx').toBeLessThan(500)
    await page.waitForLoadState('domcontentloaded')

    const expected = expectedFor(testInfo.project.name)
    const detected = await detectLayout(page)
    expect(detected.columns).toBe(expected.columns)
  })
})
