/**
 * /starthere, signed in: the guide's lists get created, and a task dropped in
 * each list reaches that list's agent through the same queue every harness
 * polls (GET /api/v1/agent-queue — the REST twin of the get_agent_queue MCP
 * tool). This is the contract each agent's setup depends on: "assigned to me,
 * Ready, in my list" → it shows up in my queue.
 *
 * Runs under the authenticated projects (PLAYWRIGHT_AUTHENTICATED=1). Lists the
 * test user already had are reused, never deleted; only what this run created
 * is cleaned up.
 */

import { expect, test, type APIRequestContext } from '@playwright/test'
import { STARTER_LISTS, starterAgentForList } from '../lib/start-here/business-blueprint'
import { createStarterLists, type StarterApi, type StarterListResult } from '../lib/start-here/create-starter-lists'

function apiFor(request: APIRequestContext): StarterApi {
  return {
    async getJson(path) {
      const res = await request.get(path)
      return { ok: res.ok(), status: res.status(), body: await res.json().catch(() => null) }
    },
    async postJson(path, body) {
      const res = await request.post(path, { data: body })
      return { ok: res.ok(), status: res.status(), body: await res.json().catch(() => null) }
    },
  }
}

test.describe('/starthere (signed in)', () => {
  let lists: StarterListResult[] = []
  const createdTaskIds: string[] = []

  test.beforeAll(async ({ request }) => {
    lists = await createStarterLists(apiFor(request))
  })

  test.afterAll(async ({ request }) => {
    for (const id of createdTaskIds) await request.delete(`/api/v1/tasks/${id}`)
    for (const list of lists.filter(l => l.created)) await request.delete(`/api/v1/lists/${list.id}`)
  })

  test('creates every blueprint list with its agent instructions', async ({ request }) => {
    expect(lists.map(l => l.key)).toEqual(STARTER_LISTS.map(l => l.key))
    for (const result of lists) {
      const res = await request.get(`/api/v1/lists/${result.id}`)
      expect(res.ok()).toBe(true)
      const { list } = await res.json()
      const blueprint = STARTER_LISTS.find(l => l.key === result.key)!
      if (result.created) expect(list.description).toBe(blueprint.description)
    }
  })

  test('the page recognises the lists and scopes every command to them', async ({ page }) => {
    await page.goto('/starthere')
    await expect(page.getByTestId('starthere-create-lists')).toContainText(/your lists are ready/i)
    const build = lists.find(l => l.key === 'build')!
    await page.getByTestId('starthere-agent-claude').locator('summary').click()
    await expect(page.getByTestId('starthere-agent-claude')).toContainText(`listId "${build.id}"`)
  })

  for (const blueprint of STARTER_LISTS) {
    const agent = starterAgentForList(blueprint)
    test(`${agent.name}: a Ready task in ${blueprint.name} reaches the "${agent.mailbox}" queue`, async ({ request }) => {
      const list = lists.find(l => l.key === blueprint.key)!
      test.skip(
        !list.defaultAssigneeId,
        `${agent.mailbox} is not available to the test user (switched off in Settings → AI Agents)`,
      )

      const created = await request.post('/api/v1/tasks', {
        data: {
          title: `starthere e2e — ${blueprint.name}`,
          listIds: [list.id],
          assigneeId: list.defaultAssigneeId,
          statusRole: 'ready',
          isPrivate: false,
        },
      })
      expect(created.status(), await created.text()).toBe(201)
      const taskId = (await created.json()).task.id as string
      createdTaskIds.push(taskId)

      const queue = await request.get(`/api/v1/agent-queue?agent=${agent.mailbox}&listId=${list.id}`)
      expect(queue.status(), await queue.text()).toBe(200)
      const body = await queue.json()
      expect(body.empty).toBe(false)
      expect(JSON.stringify(body.tasks ?? body)).toContain(taskId)
    })
  }
})
