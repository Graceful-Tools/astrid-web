import { test, expect } from '@playwright/test'

/**
 * Regression: standalone document pages could not be scrolled on web, so
 * everything below the fold was unreachable (reported for /privacy and /terms
 * while logged out).
 *
 * Cause: `styles/components.css` locks `html, body { overflow: hidden }` so the
 * task-manager shell owns scrolling. Pages whose root was only `min-h-screen`
 * grew past the clipped viewport instead of scrolling. Each such page now owns
 * a viewport scroll surface (`scrollShellClassName` / `<ScrollShell>`).
 */
const DOCUMENT_PAGES = [
  '/privacy',
  '/terms',
  '/help',
  '/docs',
  '/docs/endpoints',
  '/docs/mcp',
  '/docs/integrate',
  '/auth/signin',
  '/astrid-coding',
  '/github-setup',
]

for (const path of DOCUMENT_PAGES) {
  test(`${path} scrolls to the bottom of its content`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' })

    // The scroll surface: a near-viewport-height element with real overflow.
    const findShell = () =>
      page.evaluate(() => {
        const shell = [...document.querySelectorAll('*')].find(
          (el) =>
            /auto|scroll/.test(getComputedStyle(el).overflowY) &&
            el.scrollHeight > el.clientHeight + 4 &&
            el.clientHeight > window.innerHeight * 0.6
        ) as HTMLElement | undefined
        if (!shell) return null
        return {
          scrollTop: Math.round(shell.scrollTop),
          maxScroll: shell.scrollHeight - shell.clientHeight,
        }
      })

    const before = await findShell()
    // Short pages that fit the viewport have nothing to scroll — not a bug.
    test.skip(before === null, 'content fits within the viewport')

    // Wheel over the page centre. Retried via poll because a client page can
    // still be hydrating when the first wheel event lands.
    await page.mouse.move(200, 300)
    await expect
      .poll(
        async () => {
          await page.mouse.wheel(0, 20000)
          await page.waitForTimeout(300)
          const state = await findShell()
          if (!state) return false
          return state.scrollTop > 0 && state.scrollTop + 4 >= state.maxScroll
        },
        {
          message: `${path} could not be scrolled to the bottom of its content`,
          timeout: 10000,
        }
      )
      .toBe(true)
  })
}
