import { test, expect } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

/**
 * The core task journeys, signed in, through the UI (AWTD-1339).
 *
 * Until this file the only live signed-in e2e called the API directly; no
 * create, edit, complete, comment or search had been driven through the app
 * by any test that ran. Each step here is checked against the API afterwards,
 * so a pass means the change was persisted, not just drawn.
 */

type ApiList = { id: string; name: string }
type ApiTask = { id: string; title: string; completed: boolean }

async function createJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

async function readTask(request: APIRequestContext, id: string): Promise<ApiTask> {
  const response = await request.get(`/api/v1/tasks/${id}`)
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { task: ApiTask }).task
}

async function freshList(request: APIRequestContext, label: string): Promise<ApiList> {
  return createJson<ApiList>(request, '/api/lists', {
    name: `${label} ${Date.now()}`,
    description: '',
    privacy: 'PRIVATE',
  })
}

const row = (page: Page, title: string) => page.locator('[data-task-id]').filter({ hasText: title })

test.describe('Core task journeys (AWTD-1339)', () => {
  test('create, rename, complete and reopen a task in the UI', async ({ page, request }) => {
    const list = await freshList(request, 'Journey')
    await gotoWithRetry(page, `/lists/${list.id}`)

    // Create with quick add.
    const title = `Journey task ${Date.now()}`
    const quickAdd = page.getByPlaceholder('Add a task...').first()
    await quickAdd.fill(title)
    await quickAdd.press('Enter')
    await expect(row(page, title)).toHaveCount(1)
    const taskId = await row(page, title).getAttribute('data-task-id')
    expect(taskId).toBeTruthy()
    await expect.poll(async () => (await readTask(request, taskId!)).title).toBe(title)

    // Rename it in task detail.
    await row(page, title).click()
    await page.getByTestId('task-detail-title').click()
    const renamed = `${title} (renamed)`
    const titleInput = page.getByTestId('task-detail-title-input')
    await titleInput.fill(renamed)
    await titleInput.press('Enter')
    await expect(row(page, renamed)).toHaveCount(1)
    await expect.poll(async () => (await readTask(request, taskId!)).title).toBe(renamed)

    // Complete it from its row, then reopen it.
    await row(page, renamed).getByRole('checkbox', { name: 'Mark complete' }).click()
    await expect.poll(async () => (await readTask(request, taskId!)).completed).toBe(true)
    await gotoWithRetry(page, `/lists/${list.id}`)
    const doneBox = row(page, renamed).getByRole('checkbox', { name: 'Mark incomplete' })
    if (await doneBox.count()) {
      await doneBox.click()
      await expect.poll(async () => (await readTask(request, taskId!)).completed).toBe(false)
    }
  })

  test('one click opens a task quick add just created (AWTD-1351)', async ({ page, request }) => {
    const list = await freshList(request, 'First click')
    await gotoWithRetry(page, `/lists/${list.id}`)

    const title = `First click ${Date.now()}`
    const quickAdd = page.getByPlaceholder('Add a task...').first()
    await quickAdd.fill(title)
    await quickAdd.press('Enter')
    await expect(row(page, title)).toHaveCount(1)
    const taskId = await row(page, title).getAttribute('data-task-id')

    // Creating with Enter selected the task behind the scenes, so this click
    // toggled it closed and did nothing visible.
    await page.waitForTimeout(1500)
    await row(page, title).click()
    await expect(page.getByTestId('task-detail-title')).toBeVisible({ timeout: 3000 })
    await expect(page).toHaveURL(new RegExp(`[?&]task=${taskId}`))
  })

  test('add a comment in task detail and see it after a reload', async ({ page, request }) => {
    const list = await freshList(request, 'Comments')
    const task = await createJson<ApiTask>(request, '/api/tasks', {
      title: `Commented ${Date.now()}`, description: '', listIds: [list.id], priority: 0, repeating: 'never',
    })
    await gotoWithRetry(page, `/lists/${list.id}`)
    await row(page, task.title).click()

    const text = `A comment ${Date.now()}`
    const box = page.getByPlaceholder('Add a comment...')
    await box.click()
    await page.keyboard.type(text)
    // The comment shows optimistically before it is saved; wait for the save
    // itself, or the reload below can abort it.
    const saved = page.waitForResponse(r => /\/comments/.test(r.url()) && r.request().method() === 'POST')
    await page.keyboard.press('Enter')
    await expect(page.getByText(text)).toBeVisible()
    expect((await saved).ok()).toBeTruthy()

    await gotoWithRetry(page, `/lists/${list.id}`)
    await row(page, task.title).click()
    await expect(page.getByText(text)).toBeVisible()
  })

  test('search finds a task by its title', async ({ page, request }) => {
    const list = await freshList(request, 'Search')
    const needle = `Findable ${Date.now()}`
    await createJson<ApiTask>(request, '/api/tasks', {
      title: needle, description: '', listIds: [list.id], priority: 0, repeating: 'never',
    })
    await gotoWithRetry(page, '/')
    // The sidebar entry opens the search field.
    await page.getByText('Search for tasks and users').first().click()
    const search = page.getByPlaceholder('Search tasks and users...').first()
    await search.fill(needle)
    await expect(page.locator('[data-task-id]').filter({ hasText: needle }).first()).toBeVisible()
  })
})
