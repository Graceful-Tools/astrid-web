/**
 * AWTD-1669 — every server-side dispatch path consults the runtime binding, so
 * a bound board never falls through to personal-settings dispatch.
 *
 * The paths the resolver PR (#803) listed as not yet consulting it:
 * assignment dispatch, comment dispatch and coding-workflow resume; plus the
 * two more a bound board must not trigger — approval commands and the Astrid
 * mention reply. Each is driven for real, with the board bound and the pilot on
 * (stands down, no token minted, no webhook, no workflow), bound but DENIED
 * (stands down, denial audited), and with the pilot off (dispatches exactly as
 * before, without reading the binding).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockPrisma } from '@/tests/setup'
import { BRAND } from '@/lib/brand/config'

vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/ai/agent-execution-mode', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ai/agent-execution-mode')>()
  // Webhook / server mode, so an unbound dispatch reaches the push it would make.
  return {
    ...actual,
    isPollingOnlyAgent: vi.fn(async () => false),
    getAgentExecutionMode: vi.fn(async () => 'api'),
  }
})
const createForTask = vi.hoisted(() => vi.fn(async () => ({ executeCompleteWorkflow: vi.fn(() => Promise.resolve()) })))
vi.mock('@/lib/ai-orchestrator', () => ({ AIOrchestrator: { createForTask } }))
vi.mock('@/lib/ai/agent-config', () => ({ getAgentService: () => 'claude' }))
const enqueueJob = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined))
vi.mock('@/lib/jobs/queue', () => ({ enqueueJob }))
vi.mock('@/lib/user-stats', () => ({ invalidateUserStats: vi.fn() }))
vi.mock('@/lib/notification-store', () => ({ persistNotifications: vi.fn() }))
vi.mock('@/lib/push-notification-service', () => ({
  PushNotificationService: class {
    sendCommentNotification() { return Promise.resolve() }
  },
}))
const startToolsWorkflow = vi.hoisted(() => vi.fn(async () => ({ ok: true })))
vi.mock('@/lib/coding-workflow/start-tools-workflow', () => ({ startToolsWorkflow }))

import { notifyTaskAssignment } from '@/lib/webhooks/task-assignment-notifier'
import { notifyCommentOnAssignedTask } from '@/lib/webhooks/comment-notifier'
import { dispatchPostCommentSideEffects } from '@/lib/comments/post-comment-side-effects'
import { processCommentForWorkflowAction } from '@/lib/comment-approval-detector'

const CLAUDE = `claude@${BRAND.agentEmailDomain}`
const ASTRID = `astrid@${BRAND.agentEmailDomain}`
const AGENT = {
  id: 'agent-user', email: CLAUDE, name: 'Claude Agent', isAIAgent: true,
  aiAgentType: 'coding_agent', aiAgentConfig: null, webhookUrl: null,
}
const ACTIVE_BINDING = {
  id: 'binding-1', revision: 2, managementScope: 'deployment-business', runtimeKind: 'business-machine',
  runtimeSubjectId: 'astrid_client_runtime', allowedAgentIds: ['claude', 'astrid'], transport: 'polling',
  credentialRef: 'cred:x', allowedRepositoryRefs: [], allowedBoardIds: ['list-1'], maxConcurrentRuns: 1,
  billingSource: 'business-provided', billingAccountRef: 'payer:x', state: 'active', approvedBy: 'a', approvedRevision: 2,
}

function notifierTask() {
  return {
    id: 'task-1', title: 'T', description: 'D', priority: 1, dueDateTime: null, creatorId: 'creator',
    assignee: AGENT, aiAgent: null, creator: { id: 'creator', name: 'C', email: 'c@example.test' },
    lists: [{
      id: 'list-1', name: 'L', description: null, githubRepositoryId: 'acme/app', ownerId: 'owner',
      aiAgentConfiguredBy: 'configurer', owner: { id: 'owner', email: 'o@example.test' },
    }],
    comments: [],
  }
}
function notifierDeps() {
  const sendToUserWebhook = vi.fn(async () => ({ sent: true, status: 200 }))
  const sendWebhookNotification = vi.fn(async () => undefined)
  const prisma = {
    task: { findFirst: vi.fn(async () => notifierTask()) },
    comment: { findUnique: vi.fn(async () => ({ id: 'c-1', content: 'hi', createdAt: new Date(), author: null })) },
    mCPToken: { findFirst: vi.fn(async () => ({ id: 'tok', token: 'plain', tokenHash: null })), create: vi.fn() },
    user: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    taskList: { findMany: vi.fn(async () => []) },
    listMember: { findMany: vi.fn(async () => []) },
    userWebhookConfig: { findUnique: vi.fn(async () => null) },
  }
  return { prisma, sendToUserWebhook, sendWebhookNotification, pushService: { sendToUser: vi.fn() } }
}

type Mode = 'pilot-off' | 'bound' | 'denied' | 'unbound'
function arrange(mode: Mode) {
  if (mode !== 'pilot-off') {
    vi.stubEnv('ASTRID_RUNTIME_BINDING_RESOLVER', 'true')
    vi.stubEnv('ASTRID_RUNTIME_BINDING_SINGLE_BUSINESS', 'true')
  }
  // The board is bound in every mode except `unbound` — with the pilot off the
  // association is simply never read.
  mockPrisma.task.findUnique.mockImplementation(async (q: { select?: { lists?: unknown } }) =>
    q.select?.lists
      ? { lists: [{ id: 'list-1', runtimeBindingId: mode === 'unbound' ? null : 'binding-1' }] }
      : { creatorId: 'creator', assignee: { email: CLAUDE }, lists: [{ ownerId: 'owner', aiAgentConfiguredBy: 'configurer' }] },
  )
  mockPrisma.runtimeBinding.findUnique.mockResolvedValue(
    mode === 'denied' ? { ...ACTIVE_BINDING, state: 'suspended' } : ACTIVE_BINDING,
  )
}
const bindingReads = () =>
  mockPrisma.runtimeBinding.findUnique.mock.calls.length +
  mockPrisma.task.findUnique.mock.calls.filter(call => !!(call[0] as { select?: { lists?: unknown } } | undefined)?.select?.lists).length
const deniedAudits = () =>
  mockPrisma.runtimeBindingAuditEvent.create.mock.calls.filter(call => (call[0] as { data: { eventType: string } }).data.eventType === 'resolution-denied')

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.task.findUnique.mockReset()
  mockPrisma.runtimeBinding.findUnique.mockReset()
  mockPrisma.codingTaskWorkflow.findUnique.mockResolvedValue(null)
})
afterEach(() => vi.unstubAllEnvs())

describe('AWTD-1669 — assignment dispatch consults the binding', () => {
  it.each<[Mode, boolean]>([['pilot-off', true], ['unbound', true], ['bound', false], ['denied', false]])(
    '%s → dispatched: %s', async (mode, dispatched) => {
      arrange(mode)
      const deps = notifierDeps()
      await notifyTaskAssignment({ taskId: 'task-1', aiAgentId: AGENT.id }, deps as never)
      expect(deps.sendToUserWebhook.mock.calls.length > 0).toBe(dispatched)
      // Standing down happens before a token is looked up or minted.
      if (!dispatched) expect(deps.prisma.mCPToken.findFirst).not.toHaveBeenCalled()
      if (mode === 'pilot-off') expect(bindingReads()).toBe(0)
      expect(deniedAudits()).toHaveLength(mode === 'denied' ? 1 : 0)
    },
  )
})

describe('AWTD-1669 — comment dispatch consults the binding', () => {
  it.each<[Mode, boolean]>([['pilot-off', true], ['unbound', true], ['bound', false], ['denied', false]])(
    '%s → dispatched: %s', async (mode, dispatched) => {
      arrange(mode)
      const deps = notifierDeps()
      await notifyCommentOnAssignedTask(
        { taskId: 'task-1', commentId: 'c-1', commentContent: 'hi', commenterName: 'Owner' },
        deps as never,
      )
      expect(deps.sendToUserWebhook.mock.calls.length > 0).toBe(dispatched)
      if (!dispatched) expect(deps.prisma.mCPToken.findFirst).not.toHaveBeenCalled()
      if (mode === 'pilot-off') expect(bindingReads()).toBe(0)
      expect(deniedAudits()).toHaveLength(mode === 'denied' ? 1 : 0)
    },
  )
})

describe('AWTD-1669 — coding-workflow resume consults the binding', () => {
  it.each<[Mode, boolean]>([['pilot-off', true], ['unbound', true], ['bound', false], ['denied', false]])(
    '%s → workflow started: %s', async (mode, started) => {
      arrange(mode)
      await dispatchPostCommentSideEffects({
        comment: { id: 'c-1', content: 'please continue' },
        task: {
          id: 'task-1', title: 'T', creatorId: 'creator', assigneeId: AGENT.id,
          assignee: { id: AGENT.id, email: CLAUDE, name: 'Claude Agent', isAIAgent: true, aiAgentType: 'coding_agent' },
          lists: [{ id: 'list-1', githubRepositoryId: 'acme/app', aiAgentConfiguredBy: 'configurer' }],
        },
        commenter: { id: 'human-1', name: 'Owner', email: 'o@example.test', isAIAgent: false },
      })
      expect(createForTask.mock.calls.length > 0).toBe(started)
      if (mode === 'pilot-off') expect(mockPrisma.runtimeBinding.findUnique).not.toHaveBeenCalled()
    },
  )
})

describe('AWTD-1669 — approval commands consult the binding', () => {
  it.each<[Mode, boolean]>([['pilot-off', true], ['unbound', true], ['bound', false], ['denied', false]])(
    '%s → server workflow consulted: %s', async (mode, consulted) => {
      arrange(mode)
      await processCommentForWorkflowAction('task-1', 'c-1', 'ship it', 'human-1')
      expect(mockPrisma.codingTaskWorkflow.findUnique.mock.calls.length > 0).toBe(consulted)
    },
  )
})

describe('AWTD-1669 — the Astrid mention reply consults the binding', () => {
  it.each<[Mode, boolean]>([['pilot-off', true], ['unbound', true], ['bound', false], ['denied', false]])(
    '%s → reply enqueued: %s', async (mode, enqueued) => {
      arrange(mode)
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'astrid-id', isAIAgent: true, email: ASTRID }])
      mockPrisma.comment.findMany.mockResolvedValue([])
      await dispatchPostCommentSideEffects({
        comment: { id: 'c-1', content: '@[Astrid](astrid-id) what next?' },
        task: { id: 'task-1', title: 'T', creatorId: 'creator', assigneeId: null, assignee: null, lists: [{ id: 'list-1' }] },
        commenter: { id: 'human-1', name: 'Owner', email: 'o@example.test', isAIAgent: false },
      })
      const replies = enqueueJob.mock.calls.filter(([kind]) => kind === 'astrid-comment-reply')
      expect(replies.length > 0).toBe(enqueued)
    },
  )
})
