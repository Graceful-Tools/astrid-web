import { test, expect } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'
import { OUTSIDER_EMAIL, OWNER_EMAIL, addMember, freshList, seat, seedTask } from './utils/v1-seed'

/**
 * User profiles at /u/<id> (AWTD-1419).
 *
 * Rewrites the pre-AWTD-1338 user-profile spec, which had never run and
 * skipped itself whenever a link was missing. Dropped from it: the "comment
 * author" and "stop propagation" cases — comment authors are not links any
 * more (UserLink is used only in list membership), so there is nothing to
 * click. A profile lists only tasks on PUBLIC lists, and shows the email only
 * on your own profile; both are checked with a private task beside a public one.
 */

/**
 * A task is private unless made otherwise, even on a public list (the
 * schema's default, and a list's defaultIsPrivate) — and a profile shows only
 * tasks that are not.
 */
const SHOWN = { isPrivate: false }

type ApiProfile = { stats: { completed: number; inspired: number; supported: number } }

test.describe('User profiles (AWTD-1419)', () => {
  test("a list member's name opens their profile: public tasks only, no email", async ({
    page,
    request,
    browser,
  }) => {
    // The outsider owns one public and one private task of their own.
    const outsider = await seat(browser, 'outsider.json')
    let publicTitle = ''
    let privateTitle = ''
    try {
      const open = await freshList(outsider.request, 'Outsider public', 'PUBLIC')
      const closed = await freshList(outsider.request, 'Outsider private')
      publicTitle = (await seedTask(outsider.request, [open.id], `On show ${Date.now()}`, SHOWN)).title
      privateTitle = (await seedTask(outsider.request, [closed.id], `Kept back ${Date.now()}`)).title
    } finally {
      await outsider.close()
    }

    const list = await freshList(request, 'Members')
    const member = await addMember(request, list.id, OUTSIDER_EMAIL)
    await gotoWithRetry(page, `/lists/${list.id}`)
    await page.getByRole('button', { name: 'Admin Settings' }).click()
    await page.getByRole('dialog').getByRole('link', { name: /Playwright Outsider/ }).click()

    await expect(page).toHaveURL(new RegExp(`/u/${member.id}$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Playwright Outsider' })).toBeVisible()
    await expect(page.getByText(OUTSIDER_EMAIL)).toHaveCount(0)

    // The stats are the API's.
    const profile = (await (await request.get(`/api/v1/users/${member.id}/profile`)).json()) as ApiProfile
    for (const [label, value] of [
      ['Completed', profile.stats.completed],
      ['Inspired', profile.stats.inspired],
      ['Supported', profile.stats.supported],
    ] as const) {
      await expect(page.getByText(label, { exact: true }).locator('xpath=..')).toContainText(String(value))
    }

    await expect(page.getByRole('heading', { name: 'Shared Tasks with Playwright Outsider' })).toBeVisible()
    await expect(page.getByText(publicTitle)).toBeVisible()
    await expect(page.getByText(privateTitle)).toHaveCount(0)

    // Back returns to the list.
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(new RegExp(`/lists/${list.id}$`))
  })

  test('your own profile, from Settings, shows your email and your public tasks', async ({ page, request }) => {
    const open = await freshList(request, 'My public', 'PUBLIC')
    const closed = await freshList(request, 'My private')
    const shown = await seedTask(request, [open.id], `Mine to show ${Date.now()}`, SHOWN)
    const hidden = await seedTask(request, [closed.id], `Mine to keep ${Date.now()}`)

    await gotoWithRetry(page, '/settings/account')
    await page.getByRole('button', { name: 'View Public Profile' }).click()
    await expect(page).toHaveURL(/\/u\/[^/]+$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Playwright Owner' })).toBeVisible()
    await expect(page.getByText(OWNER_EMAIL)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your Tasks' })).toBeVisible()
    await expect(page.getByText(shown.title)).toBeVisible()
    await expect(page.getByText(hidden.title)).toHaveCount(0)
  })

  test('an unknown user says so, with a way back', async ({ page }) => {
    await gotoWithRetry(page, '/u/no-such-user-awtd-1419')
    await expect(page.getByRole('heading', { name: 'User not found' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Go Back' })).toBeVisible()
  })
})
