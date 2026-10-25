import { test, expect, devices } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

// Pixel 5 so the touch flick can be synthesised over CDP (Chromium only).
// The same layout fails the same way in WebKit — measured with
// `.app-container.scrollTop = 1000` on an iPhone 13 viewport.
test.use({ ...devices['Pixel 5'], viewport: { width: 390, height: 664 } })

type ApiList = { id: string }

async function createJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

const shell = (page: Page) =>
  page.evaluate(`(() => {
    const ac = document.querySelector('.app-container')
    const header = document.querySelector('.app-header').getBoundingClientRect()
    return {
      scrollTop: ac.scrollTop,
      scrollLeft: ac.scrollLeft,
      verticalRange: ac.scrollHeight - ac.clientHeight,
      headerTop: header.top,
      headerLeft: header.left,
    }
  })()`) as Promise<{ scrollTop: number; scrollLeft: number; verticalRange: number; headerTop: number; headerLeft: number }>

test.describe('Mobile: the app shell never scrolls the floating header away', () => {
  test('flicking past the end of a long list keeps the header on screen (AWTD-1307)', async ({ page, request, browserName }) => {
    test.skip(browserName !== 'chromium', 'touch flicks are synthesised over CDP')
    const list = await createJson<ApiList>(request, '/api/lists', {
      name: `Shell flick ${Date.now()}`,
      description: '',
      privacy: 'PRIVATE',
    })
    for (let i = 0; i < 25; i += 1) {
      await createJson(request, '/api/tasks', {
        title: `Flick row ${i}`,
        description: '',
        listIds: [list.id],
        priority: 0,
        repeating: 'never',
      })
    }

    await gotoWithRetry(page, `/lists/${list.id}`)
    await expect(page.getByText('Flick row 24').first()).toBeAttached()

    // Before the fix the shell had a scroll range of exactly the header's
    // height (73px), and the flick below chained into it: header top -65.
    expect((await shell(page)).verticalRange).toBe(0)

    const cdp = await page.context().newCDPSession(page)
    for (let i = 0; i < 6; i += 1) {
      await cdp.send('Input.synthesizeScrollGesture', {
        x: 195, y: 500, yDistance: -500, speed: 2000, gestureSourceType: 'touch',
      })
    }
    const after = await shell(page)
    expect(after.scrollTop).toBe(0)
    expect(after.headerTop).toBeGreaterThanOrEqual(0)
  })

  test('with the list menu open, scrollIntoView cannot slide the shell (AWTD-1306)', async ({ page, request }) => {
    const list = await createJson<ApiList>(request, '/api/lists', {
      name: `Shell menu ${Date.now()}`,
      description: '',
      privacy: 'PRIVATE',
    })
    await gotoWithRetry(page, `/lists/${list.id}`)
    await page.locator('[data-hamburger-button]').click()
    await expect(page.locator('.ios-drawer-content-open')).toBeVisible()
    await page.waitForTimeout(500) // the 300ms drawer transition

    const open = await shell(page)
    // Before the fix: scrollLeft 320, and the header slid from x=328 back over the menu.
    await page.evaluate(`document.querySelector('[data-settings-button]').scrollIntoView({ inline: 'nearest' })`)
    const after = await shell(page)
    expect(after.scrollLeft).toBe(0)
    expect(after.headerLeft).toBe(open.headerLeft)
  })
})
