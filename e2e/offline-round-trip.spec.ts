import { test, expect } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

/**
 * Edit offline, reload offline, reconnect: the edit survives and syncs exactly
 * once (AWTD-1405 journey 3, AWTD-1417). Nothing in the sync is mocked; the
 * browser goes offline and the app's own queue and service worker do the work.
 *
 * Each step was broken before AWTD-1417:
 * - opening a task re-fetched the list, and offline that replaced the app
 *   with "List Not Available";
 * - the service worker had no cached page for /lists/:id, and no session, so
 *   an offline reload showed a bare network error or sent you to sign-in;
 * - every page load cleared IndexedDB, mutation queue included, so the edit
 *   was gone after the reload and never synced.
 */

type ApiTask = { id: string; title: string }

async function postJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

/** Titles the app's IndexedDB mutation queue holds for a task. */
async function queuedTitles(page: Page, taskId: string): Promise<string[]> {
  return page.evaluate(`(async () => {
    const db = await new Promise((resolve) => { const open = indexedDB.open('AstridOfflineDB'); open.onsuccess = () => resolve(open.result) })
    const all = await new Promise((resolve) => { const req = db.transaction('mutations').objectStore('mutations').getAll(); req.onsuccess = () => resolve(req.result) })
    db.close()
    return all.filter((m) => m.entityId === '${taskId}' && m.data && m.data.title).map((m) => m.data.title)
  })()`) as Promise<string[]>
}

async function serviceWorkerControls(page: Page) {
  await expect
    .poll(() => page.evaluate('!!(navigator.serviceWorker && navigator.serviceWorker.controller)'))
    .toBe(true)
}

test.describe('Offline round trip (AWTD-1417)', () => {
  test('an edit made offline survives an offline reload and syncs exactly once', async ({ page, context, request }) => {
    test.setTimeout(90_000)
    const { list } = await postJson<{ list: { id: string } }>(request, '/api/v1/lists', {
      name: `Offline ${Date.now()}`,
      privacy: 'PRIVATE',
    })
    const title = `Offline task ${Date.now()}`
    const { task } = await postJson<{ task: ApiTask }>(request, '/api/v1/tasks', { title, listIds: [list.id] })

    // Every write to this task, from the page or the service worker.
    const writes: string[] = []
    context.on('request', (r) => {
      if (r.method() !== 'GET' && r.url().includes(`/api/v1/tasks/${task.id}`)) writes.push(r.method())
    })

    await gotoWithRetry(page, `/lists/${list.id}`)
    const row = (text: string) => page.locator('[data-task-id]').filter({ hasText: text })
    await expect(row(title)).toHaveCount(1)
    await serviceWorkerControls(page)

    await context.setOffline(true)

    // Rename it in task detail while offline.
    const renamed = `${title} (offline)`
    await row(title).click()
    await page.getByTestId('task-detail-title').click()
    await page.getByTestId('task-detail-title-input').fill(renamed)
    await page.getByTestId('task-detail-title-input').press('Enter')
    await expect(row(renamed)).toHaveCount(1)
    expect(writes).toEqual([])

    // Reload while still offline: the app comes back, with the edit.
    // The row updates at once; the queue write lands a moment later. Reload
    // only once the edit is in the app's own offline queue.
    await expect.poll(() => queuedTitles(page, task.id)).toContain(renamed)
    await page.reload()
    await expect(row(renamed)).toHaveCount(1)
    expect(writes).toEqual([])

    // Reconnect: the queued edit reaches the server, once.
    await context.setOffline(false)
    await expect
      .poll(async () => ((await (await request.get(`/api/v1/tasks/${task.id}`)).json()) as { task: ApiTask }).task.title)
      .toBe(renamed)
    await page.waitForTimeout(3000)
    expect(writes).toEqual(['PUT'])
  })
})
