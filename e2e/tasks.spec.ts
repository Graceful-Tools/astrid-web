import { test, expect } from '@playwright/test'
import type { APIRequestContext, Page, Response } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'
import {
  OUTSIDER_EMAIL,
  addMember,
  detail,
  freshList,
  listTasks,
  postJson,
  readTask,
  row,
  seedTask,
  sidebarList,
} from './utils/v1-seed'

/**
 * Editing a task in task detail, through the UI (AWTD-1419).
 *
 * Rewrites the pre-AWTD-1338 tasks and tasks-authenticated specs, which had
 * never run. Create, rename, complete, reopen, comment and search are
 * task-journeys.spec.ts. Every change here is read back from the API.
 */

async function openTask(page: Page, listId: string, title: string) {
  await gotoWithRetry(page, `/lists/${listId}`)
  await row(page, title).click()
  await expect(page.getByTestId('task-detail-title')).toHaveText(title)
}

async function taskAction(page: Page, item: string) {
  await detail(page).getByRole('button', { name: 'Task actions' }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

async function copiedTaskId(response: Promise<Response>): Promise<string> {
  const copied = await response
  expect(copied.ok(), `copy returned ${copied.status()}`).toBeTruthy()
  return ((await copied.json()) as { task: { id: string } }).task.id
}

const copyResponse = (page: Page) =>
  page.waitForResponse((r) => /\/api\/v1\/tasks\/[^/]+\/copy$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST')

async function commentsOf(request: APIRequestContext, taskId: string): Promise<string[]> {
  const body = (await (await request.get(`/api/v1/tasks/${taskId}/comments`)).json()) as {
    comments: Array<{ content: string }>
  }
  return body.comments.map((c) => c.content)
}

/** YYYY-MM-DD of a local date: an all-day due date is stored as that day at 00:00 UTC. */
function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

test.describe('Task detail edits (AWTD-1419)', () => {
  test('set the priority', async ({ page, request }) => {
    const list = await freshList(request, 'Priority')
    const task = await seedTask(request, [list.id], `Prioritise ${Date.now()}`)
    await openTask(page, list.id, task.title)

    await detail(page).getByRole('button', { name: '!!!', exact: true }).click()
    await expect.poll(async () => (await readTask(request, task.id))?.priority).toBe(3)
    await expect(row(page, task.title).getByRole('img', { name: 'Unchecked priority 3 checkbox' })).toBeVisible()

    await detail(page).getByRole('button', { name: '!', exact: true }).click()
    await expect.poll(async () => (await readTask(request, task.id))?.priority).toBe(1)
  })

  test('set a due date, then clear it', async ({ page, request }) => {
    const list = await freshList(request, 'Due')
    const task = await seedTask(request, [list.id], `Schedule ${Date.now()}`)
    await openTask(page, list.id, task.title)

    const when = detail(page).getByTestId('when-date')
    await expect(when).toHaveText('No date')
    await when.getByText('No date').click()
    await page.getByRole('button', { name: 'Tomorrow', exact: true }).click()

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    await expect.poll(async () => (await readTask(request, task.id))?.dueDateTime).toBe(`${isoDay(tomorrow)}T00:00:00.000Z`)
    expect((await readTask(request, task.id))?.isAllDay).toBe(true)
    await expect(when).toHaveText('Tomorrow')

    await when.click()
    await page.getByRole('button', { name: 'No date', exact: true }).click()
    await expect.poll(async () => (await readTask(request, task.id))?.dueDateTime).toBeNull()
    await expect(when).toHaveText('No date')
  })

  test('assign to a list member, then unassign', async ({ page, request }) => {
    const list = await freshList(request, 'Assign')
    const member = await addMember(request, list.id, OUTSIDER_EMAIL)
    const task = await seedTask(request, [list.id], `Hand over ${Date.now()}`)
    await openTask(page, list.id, task.title)

    const who = detail(page).getByTestId('task-detail-assignee')
    await expect(who).toHaveText('Playwright Owner')
    await who.getByText('Playwright Owner').click()
    await detail(page).getByText(OUTSIDER_EMAIL).click()
    await expect.poll(async () => (await readTask(request, task.id))?.assigneeId).toBe(member.id)
    await expect(who).toHaveText('Playwright Outsider')

    await who.getByText('Playwright Outsider').click()
    await detail(page).getByText('Unassigned', { exact: true }).click()
    await expect.poll(async () => (await readTask(request, task.id))?.assigneeId).toBeNull()
    await expect(who).toHaveText('Unassigned')
  })

  test('delete asks first: "Don\'t Delete" keeps the task, "Delete" removes it', async ({ page, request }) => {
    const list = await freshList(request, 'Delete task')
    const task = await seedTask(request, [list.id], `Doomed ${Date.now()}`)
    await openTask(page, list.id, task.title)

    await taskAction(page, 'Delete')
    const confirm = page.getByTestId('task-delete-confirm')
    await expect(confirm).toContainText(`Are you sure you want to delete "${task.title}"?`)
    await confirm.getByRole('button', { name: "Don't Delete" }).click()
    await expect(confirm).toHaveCount(0)
    expect(await readTask(request, task.id)).not.toBeNull()
    await expect(row(page, task.title)).toHaveCount(1)

    await taskAction(page, 'Delete')
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.poll(async () => readTask(request, task.id)).toBeNull()
    expect((await listTasks(request, list.id)).map((t) => t.id)).not.toContain(task.id)
    await expect(row(page, task.title)).toHaveCount(0)
  })

  test('a copy into the same list shows at once, without a reload', async ({ page, request }) => {
    const list = await freshList(request, 'Copy here')
    const task = await seedTask(request, [list.id], `Duplicate ${Date.now()}`)
    await openTask(page, list.id, task.title)

    await taskAction(page, 'Copy')
    const dialog = page.getByTestId('task-copy-dialog')
    // The current list is the default target.
    await expect(dialog.getByRole('combobox')).toHaveValue(list.id)
    const copied = copyResponse(page)
    await dialog.getByRole('button', { name: 'Copy', exact: true }).click()
    const copyId = await copiedTaskId(copied)

    // The copy keeps the title, so the list now shows it twice.
    await expect(row(page, task.title)).toHaveCount(2)
    await expect(page.locator(`[data-task-id="${copyId}"]`)).toHaveCount(1)
    const copy = await readTask(request, copyId)
    expect(copy?.title).toBe(task.title)
    expect(copy?.lists.map((l) => l.id)).toEqual([list.id])
  })

  test('copy with its comments into another list', async ({ page, request }) => {
    const source = await freshList(request, 'Copy from')
    const target = await freshList(request, 'Copy to')
    const task = await seedTask(request, [source.id], `Carry over ${Date.now()}`)
    const note = `Keep this note ${Date.now()}`
    await postJson(request, `/api/v1/tasks/${task.id}/comments`, { content: note })
    await openTask(page, source.id, task.title)

    await taskAction(page, 'Copy')
    const dialog = page.getByTestId('task-copy-dialog')
    await dialog.getByRole('combobox').selectOption(target.id)
    await dialog.getByRole('checkbox', { name: /Include comments/ }).check()
    const copied = copyResponse(page)
    await dialog.getByRole('button', { name: 'Copy', exact: true }).click()
    const copyId = await copiedTaskId(copied)

    await expect.poll(async () => (await readTask(request, copyId))?.lists.map((l) => l.id)).toEqual([target.id])
    await expect.poll(async () => commentsOf(request, copyId)).toContain(note)
    // The original stays where it was.
    expect((await readTask(request, task.id))?.lists.map((l) => l.id)).toEqual([source.id])

    // Switching lists in the app, without a reload, shows the copy there.
    await sidebarList(page, target.name).click()
    await expect(page.getByRole('heading', { level: 1, name: target.name })).toBeVisible()
    await expect(page.locator(`[data-task-id="${copyId}"]`)).toHaveCount(1)
  })

  test('the o shortcut closes task detail', async ({ page, request }) => {
    const list = await freshList(request, 'Shortcut')
    const task = await seedTask(request, [list.id], `Toggle ${Date.now()}`)
    await openTask(page, list.id, task.title)
    await expect(page).toHaveURL(new RegExp(`[?&]task=${task.id}`))

    // Escape is not bound to task detail and never was; "o" is the documented
    // open/close key (hooks/useKeyboardShortcuts.ts, the "?" hotkey listing).
    await page.keyboard.press('o')
    await expect(page.getByTestId('task-detail-title')).toHaveCount(0)
    await expect(page).not.toHaveURL(/[?&]task=/)
    // Closing is not deleting or completing.
    expect((await readTask(request, task.id))?.completed).toBe(false)
    await expect(row(page, task.title)).toHaveCount(1)
  })
})
