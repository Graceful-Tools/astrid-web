/**
 * Which runtime an agent uses, and who decides.
 *
 * The rules are short, but each one is a bill someone pays or an agent that
 * silently stops answering, so the edges are pinned here rather than discovered
 * in production. In particular: a user who has saved an API key must keep the
 * behaviour they had — a default that flips a working server-side setup to
 * polling looks exactly like an agent that has died.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { mockPrisma } from '@/tests/setup'
import {
  isAgentExecutionMode,
  isPollingOnlyAgent,
  isModeLockedToPolling,
  pollableMailboxes,
  resolveAgentExecutionMode,
  resolveAgentRunOwnerId,
} from '@/lib/ai/agent-execution-mode'

describe('resolveAgentExecutionMode', () => {
  it('puts a coding agent with no key in polling mode', () => {
    // The credit-exhaustion case: with no key there is nothing to spend and
    // nothing to 400, so the task waits in the queue instead of failing.
    expect(resolveAgentExecutionMode({ mailbox: 'claude' })).toBe('polling')
    expect(resolveAgentExecutionMode({ mailbox: 'openai' })).toBe('polling')
    expect(resolveAgentExecutionMode({ mailbox: 'gemini' })).toBe('polling')
    expect(resolveAgentExecutionMode({ mailbox: 'copilot' })).toBe('polling')
  })

  it('leaves a coding agent that HAS a key on the API, because saving one is the choice', () => {
    expect(
      resolveAgentExecutionMode({ mailbox: 'claude', hasStoredCredential: true })
    ).toBe('api')
  })

  it('obeys an explicit setting over both defaults', () => {
    expect(
      resolveAgentExecutionMode({
        mailbox: 'claude',
        hasStoredCredential: true,
        storedModes: { claude: 'polling' },
      })
    ).toBe('polling')

    expect(
      resolveAgentExecutionMode({
        mailbox: 'claude',
        hasStoredCredential: false,
        storedModes: { claude: 'api' },
      })
    ).toBe('api')
  })

  it('keeps codex in polling mode no matter what is stored', () => {
    // There is no server-side Codex executor. An 'api' setting here would be a
    // preference Astrid could only ever disobey.
    expect(resolveAgentExecutionMode({ mailbox: 'codex', storedModes: { codex: 'api' } })).toBe(
      'polling'
    )
    expect(isModeLockedToPolling('codex')).toBe(true)
    expect(isModeLockedToPolling('claude')).toBe(false)
  })

  it('leaves the assistant identity on the API', () => {
    // astrid@ answers in chat for people who have no harness at all; defaulting
    // it to polling would produce an assistant that never replies.
    expect(resolveAgentExecutionMode({ mailbox: 'astrid' })).toBe('api')
    expect(pollableMailboxes()).not.toContain('astrid')
  })

  it('treats a non-agent address as API rather than swallowing its dispatch', () => {
    expect(resolveAgentExecutionMode({ mailbox: null })).toBe('api')
  })

  it('ignores a stored value that is not a mode', () => {
    // A hand-edited or half-migrated blob must fall through to the default
    // rather than deciding the mode by truthiness.
    expect(
      resolveAgentExecutionMode({
        mailbox: 'claude',
        hasStoredCredential: true,
        storedModes: { claude: 'yes' },
      })
    ).toBe('api')
    expect(isAgentExecutionMode('yes')).toBe(false)
    expect(isAgentExecutionMode('polling')).toBe(true)
  })

  it('reads one agent per mailbox — a setting on claude does not move codex or gemini', () => {
    const storedModes = { claude: 'api' }
    expect(resolveAgentExecutionMode({ mailbox: 'claude', storedModes })).toBe('api')
    expect(resolveAgentExecutionMode({ mailbox: 'gemini', storedModes })).toBe('polling')
  })
})

describe('resolveAgentRunOwnerId', () => {
  it('prefers the list owner configured for agents, then the creator, then the list owner', () => {
    expect(
      resolveAgentRunOwnerId({
        aiAgentConfiguredBy: 'configured',
        creatorId: 'creator',
        listOwnerId: 'owner',
      })
    ).toBe('configured')

    expect(resolveAgentRunOwnerId({ creatorId: 'creator', listOwnerId: 'owner' })).toBe('creator')
    expect(resolveAgentRunOwnerId({ listOwnerId: 'owner' })).toBe('owner')
  })

  it('answers null rather than a blank string when nobody owns the run', () => {
    expect(resolveAgentRunOwnerId({})).toBeNull()
    expect(resolveAgentRunOwnerId({ creatorId: '', listOwnerId: null })).toBeNull()
  })
})

describe('isPollingOnlyAgent (reading a real user row)', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockReset()
  })

  const userWith = (mcpSettings: unknown) =>
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      mcpSettings: typeof mcpSettings === 'string' ? mcpSettings : JSON.stringify(mcpSettings),
    })

  it('keeps the server out of a task whose agent the user set to polling', async () => {
    userWith({ agentModes: { claude: 'polling' }, apiKeys: { claude: { encrypted: 'x', iv: 'y' } } })
    expect(await isPollingOnlyAgent('claude@astrid.cc', 'user-1')).toBe(true)
  })

  it('still runs server-side for a user who saved a key and said nothing', async () => {
    userWith({ apiKeys: { claude: { encrypted: 'x', iv: 'y' } } })
    expect(await isPollingOnlyAgent('claude@astrid.cc', 'user-1')).toBe(false)
  })

  it('defaults a keyless coding agent to polling instead of a doomed API call', async () => {
    // The credit-exhaustion regression: with no key, dispatching produced a 400
    // per trigger and a retry storm of identical failure comments on one task.
    userWith({})
    expect(await isPollingOnlyAgent('claude@astrid.cc', 'user-1')).toBe(true)
  })

  it('never routes codex through a server executor, even for an unknown owner', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)
    expect(await isPollingOnlyAgent('codex@astrid.cc', null)).toBe(true)
  })

  it('leaves a human assignee alone', async () => {
    userWith({ agentModes: { claude: 'polling' } })
    expect(await isPollingOnlyAgent('jonparis@gmail.com', 'user-1')).toBe(false)
  })

  it('treats unreadable settings as defaults rather than as permission to spend', async () => {
    userWith('{not json')
    expect(await isPollingOnlyAgent('claude@astrid.cc', 'user-1')).toBe(true)
  })
})

describe('webhook mode', () => {
  it('is a stored choice the resolver honors', () => {
    expect(isAgentExecutionMode('webhook')).toBe(true)
    expect(
      resolveAgentExecutionMode({ mailbox: 'claude', storedModes: { claude: 'webhook' } })
    ).toBe('webhook')
  })

  it('does NOT suppress server dispatch — only polling does', async () => {
    // Webhook users are pushed their work by the notifiers' webhook-first
    // routing; skipping dispatch for them would silence their server.
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      mcpSettings: JSON.stringify({ agentModes: { claude: 'webhook' } }),
    })
    expect(await isPollingOnlyAgent('claude@astrid.cc', 'user-1')).toBe(false)
  })
})
