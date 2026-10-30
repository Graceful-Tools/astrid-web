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
      await expect(column(to)).toContainText(task.title)
      await expect
        .poll(async () => {
          const current = await readTask(request, task.id)
          return { completed: current.completed, statusRole: current.statusRole ?? null }
        })
        .toEqual(saved)
    }
  })
})
