import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'
import { detail, freshList, postJson, row, seat, seedTask } from './utils/v1-seed'

/**
 * Share links: /s/<code> opens what it points at (AWTD-1419).
 *
 * Rewrites the pre-AWTD-1338 shortcodes spec, which had never run. The link
 * is made in the UI (task detail → Task actions → Share) and its click count
 * is read back from the API. Every other case seeds a code through the API.
 */

type ApiShortcode = { code: string; clicks: number }

async function shortcodesFor(request: APIRequestContext, taskId: string): Promise<ApiShortcode[]> {
  const response = await request.get(`/api/v1/shortcodes?targetType=task&targetId=${taskId}`)
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { shortcodes: ApiShortcode[] }).shortcodes
}

async function makeShortcode(
  request: APIRequestContext,
  targetType: 'task' | 'list',
  targetId: string,
  expiresAt?: string,
): Promise<string> {
  const body = await postJson<{ shortcode: ApiShortcode }>(request, '/api/v1/shortcodes', {
    targetType,
    targetId,
    expiresAt,
  })
  return body.shortcode.code
}

test.describe('Share links (AWTD-1419)', () => {
  test('share a task from its menu; the link opens it in its list and counts the click', async ({
    page,
    request,
  }) => {
    const list = await freshList(request, 'Shared link')
    const task = await seedTask(request, [list.id], `Linked ${Date.now()}`)
    await gotoWithRetry(page, `/lists/${list.id}`)
    await row(page, task.title).click()
    await detail(page).getByRole('button', { name: 'Task actions' }).click()
    await page.getByRole('menuitem', { name: 'Share', exact: true }).click()

    const share = page.getByTestId('task-share-dialog')
    const link = share.getByText(/\/s\/[A-Za-z0-9]+$/)
    await expect(link).toBeVisible()
    const url = (await link.textContent())!.trim()
    const code = url.split('/s/')[1]
    // The code the dialog shows is the one the server stored for this task.
    await expect.poll(async () => (await shortcodesFor(request, task.id)).map((s) => s.code)).toContain(code)
    await share.getByRole('button', { name: 'Close' }).click()

    await gotoWithRetry(page, `/s/${code}`)
    await expect(page).toHaveURL(new RegExp(`/lists/${list.id}\\?task=${task.id}$`))
    await expect(page.getByTestId('task-detail-title')).toHaveText(task.title)
    await expect
      .poll(async () => (await shortcodesFor(request, task.id)).find((s) => s.code === code)?.clicks)
      .toBe(1)
  })

  test('a list link opens the list', async ({ page, request }) => {
    const list = await freshList(request, 'Linked list')
    const code = await makeShortcode(request, 'list', list.id)
    await gotoWithRetry(page, `/s/${code}`)
    await expect(page).toHaveURL(new RegExp(`/lists/${list.id}$`))
    await expect(page.getByRole('heading', { level: 1, name: list.name })).toBeVisible()
  })

  test('an unknown code and an expired code both say the link is gone', async ({ page, request }) => {
    await gotoWithRetry(page, '/s/NOSUCHCODE123')
    await expect(page.getByText('Link not found or expired')).toBeVisible()

    const list = await freshList(request, 'Expired link')
    const task = await seedTask(request, [list.id], `Expired ${Date.now()}`)
    const code = await makeShortcode(request, 'task', task.id, new Date(Date.now() - 86_400_000).toISOString())
    await gotoWithRetry(page, `/s/${code}`)
    await expect(page.getByText('Link not found or expired')).toBeVisible()

    await page.getByRole('button', { name: 'Go to Dashboard' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { level: 1, name: 'My Tasks' })).toBeVisible()
  })

  test("someone outside the list gets no further than the link", async ({ browser, request }) => {
    const list = await freshList(request, 'Private link')
    const task = await seedTask(request, [list.id], `Not yours ${Date.now()}`)
    const code = await makeShortcode(request, 'task', task.id)

    const outsider = await seat(browser, 'outsider.json')
    try {
      const page = await outsider.newPage()
      await gotoWithRetry(page, `/s/${code}`)
      await expect(page.getByText("You don't have permission to view this task")).toBeVisible()
      await expect(page).toHaveURL(new RegExp(`/s/${code}$`))
      await expect(page.getByText(task.title)).toHaveCount(0)
    } finally {
      await outsider.close()
    }
  })

  test('signed out, the link goes to sign-in and comes back after', async ({ browser, request }) => {
    const list = await freshList(request, 'Signed out link')
    const code = await makeShortcode(request, 'list', list.id)

    const signedOut = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const page = await signedOut.newPage()
      await gotoWithRetry(page, `/s/${code}`)
      await expect(page).toHaveURL(/\/auth\/signin\?/)
      expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe(`/s/${code}`)
    } finally {
      await signedOut.close()
    }
  })
})
