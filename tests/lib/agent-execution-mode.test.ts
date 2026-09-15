/**
 * Which runtime an agent uses, and who decides.
 *
 * The rules are short, but each one is a bill someone pays or an agent that
 * silently stops answering, so the edges are pinned here rather than discovered
 * in production. In particular: a user who has saved an API key must keep the
 * behaviour they had — a default that flips a working server-side setup to
 * polling looks exactly like an agent that has died.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockPrisma } from '@/tests/setup'
import {
  isAgentExecutionMode,
  isAgentOffered,
  isPollingOnlyAgent,
  isModeLockedToPolling,
  isModeSettableFor,
  pollableMailboxes,
  resolveAgentExecutionMode,
  resolveAgentRunOwnerId,
  setAgentExecutionMode,
  shouldPostServerWorkflowComments,
} from '@/lib/ai/agent-execution-mode'
import { BRAND } from '@/lib/brand/config'

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
  it('prefers the user who configured agents on the list, then the list owner', () => {
    expect(
      resolveAgentRunOwnerId({
        aiAgentConfiguredBy: 'configured',
        creatorId: 'creator',
        listOwnerId: 'owner',
      })
    ).toBe('configured')

    // The creator USED to come second here, and that was the vulnerability
    // (task 0672b69b): any list member can edit a task, so the creator's key
    // and self-hosted server were spendable by everyone the list is shared
    // with. See tests/lib/agent-run-billing.test.ts for the full rule.
    expect(resolveAgentRunOwnerId({ creatorId: 'creator', listOwnerId: 'owner' })).toBe('owner')
    expect(resolveAgentRunOwnerId({ listOwnerId: 'owner' })).toBe('owner')

    // With no list at all, the creator is the only person exposed.
    expect(resolveAgentRunOwnerId({ creatorId: 'creator' })).toBe('creator')
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
    expect(await isPollingOnlyAgent(`claude@${BRAND.agentEmailDomain}`, 'user-1')).toBe(true)
  })

  it('still runs server-side for a user who saved a key and said nothing', async () => {
    userWith({ apiKeys: { claude: { encrypted: 'x', iv: 'y' } } })
    expect(await isPollingOnlyAgent(`claude@${BRAND.agentEmailDomain}`, 'user-1')).toBe(false)
  })

  it('defaults a keyless coding agent to polling instead of a doomed API call', async () => {
    // The credit-exhaustion regression: with no key, dispatching produced a 400
    // per trigger and a retry storm of identical failure comments on one task.
    userWith({})
    expect(await isPollingOnlyAgent(`claude@${BRAND.agentEmailDomain}`, 'user-1')).toBe(true)
  })

  it('never routes codex through a server executor, even for an unknown owner', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)
    expect(await isPollingOnlyAgent(`codex@${BRAND.agentEmailDomain}`, null)).toBe(true)
  })

  it('leaves a human assignee alone', async () => {
    userWith({ agentModes: { claude: 'polling' } })
    expect(await isPollingOnlyAgent('jonparis@gmail.com', 'user-1')).toBe(false)
  })

  it('treats unreadable settings as defaults rather than as permission to spend', async () => {
    userWith('{not json')
    expect(await isPollingOnlyAgent(`claude@${BRAND.agentEmailDomain}`, 'user-1')).toBe(true)
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
    expect(await isPollingOnlyAgent(`claude@${BRAND.agentEmailDomain}`, 'user-1')).toBe(false)
  })
})

describe('server workflow comments (task ae70990c)', () => {
  it('posts canned workflow narration only when Astrid runs the agent via API', () => {
    expect(shouldPostServerWorkflowComments('api')).toBe(true)
    expect(shouldPostServerWorkflowComments('polling')).toBe(false)
    expect(shouldPostServerWorkflowComments('webhook')).toBe(false)
    expect(shouldPostServerWorkflowComments('off')).toBe(false)
  })
})

describe("off mode — Don't use", () => {
  it('is a stored choice the resolver honors, even over a saved key', () => {
    expect(isAgentExecutionMode('off')).toBe(true)
    expect(
      resolveAgentExecutionMode({
        mailbox: 'claude',
        hasStoredCredential: true,
        storedModes: { claude: 'off' },
      })
    ).toBe('off')
  })

  it('suppresses server dispatch like polling — the server must not run it', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      mcpSettings: JSON.stringify({ agentModes: { claude: 'off' } }),
    })
    expect(await isPollingOnlyAgent(`claude@${BRAND.agentEmailDomain}`, 'user-1')).toBe(true)
  })
})


describe('isAgentOffered (task 9dbe0b17)', () => {
  it('offers self-run modes with or without a key', () => {
    expect(isAgentOffered('polling', false)).toBe(true)
    expect(isAgentOffered('webhook', false)).toBe(true)
  })

  it('gates api mode on the key', () => {
    expect(isAgentOffered('api', true)).toBe(true)
    expect(isAgentOffered('api', false)).toBe(false)
  })

  it('never offers an off agent, key or not', () => {
    expect(isAgentOffered('off', true)).toBe(false)
    expect(isAgentOffered('off', false)).toBe(false)
  })
})

/**
 * task 42349da6 — a harness agent can be turned OFF, and refuses only the
 * modes it genuinely cannot run.
 *
 * `isModeLockedToPolling` used to mean "no setting of any kind", so
 * setAgentExecutionMode threw for EVERY mode on `codex`/`muse`. The AI Agents
 * page renders the Muse row against the `muse` mailbox (the Codex row dodges
 * this by pointing at `openai`), so every button on that row — Astrid runs it,
 * Off, Webhook server — PUT a mode and got a 400 back.
 *
 * The lock is about the absence of a SERVER EXECUTOR, which rules out `api`
 * and `webhook`. It says nothing about whether the user wants the agent at
 * all: `off` means "not in use", and a harness agent is exactly as
 * turn-off-able as any other. Jon, 2026-09-15.
 */
describe('a locked harness agent accepts the modes it can actually run (task 42349da6)', () => {
  it('rejects only the modes that need a server executor', () => {
    for (const mailbox of ['codex', 'muse']) {
      expect(isModeLockedToPolling(mailbox), mailbox).toBe(true)
      expect(isModeSettableFor(mailbox, 'api'), `${mailbox} api`).toBe(false)
      expect(isModeSettableFor(mailbox, 'webhook'), `${mailbox} webhook`).toBe(false)
      expect(isModeSettableFor(mailbox, 'polling'), `${mailbox} polling`).toBe(true)
      expect(isModeSettableFor(mailbox, 'off'), `${mailbox} off`).toBe(true)
    }
  })

  it('leaves an unlocked agent able to take every mode', () => {
    for (const mode of ['api', 'polling', 'webhook', 'off'] as const) {
      expect(isModeSettableFor('claude', mode), mode).toBe(true)
    }
  })

  it('honors a stored off, rather than storing a preference it disobeys', () => {
    // The forced-polling short-circuit used to run BEFORE stored modes, so an
    // `off` that the API accepted would still resolve to polling — the exact
    // "a preference someone set and Astrid disobeyed" failure the module warns
    // about, just one layer down.
    expect(resolveAgentExecutionMode({ mailbox: 'muse', storedModes: { muse: 'off' } })).toBe('off')
  })

  it('still forces polling for every other stored value', () => {
    // There is no server executor, so `api` and `webhook` remain unreachable
    // however they got into the blob.
    for (const stored of ['api', 'webhook']) {
      expect(
        resolveAgentExecutionMode({ mailbox: 'muse', storedModes: { muse: stored } }),
        stored
      ).toBe('polling')
    }
    expect(resolveAgentExecutionMode({ mailbox: 'muse' })).toBe('polling')
  })

  it('stops dispatching for a harness agent that was turned off', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      mcpSettings: JSON.stringify({ agentModes: { muse: 'off' } }),
    })
    expect(await isPollingOnlyAgent(`muse@${BRAND.agentEmailDomain}`, 'user-1')).toBe(true)
  })
})

/**
 * task 42349da6 — the write path itself, which is what returned the 400.
 *
 * The route maps "no API mode" and "Unknown agent" to 400 and everything else
 * to 500, so which errors this throws IS the status the AI Agents page sees.
 * It had no direct test, which is the other half of why a row that could only
 * ever fail shipped.
 */
describe('setAgentExecutionMode (task 42349da6)', () => {
  /**
   * A stand-in for the row, so a save is actually readable afterwards —
   * setAgentExecutionMode returns getAgentExecutionModes(), which re-reads.
   * A findUnique pinned to one value would report the mode it was asked to
   * change, and every case here would pass whether or not the write happened.
   */
  let mcpSettings: string

  beforeEach(() => {
    vi.clearAllMocks()
    mcpSettings = '{}'
    mockPrisma.user.findUnique.mockImplementation(async () => ({ id: 'user-1', mcpSettings }))
    mockPrisma.user.update.mockImplementation(async ({ data }: { data: { mcpSettings: string } }) => {
      mcpSettings = data.mcpSettings
      return {}
    })
  })

  const saved = () => JSON.parse(mcpSettings)

  it('turns a harness agent off, and persists it', async () => {
    const modes = await setAgentExecutionMode('user-1', 'muse', 'off')
    expect(modes.muse).toBe('off')
    expect(saved().agentModes.muse).toBe('off')
  })

  it('still refuses to give it a server runtime it does not have', async () => {
    for (const mode of ['api', 'webhook'] as const) {
      await expect(setAgentExecutionMode('user-1', 'muse', mode)).rejects.toThrow('no API mode')
    }
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it('keeps the saved API keys, so turning an agent off is reversible', async () => {
    // Read-modify-write on the blob the credentials share. A save that dropped
    // them would make "pick another mode to bring it back exactly as it was"
    // a lie, which is what the off-mode copy promises.
    mcpSettings = JSON.stringify({ apiKeys: { claude: { encrypted: 'x' } } })
    await setAgentExecutionMode('user-1', 'claude', 'off')

    expect(saved().apiKeys.claude.encrypted).toBe('x')
    expect(saved().agentModes.claude).toBe('off')
  })

  it('rejects a mailbox that is not an agent at all', async () => {
    await expect(setAgentExecutionMode('user-1', 'nobody', 'polling')).rejects.toThrow('Unknown agent')
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })
})
