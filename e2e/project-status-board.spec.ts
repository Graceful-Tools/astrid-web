import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

type ApiList = {
  id: string
  name: string
  projectId?: string | null
  listType?: string | null
  statusRole?: string | null
}

type ApiTask = {
  id: string
  title: string
  completed: boolean
  lists: ApiList[]
}

async function createJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

async function updateJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.put(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

test.describe('Project status board', () => {
  test('shows Ready/Doing/Waiting plus virtual Inbox/Done and moves a task across the board', async ({ page, request }) => {
    const suffix = Date.now()
    // Turn a plain list into a board via the Create-Board flow (the list is the
    // management entity; "from-list" creates the backing project + status cols).
    const domainList = await createJson<ApiList>(request, '/api/lists', {
      name: `Astrid Web To-do ${suffix}`,
      description: 'Domain list for status board test',
      privacy: 'SHARED',
      listType: 'regular',
    })

    await createJson<{ project: { id: string }; list: ApiList }>(request, '/api/projects/from-list', {
      listId: domainList.id,
    })

    // Status lists are per-user globals (projectId: null, listType: 'status').
    const listsResponse = await request.get('/api/lists')
    expect(listsResponse.ok()).toBeTruthy()
    const listsPayload = await listsResponse.json() as { lists: ApiList[] }
    const statusLists = listsPayload.lists.filter(list => list.listType === 'status')
    const ready = statusLists.find(list => list.statusRole === 'ready')
    const doing = statusLists.find(list => list.statusRole === 'doing')
    const waiting = statusLists.find(list => list.statusRole === 'waiting')
    expect(ready).toBeTruthy()
    expect(doing).toBeTruthy()
    expect(waiting).toBeTruthy()
    expect(statusLists.find(list => list.statusRole === 'inbox')).toBeUndefined()
    expect(statusLists.find(list => list.statusRole === 'done')).toBeUndefined()

    const task = await createJson<ApiTask>(request, '/api/tasks', {
      title: `Move through status board ${suffix}`,
      description: '',
      listIds: [domainList.id],
      priority: 0,
      repeating: 'never',
    })

    await gotoWithRetry(page, `/lists/${domainList.id}`)

    await page.getByRole('button', { name: 'Board' }).click()
    await expect(page.getByTestId('project-status-board')).toBeVisible()
    await expect(page.getByTestId('status-column-inbox')).toContainText('Inbox')
    await expect(page.getByTestId('status-column-ready')).toContainText('Ready')
    await expect(page.getByTestId('status-column-doing')).toContainText('Doing')
    await expect(page.getByTestId('status-column-waiting')).toContainText('Waiting')
    await expect(page.getByTestId('status-column-done')).toContainText('Done')

    await expect(page.getByTestId('status-column-inbox')).toContainText(task.title)

    await page.getByTestId(`status-card-${task.id}`).dragTo(page.getByTestId('status-column-doing'))
    await expect(page.getByTestId('status-column-doing')).toContainText(task.title)

    const movedTask = await updateJson<ApiTask>(request, `/api/tasks/${task.id}`, {
      ...task,
      listIds: [domainList.id, doing!.id],
    })
    expect(movedTask.completed).toBe(false)
    expect(movedTask.lists.some(list => list.id === doing!.id)).toBe(true)
    expect(movedTask.lists.some(list => list.id === domainList.id)).toBe(true)

    await page.getByTestId(`status-card-${task.id}`).dragTo(page.getByTestId('status-column-done'))
    await expect(page.getByTestId('status-column-done')).toContainText(task.title)

    const taskResponse = await request.get(`/api/tasks/${task.id}`)
    expect(taskResponse.ok()).toBeTruthy()
    const completedTask = await taskResponse.json() as ApiTask
    expect(completedTask.completed).toBe(true)
    expect(completedTask.lists.some(list => list.listType === 'status')).toBe(false)
  })
})
