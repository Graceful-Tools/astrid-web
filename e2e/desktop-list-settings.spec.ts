import path from 'node:path'
import { test, expect } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

/**
 * The list header's gear opens List Settings (AWTD-1425).
 *
 * What an owner and a member each see in it, and that it is the same dialog at
 * desktop and phone widths. Sort & Filters is a separate header control
 * (AWTD-1356), not a tab or an entry inside this dialog.
 */

const MEMBER_EMAIL = 'playwright-outsider@example.test'

async function ownerList(request: APIRequestContext, label: string): Promise<{ id: string; name: string }> {
  const response = await request.post('/api/v1/lists', { data: { name: `${label} ${Date.now()}`, privacy: 'PRIVATE' } })
  expect(response.ok(), await response.text()).toBeTruthy()
  return ((await response.json()) as { list: { id: string; name: string } }).list
}

/** The list's own gear — not the sidebar's user-settings gear, which is also a lucide-settings icon. */
async function openListSettings(page: Page) {
  await page.getByRole('button', { name: 'Admin Settings' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  return page.getByRole('dialog')
}

test.describe('List Settings from the list header gear', () => {
  for (const [layout, viewport] of [
    ['desktop', { width: 1920, height: 1080 }],
    ['phone', { width: 390, height: 844 }],
  ] as const) {
    test(`the owner gets the full settings dialog (${layout})`, async ({ page, request }) => {
      await page.setViewportSize(viewport)
      const list = await ownerList(request, `Owner settings ${layout}`)
      await gotoWithRetry(page, `/lists/${list.id}`)

      const dialog = await openListSettings(page)
      await expect(dialog.getByRole('heading', { name: 'List Settings' })).toBeVisible()
      await expect(dialog.getByRole('tab', { name: /membership/i })).toBeVisible()
      await expect(dialog.getByRole('tab', { name: /admin settings/i })).toBeVisible()
      await expect(dialog.getByRole('tab', { name: /sort & filters/i })).toHaveCount(0)

      // Sort & Filters lives in the header instead.
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: 'Sort & Filters' })).toBeVisible()
    })
  }

  test('a member sees List Details with Membership and Leave List, and no admin settings', async ({ request, browser }) => {
    const list = await ownerList(request, 'Member settings')
    const added = await request.post(`/api/v1/lists/${list.id}/members`, { data: { email: MEMBER_EMAIL, role: 'member' } })
    expect(added.ok(), await added.text()).toBeTruthy()

    const member = await browser.newContext({ storageState: path.resolve('.auth', 'outsider.json'), viewport: { width: 1920, height: 1080 } })
    try {
      const page = await member.newPage()
      await gotoWithRetry(page, `/lists/${list.id}`)

      const dialog = await openListSettings(page)
      await expect(dialog.getByRole('heading', { name: 'List Details' })).toBeVisible()
      await expect(dialog.getByRole('tab', { name: /membership/i })).toBeVisible()
      await expect(dialog.getByRole('tab', { name: /admin settings/i })).toHaveCount(0)
      await dialog.getByRole('tab', { name: /membership/i }).click()
      await expect(dialog.getByRole('button', { name: /leave list/i })).toBeVisible()
    } finally {
      await member.close()
    }
  })
})
