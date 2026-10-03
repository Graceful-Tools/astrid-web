/**
 * AWTD-937 — adding a coding-harness agent should be ONE definition, not nine
 * edits scattered across lib/.
 *
 * Before this, `codex` had to be listed by hand in all of:
 *
 *   AGENT_MAILBOXES, LOCAL_HARNESS_AGENT_MAILBOXES  (lib/brand/agent-emails.ts)
 *   LOCAL_HARNESS_PROFILES                          (lib/ai/agent-config.ts)
 *   CODING_AGENT_MAILBOXES                          (lib/ai/agent-execution-mode.ts)
 *   CONSENT_AGENT_MAILBOXES                         (lib/oauth/agent-consent.ts)
 *   FIXALL_HARNESS_MAILBOXES                        (lib/ready-queue-scope.ts)
 *   FIXALL_CLAIM_MAILBOXES                          (lib/fixall-claim.ts)
 *   AGENT_ICONS                                     (app/api/v1/agent-icon/[slug])
 *   the prefix array                                (lib/webhooks/agent-type.ts)
 *
 * Every omission fails quietly and differently. Miss the consent list and the
 * CLI cannot authenticate as itself. Miss the fixall harness map and
 * `--harness muse` reads as an empty queue rather than an unknown harness — the
 * loop reports "nothing to do" forever instead of erroring once.
 *
 * These cases pin the DERIVATION: each list must contain every harness agent,
 * so the next one added to the table cannot be half-registered.
 */
import { describe, it, expect } from 'vitest'

import {
  HARNESS_AGENTS,
  harnessAgentMailboxes,
  pollingOnlyHarnessMailboxes,
  type HarnessAgent,
} from '@/lib/ai/harness-agents'
import { AGENT_MAILBOXES, LOCAL_HARNESS_AGENT_MAILBOXES, agentEmail, isLocalHarnessAgentEmail } from '@/lib/brand/agent-emails'
import { getAgentIdentity, getAgentConfig } from '@/lib/ai/agent-config'
import { pollableMailboxes, resolveAgentExecutionMode, isModeLockedToPolling } from '@/lib/ai/agent-execution-mode'
import { CONSENT_AGENT_MAILBOXES, isConsentAgentAvailable } from '@/lib/oauth/agent-consent'
import { FIXALL_HARNESS_MAILBOXES } from '@/lib/ready-queue-scope'
import { FIXALL_CLAIM_MAILBOXES } from '@/lib/fixall-claim'
import { getAgentType } from '@/lib/webhooks/agent-type'

const mailboxes = harnessAgentMailboxes()
const pollingOnly = pollingOnlyHarnessMailboxes()
const serverRunnable = mailboxes.filter(mailbox => !pollingOnly.includes(mailbox))

describe('which harnesses the server can also run (AWTD-1053)', () => {
  it('codex is polling-only and muse is server-runnable', () => {
    // Pinned so the it.each blocks below are never vacuous on either side.
    expect(pollingOnly).toEqual(['codex'])
    expect(serverRunnable).toEqual(['muse'])
  })
})

describe('the harness-agent table (AWTD-937)', () => {
  it('still contains the harnesses that predate it', () => {
    // A refactor that quietly dropped one would deregister a working agent.
    expect(mailboxes).toContain('codex')
    expect(mailboxes).toContain('muse')
  })

  it('gives every entry the facts a harness agent cannot work without', () => {
    for (const agent of HARNESS_AGENTS) {
      expect(agent.mailbox, 'mailbox').toMatch(/^[a-z][a-z0-9-]*$/)
      expect(agent.displayName, `${agent.mailbox} displayName`).toBeTruthy()
      expect(agent.label, `${agent.mailbox} label`).toBeTruthy()
    }
  })

  it('has no duplicate mailboxes', () => {
    expect(new Set(mailboxes).size).toBe(mailboxes.length)
  })
})

describe('every harness agent is registered everywhere it must be (AWTD-937)', () => {
  it.each(mailboxes)('%s has a brand mailbox', mailbox => {
    expect(Object.values(AGENT_MAILBOXES)).toContain(mailbox)
  })

  it.each(pollingOnly)('%s is a local-harness identity, so no server executor claims it', mailbox => {
    expect(LOCAL_HARNESS_AGENT_MAILBOXES as readonly string[]).toContain(mailbox)
    expect(isLocalHarnessAgentEmail(agentEmail(mailbox))).toBe(true)
  })

  it.each(pollingOnly)('%s is absent from the provider routing table', mailbox => {
    // In AGENT_DEFINITIONS it would be dispatched to a cloud provider, and the
    // cloud agent would eat work the local CLI was handed.
    expect(getAgentConfig(agentEmail(mailbox))).toBeNull()
  })

  it.each(pollingOnly)('%s has a display identity for the User row it owns', mailbox => {
    const identity = getAgentIdentity(agentEmail(mailbox))
    expect(identity).not.toBeNull()
    expect(identity?.agentType).toBe('local_harness_agent')
  })

  it.each(mailboxes)('%s is offered in the settings UI as pollable', mailbox => {
    expect(pollableMailboxes()).toContain(mailbox)
  })

  it.each(pollingOnly)('%s is locked to polling and cannot be overridden to api', mailbox => {
    expect(isModeLockedToPolling(mailbox)).toBe(true)
    // Even an explicitly stored 'api' must not win: there is no executor.
    expect(resolveAgentExecutionMode({ mailbox, storedModes: { [mailbox]: 'api' } })).toBe('polling')
  })

  // A harness the server can ALSO run (Muse, AWTD-1053) is the claude@ shape:
  // one identity, routed to a provider in API mode and left to the CLI when
  // polling. The mode, not the table, decides which runtime gets the work.
  it.each(serverRunnable)('%s is in the provider routing table, so API mode has an executor', mailbox => {
    expect(getAgentConfig(agentEmail(mailbox))).not.toBeNull()
    expect(isLocalHarnessAgentEmail(agentEmail(mailbox))).toBe(false)
    expect(getAgentIdentity(agentEmail(mailbox))).not.toBeNull()
  })

  it.each(serverRunnable)('%s is not locked to polling, and an explicit api wins', mailbox => {
    expect(isModeLockedToPolling(mailbox)).toBe(false)
    expect(resolveAgentExecutionMode({ mailbox, storedModes: { [mailbox]: 'api' } })).toBe('api')
  })

  it.each(mailboxes)('%s may complete an OAuth consent as itself', mailbox => {
    expect(CONSENT_AGENT_MAILBOXES as readonly string[]).toContain(mailbox)
    expect(isConsentAgentAvailable(mailbox)).toBe(true)
  })

  it.each(mailboxes)('%s can hold a /fixall claim', mailbox => {
    expect(FIXALL_CLAIM_MAILBOXES as readonly string[]).toContain(mailbox)
  })

  it.each(mailboxes)('%s resolves a webhook agent type from its address', mailbox => {
    expect(getAgentType(agentEmail(mailbox))).toBe(mailbox)
  })
})

describe('the /fixall harness selector covers the table (AWTD-937)', () => {
  it.each(mailboxes)('%s is reachable by some --harness selector', mailbox => {
    // Absent here, `--harness muse` matches no mailbox and the queue comes back
    // EMPTY rather than erroring — the loop then reports "nothing to do" forever.
    expect(Object.values(FIXALL_HARNESS_MAILBOXES)).toContain(mailbox)
  })
})

describe('the icon endpoint knows every harness agent (AWTD-937)', () => {
  it.each(mailboxes)('%s has an icon entry', async mailbox => {
    const { AGENT_ICONS } = await import('@/app/api/v1/agent-icon/[slug]/route')
    expect(Object.keys(AGENT_ICONS)).toContain(mailbox)
  })
})
