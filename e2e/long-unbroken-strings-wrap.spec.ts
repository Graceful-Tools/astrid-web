/**
 * AWTD2-176 — "Long task string break comment column width."
 *
 * A URL or any other run with no spaces overflowed the comment column, and the
 * task description with it (measured at 360px: 1986px of comment text in a
 * 280px bubble). Both now break such a run anywhere; a code block must still
 * keep its lines and scroll sideways inside itself instead.
 *
 * jsdom does no layout, so the vitest test can only pin the CSS rule; this
 * spec checks the layout itself at phone width in the real task detail.
 */
import { test, expect, devices } from '@playwright/test'
import type { APIRequestContext, Locator } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

test.use({ ...devices['Pixel 5'] })

async function createJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

const LONG_RUN = 'https://example.com/' + 'averyveryverylongunbrokenstringwithnospaces'.repeat(6)
const LONG_CODE_LINE = 'const x = ' + 'y'.repeat(200)

/** scrollWidth and clientWidth of an element, to compare content width with its box. */
function widths(locator: Locator) {
  return locator.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }))
}

test.describe('Long unbroken strings wrap in the task detail (AWTD2-176)', () => {
  test('a long comment and description stay inside their column; a code block still scrolls', async ({ page, request }) => {
    const suffix = Date.now()
    const list = await createJson<{ id: string }>(request, '/api/lists', {
      name: `Long strings ${suffix}`,
      description: '',
      privacy: 'PRIVATE',
    })
    const title = `Long strings wrap ${suffix}`
    const task = await createJson<{ id: string }>(request, '/api/tasks', {
      title,
      description: `See ${LONG_RUN}`,
      listIds: [list.id],
      priority: 0,
      repeating: 'never',
    })
    await createJson(request, `/api/v1/tasks/${task.id}/comments`, { content: `Look: ${LONG_RUN}`, type: 'MARKDOWN' })
    await createJson(request, `/api/v1/tasks/${task.id}/comments`, {
      content: ['```', LONG_CODE_LINE, '```'].join('\n'),
      type: 'MARKDOWN',
    })

    await gotoWithRetry(page, `/lists/${list.id}`)
    await page.getByText(title).first().tap()
    const textBubble = page.locator('.chat-bubble').filter({ hasText: 'Look:' }).first()
    await expect(textBubble).toBeVisible()
    await page.waitForTimeout(500) // the panel's slide-in

    const comment = await widths(textBubble.locator('.prose'))
    expect(comment.scroll, 'comment text fits its bubble').toBeLessThanOrEqual(comment.client + 1)

    const description = await widths(page.locator('.prose').filter({ hasText: 'See https://example.com/' }).first())
    expect(description.scroll, 'description fits its column').toBeLessThanOrEqual(description.client + 1)

    const pre = page.locator('.chat-bubble pre').first()
    await expect(pre).toBeVisible()
    const code = await widths(pre)
    expect(code.scroll, 'the code line keeps its length').toBeGreaterThan(code.client + 1)
    expect(await pre.evaluate(el => getComputedStyle(el).overflowX), 'the code block scrolls').toBe('auto')
    const bubble = (await pre.locator('xpath=ancestor::*[contains(@class,"chat-bubble")][1]').boundingBox())!
    expect(bubble.x + bubble.width, 'the code bubble ends on screen').toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  })
})
