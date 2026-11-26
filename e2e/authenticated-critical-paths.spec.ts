import { test, expect } from '@playwright/test'

test('cleanup: delete every task and list this user owns', async ({ request }) => {
  test.setTimeout(300_000)
  for (let round = 0; round < 20; round++) {
    const response = await request.get('/api/v1/tasks?limit=100&offset=0')
    expect(response.ok()).toBeTruthy()
    const body = (await response.json()) as { tasks: Array<{ id: string }> }
    if (body.tasks.length === 0) break
    await Promise.all(body.tasks.map((t) => request.delete(`/api/v1/tasks/${t.id}`)))
  }
  const lists = (await (await request.get('/api/v1/lists')).json()) as { lists: Array<{ id: string }> }
  await Promise.all(lists.lists.map((l) => request.delete(`/api/v1/lists/${l.id}`)))
  const after = (await (await request.get('/api/v1/tasks?limit=100')).json()) as { tasks: unknown[] }
  console.log('REMAINING', after.tasks.length)
})
