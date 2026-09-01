import path from 'node:path'
import { expect, test } from '@playwright/test'

test.describe('authenticated critical paths', () => {
  test('tasks, lists, invitations, uploads, and permissions stay wired together', async ({
    request,
    browser,
  }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`
    let listId: string | undefined
    let taskId: string | undefined

    try {
      const createList = await request.post('/api/v1/lists', {
        data: { name: `E2E risk list ${suffix}`, privacy: 'PRIVATE' },
      })
      expect(createList.status()).toBe(201)
      const listBody = await createList.json()
      listId = listBody.list.id

      const createTask = await request.post('/api/v1/tasks', {
        data: {
          title: `E2E risk task ${suffix}`,
          listIds: [listId],
          clientRequestId: `e2e-risk-${suffix}`,
        },
      })
      expect(createTask.status()).toBe(201)
      const taskBody = await createTask.json()
      taskId = taskBody.task.id

      const invite = await request.post(`/api/v1/lists/${listId}/invite`, {
        data: {
          email: `playwright-invite-${suffix}@example.test`,
          role: 'member',
          message: 'Authenticated critical-path coverage',
        },
      })
      expect(invite.status()).toBe(200)
      await expect(invite.json()).resolves.toMatchObject({
        invitation: { role: 'member' },
        meta: { apiVersion: 'v1', authSource: 'session' },
      })

      const outsider = await browser.newContext({
        storageState: path.resolve('.auth/outsider.json'),
      })
      try {
        const outsiderRequest = outsider.request
        const forbiddenUpdate = await outsiderRequest.put(`/api/v1/lists/${listId}`, {
          data: { name: `Hijacked ${suffix}` },
        })
        expect([403, 404]).toContain(forbiddenUpdate.status())

        const forbiddenUpload = await outsiderRequest.post('/api/v1/secure-upload/request-upload', {
          multipart: {
            file: {
              name: 'denied.txt',
              mimeType: 'text/plain',
              buffer: Buffer.from('not allowed'),
            },
            context: JSON.stringify({ listId, attachTarget: 'task' }),
          },
        })
        expect(forbiddenUpload.status()).toBe(404)
      } finally {
        await outsider.close()
      }
    } finally {
      if (taskId) await request.delete(`/api/v1/tasks/${taskId}`)
      if (listId) await request.delete(`/api/v1/lists/${listId}`)
    }
  })
})
