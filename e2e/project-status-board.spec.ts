import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

/**
 * The only check that dragging a card between board lanes works (AWTD-1425).
 *
 * Status is a field on the task (`statusRole`), not a list the task joins —
 * the per-user status lists this spec used to look up are gone. Inbox and Done
 * are virtual: Inbox is "no status", Done is `completed` with no status.
 */

type ApiTask = { id: string; title: string; completed: boolean; statusRole?: string | null }

async function postJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

async function readTask(request: APIRequestContext, id: string): Promise<ApiTask> {
  const response = await request.get(`/api/v1/tasks/${id}`)
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { task: ApiTask }).task
}

test.describe('Project status board', () => {
  test('shows Inbox/Ready/Doing/Waiting/Done and dragging walks the task through every lane on the server', async ({ page, request }) => {
    const suffix = Date.now()
    const { list } = await postJson<{ list: { id: string } }>(request, '/api/v1/lists', {
      name: `Status board ${suffix}`,
      privacy: 'PRIVATE',
    })
    // Turn the list into a board via the Create-Board flow.
    await postJson(request, '/api/v1/projects/from-list', { listId: list.id })
    const { task } = await postJson<{ task: ApiTask }>(request, '/api/v1/tasks', {
      title: `Move through status board ${suffix}`,
      listIds: [list.id],
    })

    await gotoWithRetry(page, `/lists/${list.id}`)
    // Scoped: an unscoped "Board" also matches lists and cards named Board.
    await page.getByTestId('header-list-board-toggle').getByRole('button', { name: 'Board' }).click()

    const board = page.getByTestId('project-status-board')
    await expect(board).toBeVisible()
    for (const [column, label] of [
      ['inbox', 'Inbox'], ['ready', 'Ready'], ['doing', 'Doing'], ['waiting', 'Waiting'], ['done', 'Done'],
    ]) {
      await expect(board.getByTestId(`status-column-${column}`)).toContainText(label)
    }

    const card = board.getByTestId(`status-card-${task.id}`)
    const column = (role: string) => board.getByTestId(`status-column-${role}`)
    await expect(column('inbox')).toContainText(task.title)

    // About two lanes fit beside the sidebar and chat panel at this width, and
    // a lane half under the chat panel takes the drop on the panel instead. So
    // walk the card one lane at a time, with its lane scrolled to the left edge.
    const steps: Array<[string, string, Pick<ApiTask, 'completed' | 'statusRole'>]> = [
      ['inbox', 'ready', { completed: false, statusRole: 'ready' }],
      ['ready', 'doing', { completed: false, statusRole: 'doing' }],
      ['doing', 'waiting', { completed: false, statusRole: 'waiting' }],
      ['waiting', 'done', { completed: true, statusRole: null }],
    ]
    for (const [from, to, saved] of steps) {
      await column(from).evaluate(el => el.scrollIntoView({ inline: 'start', block: 'nearest' }))
      await card.dragTo(column(to))
      if (to === 'waiting') {
        // A move into Waiting asks what it waits for (Jon, 2026-11-12). Cancel leaves the card…
        const prompt = page.getByTestId('waiting-prompt')
        await expect(prompt).toBeVisible()
        await page.getByTestId('waiting-prompt-cancel').click()
        await expect(prompt).toBeHidden()
        await expect(column(from)).toContainText(task.title)
        // …and a date moves it.
        await card.dragTo(column(to))
        await expect(prompt).toBeVisible()
        const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
        await page.getByTestId('waiting-prompt-date').fill(tomorrow)
        await page.getByTestId('waiting-prompt-confirm').click()
        await expect(prompt).toBeHidden()
      }
      if (to === 'done') {
        // The task is unassigned, so completing it asks first (ADEV-71). Cancel leaves the card…
        const confirm = page.getByRole('dialog').filter({ hasText: 'Not assigned to anyone' })
        await expect(confirm).toBeVisible()
        await confirm.getByRole('button', { name: 'Cancel' }).click()
        await expect(confirm).toBeHidden()
        await expect(column(from)).toContainText(task.title)
        // …and Complete moves it.
        await card.dragTo(column(to))
        await expect(confirm).toBeVisible()
        await confirm.getByRole('button', { name: 'Complete' }).click()
        await expect(confirm).toBeHidden()
      }
      await expect(column(to)).toContainText(task.title)
      await expect
        .poll(async () => {
          const current = await readTask(request, task.id)
          return { completed: current.completed, statusRole: current.statusRole ?? null }
        })
        .toEqual(saved)
    }
  })

  test('AITD-679: a card opens task details as a callout beside it, not expanded in the column (core DS32)', async ({ page, request }) => {
    const suffix = Date.now()
    const { list } = await postJson<{ list: { id: string } }>(request, '/api/v1/lists', {
      name: `Callout board ${suffix}`,
      privacy: 'PRIVATE',
    })
    await postJson(request, '/api/v1/projects/from-list', { listId: list.id })
    const { task } = await postJson<{ task: ApiTask }>(request, '/api/v1/tasks', {
      title: `Open beside the card ${suffix}`,
      listIds: [list.id],
    })

    await gotoWithRetry(page, `/lists/${list.id}`)
    await page.getByTestId('header-list-board-toggle').getByRole('button', { name: 'Board' }).click()
    const board = page.getByTestId('project-status-board')
    const card = board.getByTestId(`status-card-${task.id}`)
    await expect(card).toBeVisible()

    await card.click()
    const callout = page.locator('[data-board-task-callout]')
    await expect(callout).toBeVisible()
    await expect(callout).toContainText(task.title)
    // Nothing opened inside the column.
    await expect(card.locator('[data-task-detail-panel]')).toHaveCount(0)
    // Beside the card, on the roomier side (Inbox is the leftmost lane), with its arrow.
    await expect(callout).toHaveAttribute('data-callout-side', 'right')
    const cardBox = (await card.boundingBox())!
    const calloutBox = (await callout.boundingBox())!
    expect(calloutBox.x).toBeGreaterThanOrEqual(cardBox.x + cardBox.width)
    await expect(callout.locator('[data-callout-arrow="right"]')).toHaveCount(1)

    // Tapping the open card again closes it, as a row does.
    await card.click()
    await expect(callout).toHaveCount(0)
  })
})
