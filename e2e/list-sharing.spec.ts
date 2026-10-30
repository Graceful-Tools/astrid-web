import { test, expect } from '@playwright/test'
import type { APIRequestContext, Browser, BrowserContext } from '@playwright/test'
import path from 'path'
import { gotoWithRetry } from './utils/test-helpers'

/**
 * Sharing a list, through the UI, with two other seats (AWTD-1405).
 *
 * The owner invites an EDITOR through the members form and makes the list
 * public through the privacy toggle; a third account then sees it as a VIEWER.
 * The sharing form only grants admin or member, so a public list is how a
 * person gets a read-only seat. Every role is checked against the API too: a
 * control that is merely hidden is not a permission.
 */

type ApiList = { id: string; name: string; privacy?: string }
type ApiTask = { id: string; title: string }

const EDITOR_EMAIL = 'playwright-outsider@example.test'

async function postJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

async function seat(browser: Browser, file: string): Promise<BrowserContext> {
  return browser.newContext({ storageState: path.resolve('.auth', file) })
}

test.describe('List sharing (AWTD-1405)', () => {
  test('the owner shares through the UI: an editor can edit, a public viewer can only read', async ({
    page,
    request,
    browser,
  }) => {
    const { list } = await postJson<{ list: ApiList }>(request, '/api/v1/lists', {
      name: `Shared ${Date.now()}`,
      privacy: 'PRIVATE',
    })
    const title = `Shared task ${Date.now()}`
    const { task } = await postJson<{ task: ApiTask }>(request, '/api/v1/tasks', { title, listIds: [list.id] })

    // The owner invites the editor as a member, through the members form.
    await gotoWithRetry(page, `/lists/${list.id}`)
    await page.getByRole('button', { name: 'Admin Settings' }).click()
    // Exactly one settings dialog: two used to open stacked (AWTD-1405).
    await expect(page.getByRole('dialog')).toHaveCount(1)
    const settings = page.getByRole('dialog')
    await settings.getByTestId('list-members-invite').click()
    await settings.getByLabel('Email Address').fill(EDITOR_EMAIL)
    await settings.getByRole('button', { name: 'Send Invitation' }).click()
    await expect
      .poll(async () => {
        const body = (await (await request.get(`/api/v1/lists/${list.id}/members`)).json()) as {
          members: Array<{ email: string; role: string; type: string }>
        }
        return body.members.find((m) => m.email === EDITOR_EMAIL)
      })
      .toMatchObject({ role: 'member', type: 'member' })

    // ...and makes the list public, through the privacy toggle.
    await settings.getByRole('button', { name: 'Make Public' }).click()
    await expect
      .poll(async () => ((await (await request.get(`/api/v1/lists/${list.id}`)).json()) as { list: ApiList }).list.privacy)
      .toBe('PUBLIC')

    const editor = await seat(browser, 'outsider.json')
    const viewer = await seat(browser, 'viewer.json')
    try {
      // The editor can edit the shared task.
      const edited = `${title} (edited)`
      const edit = await editor.request.put(`/api/v1/tasks/${task.id}`, { data: { title: edited } })
      expect(edit.status(), await edit.text()).toBe(200)

      // The viewer can read the list and its task...
      const viewerPage = await viewer.newPage()
      await gotoWithRetry(viewerPage, `/lists/${list.id}`)
      const row = viewerPage.locator('[data-task-id]').filter({ hasText: edited })
      await expect(row).toHaveCount(1)
      await expect(viewerPage.getByRole('heading', { name: list.name })).toBeVisible()

      // ...but the UI offers no way to change it: no quick add, no completion,
      // and the title does not open for editing.
      await expect(viewerPage.getByPlaceholder('Add a task...')).toHaveCount(0)
      await expect(row.getByRole('checkbox', { name: 'Mark complete' })).toHaveCount(0)
      await row.click()
      await viewerPage.getByTestId('task-detail-title').click()
      await expect(viewerPage.getByTestId('task-detail-title-input')).toHaveCount(0)

      // And the API refuses the viewer, whatever the UI shows.
      expect((await viewer.request.put(`/api/v1/tasks/${task.id}`, { data: { title: 'hijacked' } })).status()).toBe(403)
      expect(
        (await viewer.request.post('/api/v1/tasks', { data: { title: 'intruder', listIds: [list.id] } })).status(),
      ).toBe(403)
      const after = (await (await request.get(`/api/v1/tasks/${task.id}`)).json()) as { task: ApiTask }
      expect(after.task.title).toBe(edited)
    } finally {
      await editor.close()
      await viewer.close()
    }
  })

  test("a public list shows a non-member only that list's tasks (AWTD-1419)", async ({ request, browser }) => {
    // A non-member can read every public list's tasks, so they are all in the
    // viewer's task set. The list view filtered by list only when the list was
    // one of the viewer's own, so every public task they could read rendered
    // under this list's heading — and, once there were enough to scroll, the
    // scroll to reach a row closed the detail it opened.
    const name = `Public alone ${Date.now()}`
    const { list } = await postJson<{ list: ApiList }>(request, '/api/v1/lists', { name, privacy: 'PUBLIC' })
    const { list: other } = await postJson<{ list: ApiList }>(request, '/api/v1/lists', {
      name: `Public other ${Date.now()}`,
      privacy: 'PUBLIC',
    })
    const mine = `In this list ${Date.now()}`
    const elsewhere = `In the other list ${Date.now()}`
    await postJson(request, '/api/v1/tasks', { title: mine, listIds: [list.id] })
    await postJson(request, '/api/v1/tasks', { title: elsewhere, listIds: [other.id] })

    const viewer = await seat(browser, 'viewer.json')
    try {
      const page = await viewer.newPage()
      await gotoWithRetry(page, `/lists/${list.id}`)
      await expect(page.getByRole('heading', { name })).toBeVisible()
      await expect(page.locator('[data-task-id]').filter({ hasText: mine })).toHaveCount(1)
      await expect(page.locator('[data-task-id]').filter({ hasText: elsewhere })).toHaveCount(0)
      await expect(page.locator('[data-task-id]')).toHaveCount(1)
    } finally {
      await viewer.close()
    }
  })
})
