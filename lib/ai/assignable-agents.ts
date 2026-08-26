/**
 * Which agent identities a given user can actually be offered.
 *
 * Both user-search routes (/api/users/search and /api/v1/users/search) used to carry
 * their own copy of this: a hardcoded five-address list, plus a five-way
 * `hasValidApiKey` fan-out that pushed a hardcoded address per service. That meant
 * three things had to be edited in lockstep to add or remove an agent, and the enabled
 * set could not be configuration. Task 97208a72.
 */

import { hasValidApiKey } from '@/lib/api-key-cache'
import { agentEmail, LOCAL_HARNESS_AGENT_MAILBOXES } from '@/lib/brand/agent-emails'
import { ENABLED_AGENT_MAILBOXES, getAgentConfig } from '@/lib/ai/agent-config'
import { getAgentExecutionModes } from '@/lib/ai/agent-execution-mode'

/**
 * Every assignable agent address this deployment supports.
 *
 * Excludes the default assistant, which is surfaced through its own path rather than
 * through agent search. Per-user OpenClaw workers ({name}.oc@) are matched separately
 * by suffix, since their local parts are not known ahead of time.
 */
export function getAssignableAgentEmails(): string[] {
  return [
    ...ENABLED_AGENT_MAILBOXES
    .filter((mailbox) => mailbox !== 'astrid')
    .map((mailbox) => agentEmail(mailbox)),
    ...LOCAL_HARNESS_AGENT_MAILBOXES.map(agentEmail),
  ]
}

/**
 * The subset of the above the user holds a valid API key for.
 *
 * Key lookups run concurrently, matching the `Promise.all` fan-out this replaces.
 */
export async function getKeyedAgentEmails(userId: string): Promise<string[]> {
  const candidates = ENABLED_AGENT_MAILBOXES
    .filter((mailbox) => mailbox !== 'astrid')
    .map((mailbox) => ({ email: agentEmail(mailbox), service: getAgentConfig(agentEmail(mailbox))?.service }))

  const keyed = await Promise.all(
    candidates.map(async ({ email, service }) =>
      // Key off the agent's configured service, not its mailbox — they happen to
      // match for today's built-ins, but the registry is the authority.
      service && (await hasValidApiKey(userId, service)) ? email : null
    )
  )

  return [
    ...keyed.filter((email): email is string => email !== null),
    ...LOCAL_HARNESS_AGENT_MAILBOXES.map(agentEmail),
  ]
}

/**
 * The subset a user can actually hand work to: keyed agents PLUS every agent
 * whose resolved execution mode is `polling`.
 *
 * `getKeyedAgentEmails` was the whole answer when the server ran every agent —
 * no key, no runtime, nothing to offer. Polling mode broke that equivalence:
 * a keyless claude@ is a perfectly working agent whose runtime is the user's
 * own Claude Code loop, and hiding it from the assignee picker made the new
 * workflow's step two ("assign it a task") impossible. The picker should offer
 * what can WORK, not what the server can bill.
 */
export async function getOfferableAgentEmails(userId: string): Promise<string[]> {
  const [keyed, modes] = await Promise.all([
    getKeyedAgentEmails(userId),
    getAgentExecutionModes(userId),
  ])

  const polling = Object.entries(modes)
    .filter(([, mode]) => mode === 'polling')
    .map(([mailbox]) => agentEmail(mailbox))

  const offered = new Set([...keyed, ...polling])

  // Codex and OpenAI are ONE option in the product with two identities under
  // it, and the user's chosen mode picks which one is real: server-run work is
  // openai@ (it has the executor), harness work is codex@ (it has the queue).
  // Offering both would put two names for the same agent in every picker.
  if (modes.openai === 'polling') {
    offered.delete(agentEmail('openai'))
  } else {
    offered.delete(agentEmail('codex'))
  }

  return [...offered]
}
