/**
 * Which agents are alive on a board (AWTD-1697).
 *
 * The server records when each agent last asked a board's queue and last
 * renewed a claim there (services/agent-presence.service.ts). These are the
 * rules that turn those two timestamps into what the board shows and when the
 * owner is told. No I/O here.
 */

/**
 * How often an agent loop is expected to check in. The loops shipped in
 * lib/agent-skill/loop-recipes.ts run every 30 minutes; a heartbeat is more
 * frequent, so the queue check is the slower of the two signals.
 */
export const AGENT_EXPECTED_INTERVAL_SECONDS = 30 * 60

/** An agent is quiet once it has missed this many expected intervals. */
export const AGENT_MISSED_INTERVALS_BEFORE_QUIET = 2

/** A Ready task is flagged once it has waited this many intervals. */
export const READY_PICKUP_INTERVALS = 1

export type AgentPresenceState = 'active' | 'quiet'

export interface AgentPresenceTimes {
  lastQueueCheckAt: Date | null
  lastHeartbeatAt: Date | null
}

/** The most recent sign of life, from either signal. */
export function lastSeenAt(times: AgentPresenceTimes): Date | null {
  const stamps = [times.lastQueueCheckAt, times.lastHeartbeatAt].filter((d): d is Date => d !== null)
  if (stamps.length === 0) return null
  return new Date(Math.max(...stamps.map(d => d.getTime())))
}

/** Has this agent been silent for at least `missed` expected intervals? */
export function agentPresenceState(
  times: AgentPresenceTimes,
  now: Date,
  expectedIntervalSeconds = AGENT_EXPECTED_INTERVAL_SECONDS,
  missed = AGENT_MISSED_INTERVALS_BEFORE_QUIET,
): AgentPresenceState {
  const seen = lastSeenAt(times)
  if (!seen) return 'quiet'
  return now.getTime() - seen.getTime() >= expectedIntervalSeconds * missed * 1000 ? 'quiet' : 'active'
}

export type ReadyWaitReason = 'no_agent_enrolled' | 'agent_not_seen'

export interface ReadyWaitInput {
  /** Ready tasks nobody holds, oldest first, with when each entered the lane. */
  readySince: Date[]
  agents: Array<{ times: AgentPresenceTimes }>
}

export interface ReadyWaitFlag {
  /** How many unheld Ready tasks have waited past the pickup time. */
  count: number
  oldestSince: Date
  reason: ReadyWaitReason | null
}

/**
 * Flag Ready tasks that have waited longer than the pickup time. The reason is
 * given only when it is known: no agent has ever checked the board, or every
 * agent that did has gone quiet. With a live agent the wait has no known
 * cause, so no reason is named.
 */
export function readyWaitFlag(input: ReadyWaitInput, now: Date): ReadyWaitFlag | null {
  const limit = AGENT_EXPECTED_INTERVAL_SECONDS * READY_PICKUP_INTERVALS * 1000
  const waited = input.readySince.filter(since => now.getTime() - since.getTime() > limit)
  if (waited.length === 0) return null
  const oldestSince = new Date(Math.min(...waited.map(d => d.getTime())))
  let reason: ReadyWaitReason | null = null
  if (input.agents.length === 0) reason = 'no_agent_enrolled'
  else if (input.agents.every(agent => agentPresenceState(agent.times, now) === 'quiet')) reason = 'agent_not_seen'
  return { count: waited.length, oldestSince, reason }
}
