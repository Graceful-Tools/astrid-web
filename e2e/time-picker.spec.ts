/**
 * E2E regression for the TimePicker in its real contexts.
 *
 * Covers the "Set Time" button visibility bug where the popover was rendered
 * but the confirmation button was occluded by a higher-z-index overlay, and
 * that a choice made in the picker is what gets saved.
 *
 * Runs signed in, in the authenticated-ui project (AWTD-1425).
 */

import { test, expect } from '@playwright/test'
import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

const DESKTOP_VIEWPORT = { width: 1440, height: 900 }

/** The open picker. Scoped, because "9am" also names a preset elsewhere on the page. */
const picker = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('button', { name: /^set time$/i }) })

async function expectUnoccluded(page: Page, button: Locator) {
  const box = await button.boundingBox()
  expect(box).not.toBeNull()
  const topText = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.textContent?.trim() ?? null,
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
  )
  expect(topText?.toLowerCase()).toContain('set time')
}

async function postJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

// /settings/reminders shows the reminder settings: the daily digest time comes
// first, then quiet hours' start and end. Each saves as soon as it changes.
test.describe('TimePicker — reminder settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await gotoWithRetry(page, '/settings/reminders')
  })

  test('popover opens with a visible, clickable "Set Time" button', async ({ page }) => {
    await page.locator('button', { has: page.locator('svg.lucide-clock') }).first().click()

    const setTime = picker(page).getByRole('button', { name: /^set time$/i })
    await expect(setTime).toBeVisible()
    await expectUnoccluded(page, setTime)
  })

  test('a quick preset closes the popover and is saved', async ({ page, request }) => {
    await page.locator('button', { has: page.locator('svg.lucide-clock') }).first().click()

    const saved = page.waitForResponse(
      r => r.url().includes('/api/v1/users/me/reminder-settings') && r.request().method() === 'PUT'
    )
    await picker(page).getByRole('button', { name: /^9am$/i }).click()
    await expect(page.getByRole('button', { name: /^set time$/i })).toHaveCount(0)
    expect((await saved).ok()).toBeTruthy()

    const response = await request.get('/api/v1/users/me/reminder-settings')
    expect((await response.json()).dailyDigestTime).toBe('09:00')
  })
})

test.describe('TimePicker — in task detail', () => {
  test('the picker opens above the task panel, and a preset sets that time on the task', async ({ page, request }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    const { list } = await postJson<{ list: { id: string } }>(request, '/api/v1/lists', {
      name: `Time picker ${Date.now()}`,
      privacy: 'PRIVATE',
    })
    // An all-day task, so the Time row renders with no time yet.
    const { task } = await postJson<{ task: { id: string } }>(request, '/api/v1/tasks', {
      title: `Timed ${Date.now()}`,
      listIds: [list.id],
      dueDateTime: '2026-11-20T00:00:00.000Z',
      isAllDay: true,
    })

    await gotoWithRetry(page, `/lists/${list.id}?task=${task.id}`)
    const timeRow = page.getByTestId('when-time')
    await expect(timeRow).toBeVisible()
    await timeRow.click()
    await timeRow.locator('button', { has: page.locator('svg.lucide-clock') }).click()

    const setTime = picker(page).getByRole('button', { name: /^set time$/i })
    await expect(setTime).toBeVisible()
    await expectUnoccluded(page, setTime)

    await picker(page).getByRole('button', { name: /^9am$/i }).click()
    await expect
      .poll(async () => {
        const body = await (await request.get(`/api/v1/tasks/${task.id}`)).json()
        const saved = body.task as { dueDateTime: string; isAllDay: boolean }
        // The browser's local 9:00 on the same day.
        return { isAllDay: saved.isAllDay, hour: await page.evaluate(iso => new Date(iso).getHours(), saved.dueDateTime) }
      })
      .toEqual({ isAllDay: false, hour: 9 })
  })
})

test.describe('TimePicker — quiet hours', () => {
  test('both start and end time pickers render the "Set Time" button', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await gotoWithRetry(page, '/settings/reminders')

    await page.getByText(/quiet hours/i).first().scrollIntoViewIfNeeded()
    const timeTriggers = page.locator('button', { has: page.locator('svg.lucide-clock') })
    // Daily digest time, plus quiet hours' start and end.
    expect(await timeTriggers.count()).toBeGreaterThanOrEqual(3)

    for (const index of [1, 2]) {
      await timeTriggers.nth(index).click()
      await expect(picker(page).getByRole('button', { name: /^set time$/i })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: /^set time$/i })).toHaveCount(0)
    }
  })
})
