import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildListCreate, buildTaskCreate, buildUserCreate } from '@/tests/fixtures/prisma'
import { cleanupPrefix, connectAppPrisma, runPrefix } from './support/db'

/**
 * ADEV-294: lib/agent-queue.ts against real rows. "Assigned AND ready", ordering,
 * the unassigned-Ready opt-in, and a polling-only mailbox.
 *
 * The queue is scoped to one board per test, so the shared agent identity row (one per
 * database, like in production) never leaks other suites' tasks into an assertion.
 */
let prisma: PrismaClient
const prefix = runPrefix('queue')
let agentIds: Record<'codex' | 'claude', string>

beforeAll(async () => {
  prisma = await connectAppPrisma()
  const { agentEmail } = await import('@/lib/brand/agent-emails')
  const ensure = async (mailbox: 'codex' | 'claude') => {
    const email = agentEmail(mailbox)
    const row = await prisma.user.upsert({
      where: { email },
      update: { isAIAgent: true },
      create: { email, name: `${mailbox} agent`, isAIAgent: true, aiAgentType: `${mailbox}_agent` },
    })
    return row.id
  }
  agentIds = { codex: await ensure('codex'), claude: await ensure('claude') }
})

afterAll(async () => {
  if (prisma) {
    await cleanupPrefix(prisma, prefix)
    await prisma.$disconnect()
  }
})

async function board() {
  const caller = await prisma.user.create({
    data: buildUserCreate({ email: `${prefix}-${Math.random().toString(36).slice(2)}@example.test` }),
  })
  const list = await prisma.taskList.create({ data: buildListCreate(caller.id) })
  const add = (title: string, extra: Record<string, unknown> = {}) =>
    prisma.task.create({
      data: buildTaskCreate(caller.id, list.id, { title: `${prefix}-${title}`, ...extra }),
    })
  return { caller, list, add }
}

const assign = (mailbox: 'codex' | 'claude') => (agentIds: Record<string, string>) => ({
  assignee: { connect: { id: agentIds[mailbox] } },
})

describe('agent queue against real rows (ADEV-294)', () => {
  it('queues only incomplete Ready tasks assigned to this agent', async () => {
    const { caller, list, add } = await board()
    const { buildAgentQueue } = await import('@/lib/agent-queue')
    const mine = assign('codex')(agentIds)

    const ready = await add('ready', { ...mine, statusRole: 'ready' })
    await add('doing', { ...mine, statusRole: 'doing' })
    await add('inbox', { ...mine })
    await add('done', { ...mine, statusRole: 'ready', completed: true })
    await add('other-agent', { ...assign('claude')(agentIds), statusRole: 'ready' })
    await add('unassigned', { statusRole: 'ready' })

    const result = await buildAgentQueue({ agent: 'codex', userId: caller.id, listId: list.id })

    expect(result.queue.map(t => t.id)).toEqual([ready.id])
    expect(result.empty).toBe(false)
    expect(result.queue[0].assigned).toBe(true)
  })

  it('orders by priority, then oldest first', async () => {
    const { caller, list, add } = await board()
    const { buildAgentQueue } = await import('@/lib/agent-queue')
    const mine = assign('codex')(agentIds)

    const lowOld = await add('low-old', { ...mine, statusRole: 'ready', priority: 0 })
    const highA = await add('high-a', { ...mine, statusRole: 'ready', priority: 3 })
    const highB = await add('high-b', { ...mine, statusRole: 'ready', priority: 3 })
    await prisma.$executeRaw`UPDATE "Task" SET "createdAt" = ${new Date('2026-01-01T00:00:00Z')} WHERE id = ${highB.id}`
    await prisma.$executeRaw`UPDATE "Task" SET "createdAt" = ${new Date('2026-01-02T00:00:00Z')} WHERE id = ${highA.id}`

    const result = await buildAgentQueue({ agent: 'codex', userId: caller.id, listId: list.id })

    expect(result.queue.map(t => t.id)).toEqual([highB.id, highA.id, lowOld.id])
  })

  it('holds a future-dated Ready task out and says when it starts', async () => {
    const { caller, list, add } = await board()
    const { buildAgentQueue } = await import('@/lib/agent-queue')
    const mine = assign('codex')(agentIds)
    const later = new Date(Date.now() + 3 * 24 * 3600 * 1000)

    const due = await add('due-now', { ...mine, statusRole: 'ready' })
    const future = await add('future', { ...mine, statusRole: 'ready', dueDateTime: later })

    const result = await buildAgentQueue({ agent: 'codex', userId: caller.id, listId: list.id })

    expect(result.queue.map(t => t.id)).toEqual([due.id])
    expect(result.held.notDueCount).toBe(1)
    expect(result.held.scheduled.map(s => s.id)).toEqual([future.id])
  })

  it('takes unassigned Ready tasks only when asked, and only from the named board', async () => {
    const { caller, list, add } = await board()
    const { buildAgentQueue, BadQueueOptionError } = await import('@/lib/agent-queue')
    const unassigned = await add('unassigned', { statusRole: 'ready' })

    const without = await buildAgentQueue({ agent: 'codex', userId: caller.id, listId: list.id })
    expect(without.queue).toEqual([])
    expect(without.empty).toBe(true)

    const withFlag = await buildAgentQueue({
      agent: 'codex',
      userId: caller.id,
      listId: list.id,
      includeUnassigned: true,
    })
    expect(withFlag.queue.map(t => t.id)).toEqual([unassigned.id])
    expect(withFlag.queue[0].assigned).toBe(false)

    await expect(
      buildAgentQueue({ agent: 'codex', userId: caller.id, includeUnassigned: true }),
    ).rejects.toBeInstanceOf(BadQueueOptionError)
  })

  it('never queues a board the caller cannot see', async () => {
    const mine = await board()
    const theirs = await board()
    const { buildAgentQueue } = await import('@/lib/agent-queue')
    await theirs.add('hidden', { ...assign('codex')(agentIds), statusRole: 'ready' })

    const result = await buildAgentQueue({ agent: 'codex', userId: mine.caller.id, listId: theirs.list.id })

    expect(result.queue).toEqual([])
  })

  it('answers in polling mode for a local-harness mailbox, which the server never dispatches', async () => {
    const { caller, list, add } = await board()
    const { buildAgentQueue } = await import('@/lib/agent-queue')
    await add('poll-me', { ...assign('codex')(agentIds), statusRole: 'ready' })

    const result = await buildAgentQueue({ agent: 'codex', userId: caller.id, listId: list.id })

    expect(result.mode).toBe('polling')
    expect(result.queue).toHaveLength(1)
  })

  it('rejects an unknown mailbox loudly rather than answering an empty queue', async () => {
    const { caller, list } = await board()
    const { buildAgentQueue, UnknownAgentError } = await import('@/lib/agent-queue')

    await expect(
      buildAgentQueue({ agent: 'claud', userId: caller.id, listId: list.id }),
    ).rejects.toBeInstanceOf(UnknownAgentError)
  })
})
