/**
 * AITD-589 (Jon, 2026-11-04, mobile web): "Still getting issues on mobile web. Something causing
 * task details to overflow the screen."
 *
 * His screenshot: a task whose comment holds a trade-off grid, opened on a phone. The comment
 * bubble ran off the left of the screen and the right half of the panel was empty — the task
 * detail itself had been scrolled sideways, not just the grid.
 *
 * A wide grid is meant to scroll inside its own `.tradeoff-scroll` and nowhere else (AWTD-1534).
 * So this opens such a task at phone width, swipes across the grid, and then requires that no
 * element outside a `.tradeoff-scroll` is wider than its box or scrolled sideways.
 */
import { test, expect, devices } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

test.use({ ...devices['Pixel 5'] })

async function createJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

// The shape of Jon's sample: a paragraph, then a grid whose reasons are a few words long.
const GRID_COMMENT = [
  'This is one example of the format: a trade-off grid, and the question it supports. Today a card posts a reply and nothing else. These are three ways to carry it.',
  '',
  '| Option | Effort | Reach | Risk |',
  '|---|---|---|---|',
  '| 1. Render it on the web first | + half a day, renderer exists | - only web readers | + nothing new to break |',
  '| 2. Answer from the notification | -- new notification actions on both apps | ++ answers without opening | ~ two clients to keep in step |',
  '| 3. Turn the reply into a form | -- new server flow | + every client | - a new failure mode |',
].join('\n')

/** Every element, outside a grid's own scroller, that is wider than its box or scrolled sideways. */
function sidewaysOverflow(page: Page) {
  return page.evaluate(() => {
    const offenders: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body, body *'))) {
      if (el.closest('.tradeoff-scroll')) continue
      if (el.closest('[role="dialog"]')) continue
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const scrolls = style.overflowX === 'auto' || style.overflowX === 'scroll'
      const clips = style.overflowX === 'hidden' || style.overflowX === 'clip'
      if (!scrolls && !clips && el !== document.body) continue
      const tooWide = el.scrollWidth > el.clientWidth + 1
      if ((scrolls && tooWide) || el.scrollLeft !== 0) {
        offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 4).join('.')} scrollWidth=${el.scrollWidth} clientWidth=${el.clientWidth} scrollLeft=${el.scrollLeft}`)
      }
    }
    return offenders
  })
}

test.describe('Mobile: a trade-off grid never widens the task detail (AITD-589)', () => {
  test('a task with a grid comment fits the screen, before and after a sideways swipe', async ({ page, request }) => {
    const suffix = Date.now()
    const list = await createJson<{ id: string }>(request, '/api/lists', {
      name: `Grid overflow ${suffix}`,
      description: '',
      privacy: 'PRIVATE',
    })
    const task = await createJson<{ id: string }>(request, '/api/tasks', {
      title: `Sample: a decision matrix in comments ${suffix}`,
      description: '',
      listIds: [list.id],
      priority: 0,
      repeating: 'never',
    })
    await createJson(request, `/api/v1/tasks/${task.id}/comments`, { content: GRID_COMMENT, type: 'MARKDOWN' })

    await gotoWithRetry(page, `/lists/${list.id}`)
    await page.getByText(`Sample: a decision matrix in comments ${suffix}`).first().tap()
    const grid = page.locator('.tradeoff-grid').first()
    await expect(grid).toBeVisible()
    await page.waitForTimeout(500) // the panel's slide-in

    const viewport = page.viewportSize()!.width
    const bubble = page.locator('.chat-bubble').filter({ has: grid })
    const box = (await bubble.boundingBox())!
    expect(box.x, 'bubble starts on screen').toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, 'bubble ends on screen').toBeLessThanOrEqual(viewport + 1)
    expect(await sidewaysOverflow(page), 'elements scrolled or overflowing sideways').toEqual([])

    // Swipe right-to-left across the grid, as a reader does to see its last column.
    await grid.scrollIntoViewIfNeeded()
    const g = (await grid.boundingBox())!
    const height = page.viewportSize()!.height
    const cdp = await page.context().newCDPSession(page)
    for (let i = 0; i < 3; i += 1) {
      await cdp.send('Input.synthesizeScrollGesture', {
        x: Math.round(Math.min(g.x + g.width, viewport) - 40),
        y: Math.round(Math.min(Math.max(g.y + g.height / 2, 10), height - 10)),
        xDistance: -300,
        speed: 1500,
        gestureSourceType: 'touch',
      })
    }
    await page.waitForTimeout(300)
    expect(await sidewaysOverflow(page), 'after the swipe, only the grid may have scrolled').toEqual([])
    const after = (await bubble.boundingBox())!
    expect(after.x, 'bubble still starts on screen').toBeGreaterThanOrEqual(0)
  })
})
