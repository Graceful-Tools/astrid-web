import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'
import { detail, freshList, postJson, row, seedTask } from './utils/v1-seed'

/**
 * Decision cards, signed in, through the UI (ADEV-297).
 *
 * The parser and the card component have unit tests, but nothing drove a tap through the app and
 * checked that the reply it posts is the one the apps agree on ("2 — <option>"). Each test reads
 * the reply back from the API, so a pass means it was saved, not just drawn.
 */

const CARDS = [
  'Which way should the export go?',
  '',
  '**Decision:** Which format do we ship first?',
  '',
  '- **1.** CSV only',
  '- **2.** CSV and JSON (recommended)',
  '- **3.** Do nothing',
].join('\n')

const GRID = [
  '**Decision:** Where should the retry live?',
  '',
  '- **1.** In the client',
  '- **2.** In the server (recommended)',
  '- **3.** Do nothing',
  '',
  '| Option | Effort | Risk |',
  '|---|---|---|',
  '| 1. In the client | + a day | - every client repeats it |',
  '| 2. In the server | ~ two days | + one place to fix |',
  '| 3. Do nothing | ++ none | -- failures stay visible |',
].join('\n')

async function replies(request: APIRequestContext, taskId: string): Promise<string[]> {
  const response = await request.get(`/api/v1/tasks/${taskId}/comments`)
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as { comments: Array<{ content: string }> }
  return body.comments.map(c => c.content)
}

test.describe('Decision cards (ADEV-297)', () => {
  test('tapping option 2 posts the reply "2 — …" and the cards go inert', async ({ page, request }) => {
    const list = await freshList(request, 'Decision cards')
    const task = await seedTask(request, [list.id], `Decide ${Date.now()}`)
    await postJson(request, `/api/v1/tasks/${task.id}/comments`, { content: CARDS, type: 'MARKDOWN' })

    await gotoWithRetry(page, `/lists/${list.id}`)
    await row(page, task.title).click()
    const cards = detail(page).getByTestId('decision-cards')
    await expect(cards.locator('.decision-card')).toHaveCount(3)

    await cards.locator('.decision-card').nth(1).click()

    await expect
      .poll(async () => (await replies(request, task.id)).some(c => /^2 — CSV and JSON/.test(c)))
      .toBe(true)

    // Answered: the chosen card is marked and none of them can be tapped again.
    await expect(cards.locator('.decision-card[data-chosen]')).toHaveCount(1)
    await expect(cards.locator('.decision-card').first()).toBeDisabled()
  })

  test('a trade-off grid with a row per option is the choice: tap a row, confirm, reply posts', async ({
    page,
    request,
  }) => {
    const list = await freshList(request, 'Decision grid')
    const task = await seedTask(request, [list.id], `Decide grid ${Date.now()}`)
    await postJson(request, `/api/v1/tasks/${task.id}/comments`, { content: GRID, type: 'MARKDOWN' })

    await gotoWithRetry(page, `/lists/${list.id}`)
    await row(page, task.title).click()
    const grid = detail(page).getByTestId('decision-grid')
    const rows = grid.locator('tbody tr')
    await expect(rows).toHaveCount(3)

    await rows.nth(1).click()
    const confirm = page.getByTestId('decision-grid-confirm')
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('2 — In the server')
    await confirm.getByRole('button', { name: /2 — In the server/ }).click()

    await expect
      .poll(async () => (await replies(request, task.id)).some(c => c.startsWith('2 — In the server')))
      .toBe(true)
    await expect(grid.locator('tbody tr[data-chosen="true"]')).toHaveCount(1)
  })
})
