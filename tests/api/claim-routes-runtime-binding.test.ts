/**
 * AWTD-1669 — both claim routes hand the service the caller's OAuth client as
 * the runtime principal, and answer a binding denial visibly: 403 with the
 * reason, or 409 when the binding is at capacity (so scripts/claim-fixall-task.ts
 * exits 2 and the loop moves on, exactly as for a lost race). Never a credential
 * or payer reference on the wire.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { BRAND } from '@/lib/brand/config'

vi.mock('@/lib/api-auth-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth-middleware')>('@/lib/api-auth-middleware')
  return { ...actual, authenticateAPI: vi.fn(), requireScopes: vi.fn(), requireTaskAccess: vi.fn() }
})
vi.mock('@/services/fixall-claim.service', () => ({ claimFixallTask: vi.fn() }))
vi.mock('@/services/agent-task-claim.service', () => ({ claimAgentTask: vi.fn() }))
vi.mock('@/lib/task-identifier', () => ({ resolveTaskIdOrIdentifier: vi.fn(async (id: string) => id) }))

import { POST as claimFixall } from '@/app/api/v1/tasks/[id]/claim-fixall/route'
import { POST as claimV1 } from '@/app/api/v1/tasks/[id]/claim/route'
import { authenticateAPI, requireScopes, requireTaskAccess } from '@/lib/api-auth-middleware'
import { claimFixallTask } from '@/services/fixall-claim.service'
import { claimAgentTask } from '@/services/agent-task-claim.service'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const CLIENT = 'astrid_client_0123456789abcdef0123456789abcdef'
const CLAUDE = `claude@${BRAND.agentEmailDomain}`
const params = Promise.resolve({ id: TASK_ID })
const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost/api/v1/tasks/${TASK_ID}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
const denial = (reason: string) => ({
  kind: 'denied' as const, reason, bindingId: 'binding-1', boardId: 'board-a', message: `denied: ${reason}`,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ASTRID_AGENT_CLAIM_API', 'on')
  vi.mocked(authenticateAPI).mockResolvedValue({
    userId: 'owner-1', source: 'oauth', scopes: ['tasks:write'], clientId: CLIENT, isAIAgent: true,
    user: { id: 'agent-claude', email: CLAUDE, name: 'Claude', isAIAgent: true },
    agentUser: { id: 'agent-claude', email: CLAUDE, name: 'Claude', isAIAgent: true },
  } as never)
  vi.mocked(requireScopes).mockReturnValue(undefined)
  vi.mocked(requireTaskAccess).mockResolvedValue(undefined as never)
})

describe('POST /api/v1/tasks/:id/claim-fixall — runtime binding (AWTD-1669)', () => {
  it('passes the OAuth client as the runtime principal and the caller as the actor', async () => {
    vi.mocked(claimFixallTask).mockResolvedValue({ status: 'claimed', assigneeEmail: CLAUDE })
    const res = await claimFixall(post('claim-fixall', { action: 'ready', commentWatermark: null, agent: 'claude' }), { params })
    expect(res.status).toBe(200)
    expect(vi.mocked(claimFixallTask).mock.calls[0][2]).toEqual({ principal: CLIENT, actorUserId: 'owner-1' })
  })

  it.each([['principal-not-runtime', 403], ['binding-not-active', 403], ['credential-missing', 403], ['capacity-exhausted', 409]])(
    '%s → %i with reason, binding and board', async (reason, code) => {
      vi.mocked(claimFixallTask).mockResolvedValue({ status: 'binding-denied', denial: denial(reason) as never })
      const res = await claimFixall(post('claim-fixall', { action: 'ready', commentWatermark: null, agent: 'claude' }), { params })
      expect(res.status).toBe(code)
      expect(await res.json()).toEqual({ error: `denied: ${reason}`, reason, bindingId: 'binding-1', boardId: 'board-a' })
    },
  )
})

describe('POST /api/v1/tasks/:id/claim — runtime binding (AWTD-1669)', () => {
  it('passes the agent address and the OAuth client to the service', async () => {
    vi.mocked(claimAgentTask).mockResolvedValue({ outcome: 'claimed', task: null })
    await claimV1(post('claim', { action: 'claim' }), { params })
    expect(vi.mocked(claimAgentTask).mock.calls[0][0]).toMatchObject({ agentEmail: CLAUDE, principal: CLIENT })
  })

  it.each([['agent-not-allowed', 403], ['capacity-exhausted', 409]])('%s → %i', async (reason, code) => {
    const { kind: _kind, ...binding } = denial(reason)
    vi.mocked(claimAgentTask).mockResolvedValue({ outcome: 'binding_denied', task: null, binding: binding as never })
    const res = await claimV1(post('claim', { action: 'claim' }), { params })
    expect(res.status).toBe(code)
    expect(await res.json()).toEqual({ outcome: 'binding_denied', task: null, binding })
  })
})
