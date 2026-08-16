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
