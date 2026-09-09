/**
 * Task 0672b69b — an agent run is credentialed to the LIST'S CONFIGURED USER,
 * never the task creator.
 *
 * The hole this closes: `task.creatorId || list.ownerId` decided whose Claude
 * Code Remote server ran the job and whose API key paid for it, while editing a
 * task needs only `requireTaskAccess` — which every list member passes. So a
 * member could rewrite a victim-created task to an attacker-chosen prompt,
 * assign an agent, and have it execute on the victim's machine and bill.
 *
 * `aiAgentConfiguredBy` is the user who opted the list into agents in the first
 * place, and is therefore the one party that consented to pay for runs on it.
 * The creator is consulted ONLY for a task that sits on no list, where they are
 * the only person who can see it and so the only person exposed.
 *
 * These live beside the mode resolution on purpose: the comment on
 * `resolveAgentRunOwnerId` already says the mode check and the billing must not
 * land on two different people, so there is one answer, not two.
 */

import { describe, it, expect } from 'vitest'
import { resolveAgentRunBilling, resolveAgentRunOwnerId } from '@/lib/ai/agent-execution-mode'

describe('resolveAgentRunBilling (task 0672b69b)', () => {
  it('bills the list user who configured agents, not the task creator', () => {
    const billing = resolveAgentRunBilling({
      aiAgentConfiguredBy: 'configuring-user',
      creatorId: 'victim-user',
      listOwnerId: 'list-owner',
    })

    expect(billing.userId).toBe('configuring-user')
    expect(billing.source).toBe('list-configured-by')
  })

  it('never falls back to the creator while the task sits on a list', () => {
    const billing = resolveAgentRunBilling({
      aiAgentConfiguredBy: null,
      creatorId: 'victim-user',
      listOwnerId: 'list-owner',
    })

    expect(billing.userId).toBe('list-owner')
    expect(billing.source).toBe('list-owner')
  })

  it('falls back to the creator ONLY when the task is on no list, where nobody else is exposed', () => {
    const billing = resolveAgentRunBilling({ creatorId: 'solo-user' })

    expect(billing.userId).toBe('solo-user')
    expect(billing.source).toBe('task-creator')
  })

  it('resolves to nobody rather than guessing when there is no list and no creator', () => {
    const billing = resolveAgentRunBilling({})

    expect(billing.userId).toBeNull()
    expect(billing.source).toBe('none')
  })

  it('ignores a blank configuredBy rather than dispatching to an empty user id', () => {
    const billing = resolveAgentRunBilling({
      aiAgentConfiguredBy: '   ',
      creatorId: 'victim-user',
      listOwnerId: 'list-owner',
    })

    expect(billing.userId).toBe('list-owner')
  })

  it('keeps resolveAgentRunOwnerId as the same answer, so mode and billing cannot diverge', () => {
    const candidates = {
      aiAgentConfiguredBy: null,
      creatorId: 'victim-user',
      listOwnerId: 'list-owner',
    }

    expect(resolveAgentRunOwnerId(candidates)).toBe(resolveAgentRunBilling(candidates).userId)
  })
})
