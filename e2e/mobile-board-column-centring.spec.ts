/**
 * AWTD-1305: a board column comes to rest flush with the board's padding.
 *
 * Jon: *"[whitelabel] board columns are not centered in safari, may be all
 * mobile browsers."* The screenshot showed the board at rest with the Inbox
 * column clipped off the left edge and the next one peeking in on the right,
 * about 80px past where `snap-start` should have put it — while the page's own
 * floating header was inset symmetrically, so only the board's scroller was off.
 *
 * The cause was a column sized `w-[calc(100vw-2rem)]`: a claim about the
 * VIEWPORT made by an element that lives inside a scroller. Let anything inset
 * that scroller and the column becomes wider than the snapport, and the
 * scroll-snap spec then makes every position where the snap area covers the
 * snapport a valid resting place. tests/rules/snap-carousel-is-sized-by-its-scroller.test.ts
 * holds the measurements and pins the class contract; this holds the geometry,
 * because jsdom does no layout and a class name is not a width.
 *
 * It measures the DOM rather than taking a screenshot: "the layout is broken"
 * cannot be diagnosed, or proved fixed, by looking at a picture of it.
 */

import { test, expect, devices } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

// 402×874 is the device in the screenshot, not the 390 of the iPhone 12 profile
// the other mobile specs use. The first investigation measured 390 and found
// nothing; the width is not the cause, but reproducing at the reported one
// removes the question.
// Without the profile's WebKit override: the signed-in project runs Chromium,
// the only browser CI installs (AWTD-1338).
const { defaultBrowserType: _webkit, ...iPhone12 } = devices['iPhone 12']
test.use({ ...iPhone12, viewport: { width: 402, height: 874 } })

type ApiList = { id: string; name: string; projectId?: string | null }

async function createJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

test.describe('Mobile board — columns rest where snap-start puts them (AWTD-1305)', () => {
  test('every column comes to rest flush with the board padding, after a flick', async ({ page, request }) => {
    const suffix = Date.now()
    const domainList = await createJson<ApiList>(request, '/api/lists', {
      name: `Board centring ${suffix}`,
      description: 'Domain list',
      privacy: 'SHARED',
      listType: 'regular',
    })
    await createJson(request, '/api/v1/projects/from-list', { listId: domainList.id })
    await createJson(request, '/api/tasks', {
      title: `Centring sample ${suffix}`,
      description: '',
      listIds: [domainList.id],
      priority: 0,
      repeating: 'never',
    })

    await gotoWithRetry(page, `/lists/${domainList.id}`)
    // On a phone the board is a step of the header's view rotator, list →
    // messages → board (AWTD-1183); an unscoped "Board" button matched lists.
    const rotator = page.getByTestId('header-view-rotator')
    await rotator.tap()
    await expect(rotator).toHaveAttribute('data-next', 'board')
    await rotator.tap()
    await expect(rotator).toHaveAttribute('data-current', 'board')

    const board = page.getByTestId('project-status-board')
    await expect(board).toBeVisible()

    // The invariant that was broken: the snap AREA must not exceed the
    // SNAPPORT. Once it does, the spec lets the carousel rest anywhere the area
    // covers the snapport, and no amount of flicking will centre it.
    const geometry = await board.evaluate(scroller => {
      const column = scroller.querySelector<HTMLElement>('[data-column-index]')!
      const style = getComputedStyle(scroller)
      const padding = parseFloat(style.scrollPaddingLeft) || 0
      return {
        snapport: scroller.clientWidth - padding * 2,
        column: Math.round(column.getBoundingClientRect().width),
        scrollPaddingLeft: padding,
        paddingLeft: parseFloat(style.paddingLeft) || 0,
        columns: scroller.querySelectorAll('[data-column-index]').length,
      }
    })

    expect(geometry.columns, 'a board needs several columns to be a carousel').toBeGreaterThan(1)
    expect(
      geometry.column,
      `column ${geometry.column}px must not exceed the snapport ${geometry.snapport}px — ` +
        'a wider snap area is what lets the board rest off-centre (AWTD-1305)',
    ).toBeLessThanOrEqual(geometry.snapport)

    // And the behaviour that invariant buys: wherever a flick leaves it, the
    // board settles with a column's left edge on the padding, not between two.
    const boardBox = (await board.boundingBox())!
    for (const offset of [40, 90, 170]) {
      await board.evaluate((scroller, left) => {
        scroller.scrollLeft = left
      }, offset)
      await page.waitForTimeout(400)

      const restingEdges = await board.evaluate(scroller =>
        [...scroller.querySelectorAll<HTMLElement>('[data-column-index]')].map(column =>
          Math.round(column.getBoundingClientRect().left),
        ),
      )

      // One column's leading edge sits exactly on the board's padding. The
      // others are a whole column-plus-gap away, which follows.
      const expectedEdge = Math.round(boardBox.x + geometry.paddingLeft)
      const closest = restingEdges.reduce((best, edge) =>
        Math.abs(edge - expectedEdge) < Math.abs(best - expectedEdge) ? edge : best,
      )
      expect(
        Math.abs(closest - expectedEdge),
        `after scrolling to ${offset}px no column rested on the padding — edges ${restingEdges.join(', ')}, expected one at ${expectedEdge}`,
      ).toBeLessThanOrEqual(1)
    }
  })
})
