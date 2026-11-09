import { describe, expect, it } from 'vitest'
import {
  parseAgentTaskClaimRequest,
  resolveAgentTaskClaimPrincipal,
} from '@/lib/agent-task-claim'
import { BRAND } from '@/lib/brand/config'

describe('agent task claim contract (AWTD-1555)', () => {
  it('accepts claim, resume, and release actions without constraining registered mailboxes', () => {
    expect(parseAgentTaskClaimRequest({ action: 'claim', agentMailbox: 'codex' })).toEqual({
      action: 'claim',
      agentMailbox: 'codex',
    })
    expect(parseAgentTaskClaimRequest({ action: 'resume' })).toEqual({ action: 'resume' })
    expect(parseAgentTaskClaimRequest({ action: 'release' })).toEqual({ action: 'release' })
  })

  it('rejects invalid actions, extra fields, and malformed mailbox values', () => {
    expect(() => parseAgentTaskClaimRequest({ action: 'pause' })).toThrow(/action/)
    expect(() => parseAgentTaskClaimRequest({ action: 'claim', agent: 'codex' })).toThrow(/unsupported/)
    expect(() => parseAgentTaskClaimRequest({ action: 'claim', agentMailbox: 'not a mailbox' }))
      .toThrow(/mailbox/)
  })

  it('uses only the authenticated agent binding and rejects a different mailbox', () => {
    const auth = {
      userId: 'owner-1',
      source: 'oauth' as const,
      scopes: ['tasks:write'],
      isAIAgent: false,
      user: { id: 'owner-1', email: 'owner@example.test', name: 'Owner', isAIAgent: false },
      agentUser: {
        id: 'agent-1',
        email: `workspace-bot.oc@${BRAND.agentEmailDomain}`,
        name: 'Workspace Bot',
        isAIAgent: true,
      },
    }

    expect(resolveAgentTaskClaimPrincipal(auth, 'workspace-bot.oc')).toEqual({
      agentId: 'agent-1',
      agentEmail: `workspace-bot.oc@${BRAND.agentEmailDomain}`,
      agentMailbox: 'workspace-bot.oc',
    })
    expect(resolveAgentTaskClaimPrincipal(auth, 'codex')).toBeNull()
    expect(resolveAgentTaskClaimPrincipal({
      ...auth,
      agentUser: null,
    })).toBeNull()
  })

  it('allows an authenticated AI user to act only as its own identity', () => {
    const auth = {
      isAIAgent: true,
      user: {
        id: 'codex-1',
        email: `codex@${BRAND.agentEmailDomain}`,
        name: 'Codex',
        isAIAgent: true,
      },
      agentUser: null,
    }

    expect(resolveAgentTaskClaimPrincipal(auth)?.agentMailbox).toBe('codex')
    expect(resolveAgentTaskClaimPrincipal(auth, 'claude')).toBeNull()
  })
})
