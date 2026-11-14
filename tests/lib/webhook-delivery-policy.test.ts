import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/security/outbound-url', () => ({ assertPublicOutboundUrl: vi.fn() }))
vi.mock('@/lib/push-notification-service', () => ({
  PushNotificationService: class { sendNotification = vi.fn(); sendLocalizedNotification = vi.fn() },
}))
vi.mock('@/lib/ai/agent-execution-mode', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ai/agent-execution-mode')>(),
  isPollingOnlyAgent: vi.fn(async () => false),
}))
vi.mock('@/lib/assistant-workflow/run-assistant-workflow', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/assistant-workflow/run-assistant-workflow')>(),
  runAssistantWorkflow: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/coding-workflow/start-tools-workflow', () => ({
  startToolsWorkflow: vi.fn(async () => ({ ok: true })),
}))
// The notice goes through the comment service and the park through the task
// service; both have their own suites. Here: whether, how often, and with what.
vi.mock('@/services/post-comment-as', () => ({
  postCommentAs: vi.fn(async (args: { content: string }) => ({ ok: true, comment: { id: 'notice', ...args } })),
}))
vi.mock('@/services/task.service', () => ({
  updateTaskWithSideEffects: vi.fn(async () => ({ ok: true, task: {}, rolledForward: false })),
}))

import { BRAND } from '@/lib/brand/config'
import { encryptField } from '@/lib/field-encryption'
import { AIAgentWebhookService } from '@/lib/ai-agent-webhook-service'
import { isPollingOnlyAgent } from '@/lib/ai/agent-execution-mode'
import { buildPrompt, runAssistantWorkflow } from '@/lib/assistant-workflow/run-assistant-workflow'
import { startToolsWorkflow } from '@/lib/coding-workflow/start-tools-workflow'
import { resolveWebhookDeliveryPolicy, isWebhookDeliveryNotice } from '@/lib/webhooks/delivery-policy'
import { generateWebhookHeaders } from '@/lib/webhook-signature'
import { broadcastToUsers } from '@/lib/sse-utils'
import { postCommentAs } from '@/services/post-comment-as'
import { updateTaskWithSideEffects } from '@/services/task.service'
import { resolveWaitingWriteTs } from '@/lib/waiting-rules'
import { formatRecheck } from '@/services/webhook-delivery.service'

const NOW = new Date('2026-11-09T02:31:00.000Z')
const USER_HOOK = 'https://user.example.com/hook'
const ENV_HOOK = 'https://env.example.com/hook'

function fixture(settings: Record<string, unknown> | string = {}) {
  const task = {
    id: 'AWTD-1561', title: 'Delivery policy', description: '', priority: 1,
    creatorId: 'creator', assigneeId: 'agent', completed: false, dueDateTime: null as Date | null,
    updatedAt: new Date('2026-11-09T02:00:00.000Z'),
    assignee: {
      id: 'agent', email: `claude@${BRAND.agentEmailDomain}`, name: 'Claude',
      isAIAgent: true, aiAgentType: 'claude', aiAgentConfig: null, webhookUrl: null as string | null,
    },
    creator: { id: 'creator', name: 'Creator', email: 'creator@example.com' },
    aiAgent: null,
    lists: [{ id: 'list', name: 'List', ownerId: 'owner', aiAgentConfiguredBy: 'payer', githubRepositoryId: null as string | null }],
    comments: [],
  }
  const config = {
    id: 'config', userId: 'payer', enabled: true,
    events: ['task.assigned', 'task.updated', 'comment.created'], agents: ['claude'],
    failureCount: 0, maxRetries: 3,
    webhookUrl: encryptField(USER_HOOK),
    webhookSecret: encryptField('test-webhook-secret'),
  }
  const mcpSettings = typeof settings === 'string' ? settings : JSON.stringify(settings)
  const db = {
    user: {
      findUnique: vi.fn(async (args: { select?: Record<string, unknown> }) =>
        args?.select?.mcpSettings ? { mcpSettings } : { id: 'payer', name: 'Payer', email: 'payer@example.com' }),
      findFirst: vi.fn(async () => null),
    },
    task: { findFirst: vi.fn(async () => task), findUnique: vi.fn(async () => task) },
    comment: {
      create: vi.fn(async () => ({ id: 'raw-comment' })),
      findUnique: vi.fn(async () => ({ id: 'comment', content: 'Please continue', createdAt: new Date(), author: null })),
    },
    mCPToken: { findFirst: vi.fn(async () => ({ token: 'test-token', tokenHash: null })) },
    taskList: { findMany: vi.fn(async () => []) },
    userWebhookConfig: {
      findUnique: vi.fn(async () => config as typeof config | null),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    notification: { createMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  }
  const service = new AIAgentWebhookService(db as unknown as PrismaClient)
  return { task, config, db, service }
}

const fetchMock = vi.fn<typeof fetch>()
const fetched = () => fetchMock.mock.calls.map(([url]) => url)
const commentBroadcasts = () =>
  vi.mocked(broadcastToUsers).mock.calls.filter(([, event]) => (event as { type: string }).type !== 'ai_agent_assigned')
const notices = () => vi.mocked(postCommentAs).mock.calls.map(([args]) => args)

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(isPollingOnlyAgent).mockResolvedValue(false)
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('CLAUDE_REMOTE_WEBHOOK_URL', ENV_HOOK)
  vi.stubEnv('CLAUDE_REMOTE_WEBHOOK_SECRET', 'environment-test-secret')
  fetchMock.mockReset().mockResolvedValue(new Response('', { status: 200 }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

/** Nothing new: no comment, no park, no notification row, no broadcast beyond main's own. */
function expectNothingNew(db: ReturnType<typeof fixture>['db']) {
  expect(postCommentAs).not.toHaveBeenCalled()
  expect(db.comment.create).not.toHaveBeenCalled()
  expect(db.$transaction).not.toHaveBeenCalled()
  expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
  expect(db.notification.createMany).not.toHaveBeenCalled()
  expect(commentBroadcasts()).toEqual([])
}

describe('AWTD-1561 fallback default with no webhook: byte-for-byte main', () => {
  it('assignment: env then assistant, as main, and nothing new for the user', async () => {
    const { service, db } = fixture()
    db.userWebhookConfig.findUnique.mockResolvedValue(null)
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetched()).toEqual([ENV_HOOK, ENV_HOOK])
    expect(runAssistantWorkflow).toHaveBeenCalledWith({
      taskId: 'AWTD-1561', agentEmail: `claude@${BRAND.agentEmailDomain}`,
      creatorId: 'payer', isCommentResponse: false,
    })
    expectNothingNew(db)
  })

  it('assignment: env accepting the delivery raises nothing', async () => {
    const { service, db } = fixture()
    db.userWebhookConfig.findUnique.mockResolvedValue(null)
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetched()).toEqual([ENV_HOOK])
    expectNothingNew(db)
  })

  it('assignment to an external agent with no webhook stays silent', async () => {
    const { service, db, task } = fixture()
    task.assignee.email = 'external@example.com'
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetchMock).not.toHaveBeenCalled()
    expectNothingNew(db)
  })

  it.each(['missing', 'disabled'])('human comment, %s webhook: the assistant chat path runs and nothing new appears', async state => {
    const { service, db, config } = fixture()
    vi.stubEnv('CLAUDE_REMOTE_WEBHOOK_URL', '')
    if (state === 'missing') db.userWebhookConfig.findUnique.mockResolvedValue(null)
    else config.enabled = false
    await service.notifyCommentOnAssignedTask('AWTD-1561', 'comment', 'Please continue', 'Member')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(runAssistantWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'AWTD-1561', isCommentResponse: true, userComment: 'Please continue',
    }))
    expectNothingNew(db)
  })

  it('a task with no run owner never reads a policy and raises nothing', async () => {
    const { service, db, task } = fixture()
    task.lists = []
    task.creatorId = null as never
    await service.notifyCommentOnAssignedTask('AWTD-1561', 'comment', 'Please continue', 'Member')
    expect(runAssistantWorkflow).toHaveBeenCalledOnce()
    expectNothingNew(db)
  })
})

describe('AWTD-1561 fallback default with a configured webhook', () => {
  it('a healthy webhook keeps the unchanged signed payload and raises nothing', async () => {
    const { service, db } = fixture()
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetched()).toEqual([USER_HOOK])
    const request = fetchMock.mock.calls[0][1]!
    expect(request.headers).toEqual(generateWebhookHeaders(request.body as string, 'test-webhook-secret', 'task.assigned'))
    expect(JSON.parse(request.body as string)).toMatchObject({
      event: 'task.assigned', billing: { userId: 'payer', source: 'list-configured-by' },
    })
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
    expectNothingNew(db)
  })

  it('a double failure (user webhook, then env) posts exactly one visible notice and still falls back', async () => {
    const { service, db } = fixture()
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetched()).toEqual([USER_HOOK, ENV_HOOK])
    expect(runAssistantWorkflow).toHaveBeenCalledOnce()
    expect(notices()).toHaveLength(1)
    const [notice] = notices()
    // Signed by the agent: iOS and the Mac hide authorless comments.
    expect(notice.authorId).toBe('agent')
    expect(notice.content).toContain('HTTP 503')
    // The run's owner is mentioned, so they are notified even if not the creator.
    expect(notice.content).toContain('@[Payer](payer)')
    expect(isWebhookDeliveryNotice(notice.content)).toBe(true)
    expect(notice.content).toContain('<!-- SYSTEM_GENERATED_COMMENT -->')
    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
    expect(db.userWebhookConfig.updateMany).toHaveBeenCalled()
  })

  it('a transport failure on a comment posts one notice without the raw error', async () => {
    const { service } = fixture()
    fetchMock.mockRejectedValue(new Error('secret-containing network error'))
    await service.notifyCommentOnAssignedTask('AWTD-1561', 'comment', 'Please continue', 'Member')
    expect(notices()).toHaveLength(1)
    expect(notices()[0].authorId).toBe('agent')
    expect(JSON.stringify(notices())).not.toContain('secret-containing')
    expect(runAssistantWorkflow).toHaveBeenCalledOnce()
  })

  it('the notice is kept out of the assistant conversation history', () => {
    const prompt = buildPrompt({
      title: 'Delivery policy', priority: 1, lists: [{ name: 'List' }],
      comments: [
        { content: 'Webhook delivery failed (HTTP 503).\n\n<!-- WEBHOOK_DELIVERY_NOTICE -->', author: { isAIAgent: true } },
        { content: 'Please continue', author: { name: 'Member', isAIAgent: false } },
      ],
    }, true, 'Please continue')
    expect(prompt).toContain('Please continue')
    expect(prompt).not.toContain('Webhook delivery failed')
  })

  it('a healthy webhook not subscribed to comment events raises no notice', async () => {
    const { service, db, config } = fixture()
    config.events = ['task.assigned']
    await service.notifyCommentOnAssignedTask('AWTD-1561', 'comment', 'Please continue', 'Member')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(runAssistantWorkflow).toHaveBeenCalledOnce()
    expectNothingNew(db)
  })

  it.each(['agent not in the webhook list', 'retry limit reached'])('%s: not tried, so nothing new', async state => {
    const { service, db, config } = fixture()
    if (state.startsWith('agent')) config.agents = ['gemini']
    else config.failureCount = 3
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetched()).not.toContain(USER_HOOK)
    expectNothingNew(db)
  })

  it('a failing notice never changes the route', async () => {
    const { service } = fixture()
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    vi.mocked(postCommentAs).mockRejectedValueOnce(new Error('Database unavailable'))
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(runAssistantWorkflow).toHaveBeenCalledOnce()
  })
})

describe('AWTD-1561 malformed settings read as fallback', () => {
  it.each([
    ['broken JSON', '{broken-json'],
    ['unknown policy', JSON.stringify({ webhookDeliveryPolicy: 'strcit' })],
    ['wrong shape', JSON.stringify({ agentWebhookDeliveryPolicies: 'strict' })],
  ])('%s: dispatch proceeds as main', async (_label, raw) => {
    const { service, db } = fixture(raw)
    db.userWebhookConfig.findUnique.mockResolvedValue(null)
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetched()).toEqual([ENV_HOOK])
    expectNothingNew(db)
  })

  it('a settings read that throws is fallback too', async () => {
    const { service, db } = fixture()
    db.userWebhookConfig.findUnique.mockResolvedValue(null)
    db.user.findUnique.mockRejectedValue(new Error('db blip'))
    vi.stubEnv('CLAUDE_REMOTE_WEBHOOK_URL', '')
    await service.notifyCommentOnAssignedTask('AWTD-1561', 'comment', 'Please continue', 'Member')
    expect(runAssistantWorkflow).toHaveBeenCalledOnce()
    expectNothingNew(db)
  })

  it('resolution: binding beats default; anything unrecognised is fallback', () => {
    expect(resolveWebhookDeliveryPolicy({
      webhookDeliveryPolicy: 'strict', agentWebhookDeliveryPolicies: { claude: 'fallback' },
    }, 'claude')).toBe('fallback')
    expect(resolveWebhookDeliveryPolicy({ agentWebhookDeliveryPolicies: { claude: 'strict' } }, 'claude')).toBe('strict')
    expect(resolveWebhookDeliveryPolicy({ webhookDeliveryPolicy: 'strcit' })).toBe('fallback')
    expect(resolveWebhookDeliveryPolicy({ agentWebhookDeliveryPolicies: ['strict'] }, 'claude')).toBe('fallback')
  })
})

describe('AWTD-1561 opt-in strict delivery', () => {
  const recheck = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)

  function expectParked() {
    expect(updateTaskWithSideEffects).toHaveBeenCalledOnce()
    const [args] = vi.mocked(updateTaskWithSideEffects).mock.calls[0]
    expect(args).toMatchObject({
      taskId: 'AWTD-1561', actorId: 'agent', actorType: 'agent',
      intent: { statusRole: 'waiting', keepAssignee: true, dueDateTime: recheck },
    })
    // The Waiting rules accept it: a condition in the same write, assignee kept.
    const answer = resolveWaitingWriteTs(
      { id: 'AWTD-1561', statusRole: null, dueDateTime: null, assigneeId: 'agent', completed: false },
      [], { statusRole: 'waiting', dueDateTime: recheck, keepAssignee: true }, NOW,
    )
    expect(answer).toEqual({ ok: true, value: { statusRole: 'waiting', assignee: 'keep', transition: 'enter' } })
    expect(notices()).toHaveLength(1)
    expect(notices()[0].authorId).toBe('agent')
    expect(notices()[0].content).toContain('@[Payer](payer)')
    expect(notices()[0].content).toContain(formatRecheck(recheck, 'en'))
    expect(notices()[0].content).toContain('Waiting')
  }

  it.each(['missing', 'disabled', 'exhausted', 'unlisted agent', 'unsubscribed assignment', 'invalid', 'http', 'network'])(
    'assignment, %s: no env webhook, no server-side run; parked in Waiting with a visible notice',
    async failure => {
      const { service, db, config } = fixture({ webhookDeliveryPolicy: 'strict' })
      if (failure === 'missing') db.userWebhookConfig.findUnique.mockResolvedValue(null)
      if (failure === 'disabled') config.enabled = false
      if (failure === 'exhausted') config.failureCount = 3
      if (failure === 'unlisted agent') config.agents = []
      if (failure === 'unsubscribed assignment') config.events = []
      if (failure === 'invalid') config.webhookSecret = ''
      if (failure === 'http') fetchMock.mockResolvedValue(new Response('', { status: 503 }))
      if (failure === 'network') fetchMock.mockRejectedValue(new Error('secret-containing network error'))
      await service.notifyTaskAssignment('AWTD-1561', 'agent')
      expect(fetched()).not.toContain(ENV_HOOK)
      expect(runAssistantWorkflow).not.toHaveBeenCalled()
      expectParked()
      expect(JSON.stringify(notices())).not.toContain('secret-containing')
    },
  )

  it('keeps an existing future due date as the condition', async () => {
    const { service, task } = fixture({ webhookDeliveryPolicy: 'strict' })
    const due = new Date('2026-11-20T00:00:00.000Z')
    task.dueDateTime = due
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    const [args] = vi.mocked(updateTaskWithSideEffects).mock.calls[0]
    expect(args.intent).toEqual({ statusRole: 'waiting', keepAssignee: true })
    expect(notices()[0].content).toContain(formatRecheck(due, 'en'))
  })

  it('a comment under strict starts neither the tools nor the assistant workflow, and parks', async () => {
    const { service, task } = fixture({ webhookDeliveryPolicy: 'strict' })
    task.assignee.aiAgentType = 'claude_agent'
    task.lists[0].githubRepositoryId = 'owner/repo'
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    await service.notifyCommentOnAssignedTask('AWTD-1561', 'comment', 'Please continue', 'Member')
    expect(startToolsWorkflow).not.toHaveBeenCalled()
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
    expectParked()
  })

  it('a comment the strict owner chose not to receive neither runs nor parks', async () => {
    const { service, db, config } = fixture({ webhookDeliveryPolicy: 'strict' })
    config.events = ['task.assigned']
    await service.notifyCommentOnAssignedTask('AWTD-1561', 'comment', 'Please continue', 'Member')
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
    expectNothingNew(db)
  })

  it('a successful receipt is accepted, not reported as a started agent', async () => {
    const { service, db } = fixture({ webhookDeliveryPolicy: 'strict' })
    const send = vi.spyOn(service, 'sendToUserWebhook')
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(await send.mock.results[0].value).toMatchObject({
      sent: true, attempted: true, accepted: true, started: null, transport: 'user-webhook',
    })
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
    expectNothingNew(db)
  })

  it('an accepted delivery whose bookkeeping failed is not parked', async () => {
    const { service, db } = fixture({ webhookDeliveryPolicy: 'strict' })
    db.userWebhookConfig.update.mockRejectedValue(new Error('Bookkeeping unavailable'))
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetched()).toEqual([USER_HOOK])
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
    expectNothingNew(db)
  })

  it('polling mode is never sent or parked', async () => {
    const { service, db } = fixture({ webhookDeliveryPolicy: 'strict' })
    vi.mocked(isPollingOnlyAgent).mockResolvedValue(true)
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetchMock).not.toHaveBeenCalled()
    expectNothingNew(db)
  })

  it('a concurrent reassignment is not overwritten', async () => {
    const { service, db, task } = fixture({ webhookDeliveryPolicy: 'strict' })
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    db.task.findUnique.mockResolvedValue({ ...task, assigneeId: 'someone-else' })
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
    expectNothingNew(db)
  })

  it('a refused park posts nothing and still never falls back', async () => {
    const { service } = fixture({ webhookDeliveryPolicy: 'strict' })
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    vi.mocked(updateTaskWithSideEffects).mockResolvedValueOnce({ ok: false, status: 412, error: 'stale' })
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(postCommentAs).not.toHaveBeenCalled()
    expect(fetched()).toEqual([USER_HOOK])
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
  })

  it('a strict mailbox binding overrides the fallback account default', async () => {
    const { service } = fixture({ agentWebhookDeliveryPolicies: { claude: 'strict' } })
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(runAssistantWorkflow).not.toHaveBeenCalled()
    expectParked()
  })

  it("an external agent's own endpoint is still allowed; its failure parks", async () => {
    const { service, task, config } = fixture({ webhookDeliveryPolicy: 'strict' })
    task.assignee.email = 'external@example.com'
    task.assignee.webhookUrl = 'https://external.example.com/hook'
    config.enabled = false
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetched()).toEqual(['https://external.example.com/hook'])
    expectParked()
  })

  it('an external agent with no webhook at all parks', async () => {
    const { service, task } = fixture({ webhookDeliveryPolicy: 'strict' })
    task.assignee.email = 'external@example.com'
    await service.notifyTaskAssignment('AWTD-1561', 'agent')
    expect(fetchMock).not.toHaveBeenCalled()
    expectParked()
  })
})
