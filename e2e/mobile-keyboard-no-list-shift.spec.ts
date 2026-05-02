import { test, expect } from '@playwright/test'

/**
 * Regression: on mobile web, when the user is scrolled to the bottom of a long
 * task list and taps the fixed quick-add input, iOS Safari auto-scrolls the
 * document to "reveal" the focused input — even though `position: fixed` keeps
 * it in place. The result is the floating header scrolls off-screen and the
 * list visibly slides up.
 *
 * The root cause is that nothing locks document-level scrolling, so the
 * browser can scroll <html>/<body> when it tries to bring a focused input into
 * view. The fix is to make the app shell itself the only scroll container —
 * `overflow: hidden` on html/body — so there is nothing for the browser to
 * scroll at the document level.
 *
 * We can't simulate the iOS keyboard in Playwright, so this test reproduces
 * the conditions that allow the bug:
 *   1. Load a real Astrid page so the project's globals.css/components.css
 *      are applied (page.setContent would not inherit them).
 *   2. Inject a tall scrollable list anchored to a 100dvh app shell with a
 *      fixed-position bottom input — same skeleton as the real app.
 *   3. Scroll to the bottom, focus the input, then shrink the viewport to
 *      mimic the keyboard appearing with interactive-widget=resizes-content.
 *
 * Assertions: <html>/<body> must not be document-scrollable, the document's
 * scrollY must remain 0, and the floating header must remain at the top of
 * the visual viewport.
 */

const SKELETON = `
  <div class="app-container" style="position:relative; height:100dvh; display:flex; flex-direction:column; overflow-x:hidden;">
    <div data-testid="header" style="position:fixed; top:0; left:0; right:0; height:44px; z-index:50; background:white;">List Header</div>
    <div style="flex:1 1 0%; min-height:0; display:flex; position:relative;">
      <div style="position:absolute; inset:0;">
        <div data-testid="list" id="kb-list" style="height:calc(100% - 80px); overflow-y:auto;"></div>
      </div>
    </div>
  </div>
  <div style="position:fixed; bottom:env(safe-area-inset-bottom, 0.75rem); left:8px; right:8px; background:white; padding:12px;">
    <input data-testid="quick-add-input" style="width:100%; font-size:16px;" />
  </div>
`

test.describe('Mobile keyboard does not shift the task list', () => {
  test('focusing quick-add at the bottom of a long list does not allow document scroll', async ({ page }) => {
    // Load a real Astrid page so the production CSS (globals + components) is applied.
    await page.goto('/auth/signin')
    await page.waitForLoadState('networkidle')

    // Replace the body with our skeleton. Inherits the loaded stylesheets.
    await page.evaluate((html) => {
      document.body.innerHTML = html
      const list = document.getElementById('kb-list') as HTMLElement
      for (let i = 0; i < 60; i++) {
        const t = document.createElement('div')
        t.textContent = 'Task ' + (i + 1)
        t.style.cssText = 'height:64px; border:1px solid #ddd; margin:4px 8px; padding:0 12px; display:flex; align-items:center;'
        list.appendChild(t)
      }
    }, SKELETON)

    const list = page.getByTestId('list')
    const header = page.getByTestId('header')
    const input = page.getByTestId('quick-add-input')

    // Scroll to the very bottom — this is the trigger condition.
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight })

    const headerTopBefore = await header.evaluate((el) => el.getBoundingClientRect().top)
    expect(headerTopBefore).toBeLessThanOrEqual(10)

    // Focus the input. In real iOS Safari this raises the keyboard. We then
    // simulate the keyboard by shrinking the viewport — interactive-widget
    // would otherwise do this automatically.
    await input.focus()
    const initialViewport = page.viewportSize()!
    await page.setViewportSize({
      width: initialViewport.width,
      height: Math.floor(initialViewport.height * 0.55),
    })
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())))

    // The document itself must NOT be scrollable. Checking computed styles
    // directly: the fix is overflow:hidden on html/body in styles/components.css.
    const htmlOverflowY = await page.evaluate(() => window.getComputedStyle(document.documentElement).overflowY)
    const bodyOverflowY = await page.evaluate(() => window.getComputedStyle(document.body).overflowY)
    expect(htmlOverflowY, '<html> must have overflow-y: hidden').toBe('hidden')
    expect(bodyOverflowY, '<body> must have overflow-y: hidden').toBe('hidden')

    // And the document must not have scrolled.
    const documentScrollY = await page.evaluate(() => window.scrollY || document.documentElement.scrollTop)
    expect(documentScrollY, 'document must not scroll when focusing input near long-list bottom').toBe(0)

    // Floating header must still be at the top of the visual viewport.
    const headerTopAfter = await header.evaluate((el) => el.getBoundingClientRect().top)
    expect(headerTopAfter, 'list header must remain in view after keyboard appears').toBeLessThanOrEqual(10)
  })
})
