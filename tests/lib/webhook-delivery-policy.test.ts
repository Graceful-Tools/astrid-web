import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/security/outbound-url', () => ({ assertPublicOutboundUrl: vi.fn() }))
vi.mock('@/lib/push-notification-service', () => ({
  PushNotificationService: class { sendNotification = vi.fn() },
}))
vi.mock('@/lib/ai/agent-execution-mode', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ai/agent-execution-mode')>(),
  isPollingOnlyAgent: vi.fn(async () => false),
}))
vi.mock('@/lib/assistant-workflow/run-assistant-workflow', () => ({
  runAssistantWorkflow: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/coding-workflow/start-tools-workflow', () => ({
  startToolsWorkflow: vi.fn(async () => ({ ok: true })),
}))

import { BRAND } from '@/lib/brand/config'
import { encryptField } from '@/lib/field-encryption'
import { AIAgentWebhookService } from '@/lib/ai-agent-webhook-service'
import { isPollingOnlyAgent } from '@/lib/ai/agent-execution-mode'
import { runAssistantWorkflow } from '@/lib/assistant-workflow/run-assistant-workflow'
import { startToolsWorkflow } from '@/lib/coding-workflow/start-tools-workflow'
import { resolveWebhookDeliveryPolicy } from '@/lib/webhooks/delivery-policy'
import { generateWebhookHeaders } from '@/lib/webhook-signature'
import { broadcastToUsers } from '@/lib/sse-utils'

function fixture(settings: Record<string, unknown> = {}) {
  const task = {
    id: 'AWTD-1561', title: 'Delivery policy', description: '', priority: 1,
    creatorId: 'creator', assigneeId: 'agent', completed: false, dueDateTime: null,
    assignee: {
      id: 'agent', email: `claude@${BRAND.agentEmailDomain}`, name: 'Claude',
      isAIAgent: true, aiAgentType: 'claude', aiAgentConfig: null, webhookUrl: null,
    },
    creator: { id: 'creator', name: 'Creator', email: 'creator@example.com' },
    aiAgent: null,
    lists: [{ id: 'list', name: 'List', ownerId: 'owner', aiAgentConfiguredBy: 'payer', githubRepositoryId: null }],
    comments: [],
  }
  const config = {
    id: 'config', userId: 'payer', enabled: true,
    events: ['task.assigned', 'task.updated', 'comment.created'], agents: ['claude'],
    failureCount: 0, maxRetries: 3,
    webhookUrl: encryptField('https://user.example.com/hook'),
    webhookSecret: encryptField('test-webhook-secret'),
  }
  const db = {
    user: { findUnique: vi.fn(async () => ({ mcpSettings: JSON.stringify(settings) })) },
    task: { findFirst: vi.fn(async () => task), findUnique: vi.fn(async () => task), updateMany: vi.fn(async () => ({ count: 1 })) },
    comment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...data, id: 'notice', createdAt: new Date(), author: null,
      })),
      findUnique: vi.fn(async () => ({ id: 'comment', content: 'Please continue', createdAt: new Date(), author: null })),
    },
    mCPToken: { findFirst: vi.fn(async () => ({ token: 'test-token', tokenHash: null })) },
    taskList: { findMany: vi.fn(async () => []) },
    userWebhookConfig: {
      findUnique: vi.fn(async () => config),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    notification: { createMany: vi.fn(async () => ({ count: 1 })) },
  }
  const service = new AIAgentWebhookService(db as unknown as PrismaClient)
  Object.assign(db, { $transaction: vi.fn(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)) })
  return { task, config, db, service }
}

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-09T02:31:00.000Z'))
  vi.mocked(isPollingOnlyAgent).mockResolvedValue(false)
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('CLAUDE_REMOTE_WEBHOOK_URL', 'https://env.example.com/hook')
  vi.stubEnv('CLAUDE_REMOTE_WEBHOOK_SECRET', 'environment-test-secret')
  fetchMock.mockReset().mockResolvedValue(new Response('', { status: 200 }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('AWTD-1561 default delivery characterization', () => {
  it('sends the unchanged payload to the user endpoint before any fallback', async () => {
    const { service } = fixture()
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://user.example.com/hook'])
    const request = fetchMock.mock.calls[0][1]!
    expect(request.method).toBe('POST')
    expect(request.headers).toEqual(generateWebhookHeaders(request.body as string, 'test-webhook-secret', 'task.assigned'))
    expect(request.body).toMatchSnapshot()
    expect(JSON.parse(request.body as string)).toMatchObject({
      event: 'task.assigned', billing: { userId: 'payer', source: 'list-configured-by' },
    })
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
  })

  it('with no user config tries env inside the sender and retries env in the notifier', async () => {
    const { service, db } = fixture()
    db.userWebhookConfig.findUnique.mockResolvedValue(null as never)
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://env.example.com/hook', 'https://env.example.com/hook',
    ])
    expect(runAssistantWorkflow).toHaveBeenCalledWith({
      taskId: 'AWTD-1561', agentEmail: `claude@${BRAND.agentEmailDomain}`,
      creatorId: 'payer', isCommentResponse: false,
    })
  })

  it('after exhausted retries uses env even for a non-Claude subscribed agent', async () => {
    const { service, config, task } = fixture()
    config.failureCount = 3
    config.agents = ['gemini']
    task.assignee.email = `gemini@${BRAND.agentEmailDomain}`
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://env.example.com/hook'])
  })

  it('a user delivery failure falls through to env then assistant execution', async () => {
    const { service, db } = fixture()
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://user.example.com/hook', 'https://env.example.com/hook',
    ])
    expect(db.userWebhookConfig.updateMany).toHaveBeenCalled()
    expect(runAssistantWorkflow).toHaveBeenCalledOnce()
  })

  it('a repository coding assignment leaves execution to its worker', async () => {
    const { service, task } = fixture()
    task.assignee.aiAgentType = 'claude_agent'
    task.lists[0].githubRepositoryId = 'owner/repo' as never
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
    expect(startToolsWorkflow).not.toHaveBeenCalled()
  })
})

describe('AWTD-1561 opt-in strict delivery', () => {
  it.each(['missing', 'disabled', 'exhausted', 'unsubscribed', 'event', 'invalid', 'http', 'network', 'timeout'])(
    'parks %s delivery without env or server fallback, and notifies the owner',
    async failure => {
      const { service, db, config } = fixture({ webhookDeliveryPolicy: 'strict' })
      if (failure === 'missing') db.userWebhookConfig.findUnique.mockResolvedValue(null as never)
      if (failure === 'disabled') config.enabled = false
      if (failure === 'exhausted') config.failureCount = 3
      if (failure === 'unsubscribed') config.agents = []
      if (failure === 'event') config.events = []
      if (failure === 'invalid') config.webhookSecret = ''
      if (failure === 'http') fetchMock.mockResolvedValue(new Response('', { status: 503 }))
      if (failure === 'network') fetchMock.mockRejectedValue(new Error('secret-containing network error'))
      if (failure === 'timeout') fetchMock.mockRejectedValue(new DOMException('Timed out', 'TimeoutError'))
      await service.notifyTaskAssignment('AWTD-1561', 'agent')
      expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('https://env.example.com/hook')
      expect(runAssistantWorkflow).not.toHaveBeenCalled()
      expect(db.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'AWTD-1561', completed: false }),
        data: { statusRole: 'waiting' },
      }))
      expect(db.comment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ content: expect.stringMatching(/^BLOCKED-ON: webhook delivery failed \(.+\)/m) }),
      }))
      expect(db.notification.createMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ userId: 'payer', taskId: 'AWTD-1561' })]),
      }))
      expect(JSON.stringify(db.comment.create.mock.calls)).not.toContain('secret-containing')
    },
  )

  it('a strict account remains polling-only without being parked', async () => {
    const { service, db } = fixture({ webhookDeliveryPolicy: 'strict' })
    vi.mocked(isPollingOnlyAgent).mockResolvedValue(true)
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.task.updateMany).not.toHaveBeenCalled()
    expect(db.comment.create).not.toHaveBeenCalled()
  })

  it('a forced polling mailbox is never sent or parked even under strict policy', async () => {
    const { service, db, task } = fixture({ webhookDeliveryPolicy: 'strict' })
    task.assignee.email = `codex@${BRAND.agentEmailDomain}`
    const actual = await vi.importActual<typeof import('@/lib/ai/agent-execution-mode')>('@/lib/ai/agent-execution-mode')
    vi.mocked(isPollingOnlyAgent).mockImplementationOnce(actual.isPollingOnlyAgent)
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.task.updateMany).not.toHaveBeenCalled()
  })

  it('strict successful receipt is accepted, not reported as a started agent', async () => {
    const { service } = fixture({ webhookDeliveryPolicy: 'strict' })
    const send = vi.spyOn(service, 'sendToUserWebhook')
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(await send.mock.results[0].value).toMatchObject({
      sent: true, accepted: true, started: null, transport: 'user-webhook',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
  })

  it('broadcasts failure comments to viewers without waking the assigned agent', async () => {
    const { service } = fixture({ webhookDeliveryPolicy: 'strict' })
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(broadcastToUsers).toHaveBeenCalledWith(
      expect.arrayContaining(['payer', 'creator', 'owner']),
      expect.objectContaining({ type: 'comment_created' }),
    )
    for (const [recipients] of vi.mocked(broadcastToUsers).mock.calls) {
      expect(recipients).not.toContain('agent')
    }
  })

  it('records endpoint acceptance even if legacy delivery bookkeeping fails', async () => {
    const { service, db } = fixture({ webhookDeliveryPolicy: 'strict' })
    db.userWebhookConfig.update.mockRejectedValue(new Error('Bookkeeping unavailable'))
    const send = vi.spyOn(service, 'sendToUserWebhook')
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(await send.mock.results[0].value).toMatchObject({
      sent: false, accepted: true, started: null,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
  })

  it('fallback bindings override strict defaults, and invalid policy fails closed', () => {
    expect(resolveWebhookDeliveryPolicy({
      webhookDeliveryPolicy: 'strict', agentWebhookDeliveryPolicies: { claude: 'fallback' },
    }, 'claude')).toBe('fallback')
    expect(() => resolveWebhookDeliveryPolicy({ webhookDeliveryPolicy: 'strcit' })).toThrow()
  })

  it('a concurrent reassignment is not overwritten by strict parking', async () => {
    const { service, db } = fixture({ webhookDeliveryPolicy: 'strict' })
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    db.task.updateMany.mockResolvedValue({ count: 0 })
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(db.comment.create).not.toHaveBeenCalled()
    expect(db.notification.createMany).not.toHaveBeenCalled()
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
  })

  it('failed strict parking never proceeds to fallback execution', async () => {
    const { service, db } = fixture({ webhookDeliveryPolicy: 'strict' })
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    db.task.updateMany.mockRejectedValue(new Error('Database unavailable'))
    await expect(service.notifyTaskAssignment('AWTD-1561', 'agent')).rejects.toThrow('Database unavailable')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
  })

  it('a failed fallback warning does not change the existing execution route', async () => {
    const { service, db } = fixture()
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    db.comment.create.mockRejectedValue(new Error('Database unavailable'))
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(runAssistantWorkflow).toHaveBeenCalledOnce()
  })

  it('per-mailbox opt-in overrides the account fallback default', async () => {
    const { service, db } = fixture({ agentWebhookDeliveryPolicies: { claude: 'strict' } })
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
    expect(db.task.updateMany).toHaveBeenCalled()
  })

  it('strict also prevents comment-triggered tools/server fallback', async () => {
    const { service, task, db } = fixture({ webhookDeliveryPolicy: 'strict' })
    task.assignee.aiAgentType = 'claude_agent'
    task.lists[0].githubRepositoryId = 'owner/repo' as never
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    await service.notifyCommentOnAssignedTask('AWTD-1561', 'comment', 'Please continue', 'Member')
    expect(startToolsWorkflow).not.toHaveBeenCalled()
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
    expect(db.task.updateMany).toHaveBeenCalled()
  })

  it('fallback emits a visible warning even when env accepts delivery', async () => {
    const { service, db } = fixture()
    db.userWebhookConfig.findUnique.mockResolvedValue(null as never)
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(db.comment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ content: expect.stringContaining('fallback') }),
    }))
    expect(db.task.updateMany).not.toHaveBeenCalled()
  })

  it.each(['strict', 'fallback'])('an external endpoint failure is visible under %s', async policy => {
    const { service, task, config, db } = fixture({ webhookDeliveryPolicy: policy })
    task.assignee.email = 'external@example.com'
    task.assignee.webhookUrl = 'https://external.example.com/hook' as never
    config.enabled = false
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    await service.notifyTaskAssignment('AWTD-1561', 'agent').catch(error => {
      // The legacy direct external delivery throws; strict parks instead.
      expect(policy).toBe('fallback')
      expect(error.message).toContain('Webhook failed')
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(policy === 'strict'
      ? ['https://external.example.com/hook']
      : ['https://env.example.com/hook', 'https://env.example.com/hook', 'https://external.example.com/hook'])
    expect(db.comment.create).toHaveBeenCalled()
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
    if (policy === 'strict') expect(db.task.updateMany).toHaveBeenCalled()
    else expect(db.task.updateMany).not.toHaveBeenCalled()
  })
})
