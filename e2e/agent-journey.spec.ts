import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'
import { detail, freshList, postJson, row, seedTask } from './utils/v1-seed'

/**
 * Agents, through the UI (ADEV-297).
 *
 * Agents were covered only through the REST queue. This drives the loop a person sees: assign a
 * task to an agent mailbox from the assignee picker, put it in Ready, see it in the queue every
 * harness polls, let the agent hand it back with a question, and see the task detail and the
 * lanes follow the handback rules (Inbox, assigned to the person: lib/agent-handback.ts).
 */

const MAILBOX = 'claude'

type Agent = { id: string; email: string; name: string | null }
type TaskState = {
  assigneeId: string | null
  statusRole: string | null
  creatorId: string
  assignee?: { name: string | null; email: string } | null
}

async function agentUser(request: APIRequestContext): Promise<Agent> {
  const response = await request.get('/api/v1/users/me/available-agents')
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as { agents: Agent[] }
  const agent = body.agents.find(a => a.email?.toLowerCase().startsWith(`${MAILBOX}@`))
  expect(agent, `the ${MAILBOX} agent is available to the test user`).toBeTruthy()
  return agent!
}

async function taskState(request: APIRequestContext, id: string): Promise<TaskState> {
  const response = await request.get(`/api/v1/tasks/${id}`)
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { task: TaskState }).task
}

async function queueIds(request: APIRequestContext, listId: string): Promise<string[]> {
  const response = await request.get(`/api/v1/agent-queue?agent=${MAILBOX}&listId=${listId}`)
  expect(response.status(), await response.text()).toBe(200)
  const body = (await response.json()) as { tasks?: Array<{ id: string }>; queue?: Array<{ id: string }> }
  return (body.tasks ?? body.queue ?? []).map(t => t.id)
}

test.describe('Agents in the UI (ADEV-297)', () => {
  test('assign to an agent, queue it, hand it back with a question, and the lanes follow', async ({
    page,
    request,
  }) => {
    const agent = await agentUser(request)
    const list = await freshList(request, 'Agent journey')
    const task = await seedTask(request, [list.id], `Agent task ${Date.now()}`)
    const person = (await taskState(request, task.id)).creatorId

    // Assign from the picker in task detail.
    await gotoWithRetry(page, `/lists/${list.id}`)
    await row(page, task.title).click()
    const assignee = detail(page).getByTestId('task-detail-assignee')
    await assignee.getByText('Playwright Owner').click()
    await page.getByPlaceholder('Search users or enter email...').fill(MAILBOX)
    await page.getByText(agent.name ?? agent.email, { exact: false }).first().click()
    await expect.poll(async () => (await taskState(request, task.id)).assigneeId).toBe(agent.id)
    // The panel shows the agent's User row, whose name depends on what created that row (ADEV-308:
    // "claude agent" from the connecting harness, "Claude" from the registry), so read it from the task.
    const shown = (await taskState(request, task.id)).assignee
    const agentLabel = shown?.name || shown?.email || agent.email
    await expect(assignee).toContainText(agentLabel, { ignoreCase: true })

    // Not Ready yet, so the agent's queue does not hold it. Ready, and it does.
    expect(await queueIds(request, list.id)).not.toContain(task.id)
    const ready = await request.put(`/api/v1/tasks/${task.id}`, { data: { statusRole: 'ready' } })
    expect(ready.ok(), await ready.text()).toBeTruthy()
    await expect.poll(() => queueIds(request, list.id)).toContain(task.id)

    // The agent asks a question and hands the task back.
    const question = `Which environment should this target?\n\nAGENT-HANDBACK: ${MAILBOX}`
    await postJson(request, `/api/v1/tasks/${task.id}/comments`, {
      content: question,
      type: 'MARKDOWN',
      aiAgentId: agent.id,
    })
    const handedBack = await request.put(`/api/v1/tasks/${task.id}`, {
      data: { statusRole: null, assigneeId: person },
    })
    expect(handedBack.ok(), await handedBack.text()).toBeTruthy()

    // The detail shows the agent's question, signed by the agent, and the task is the person's again.
    await gotoWithRetry(page, `/lists/${list.id}?task=${task.id}`)
    const panel = detail(page)
    await expect(panel).toContainText('Which environment should this target?')
    await expect(panel).toContainText(agentLabel, { ignoreCase: true })
    await expect(panel.getByTestId('task-detail-assignee')).not.toContainText(agentLabel, { ignoreCase: true })
    const after = await taskState(request, task.id)
    expect(after.assigneeId).toBe(person)
    expect(after.statusRole).toBeNull()
    expect(await queueIds(request, list.id)).not.toContain(task.id)
  })
})
