import { describe, expect, it } from 'vitest'
import {
  AGENT_EXPECTED_INTERVAL_SECONDS,
  agentPresenceState,
  lastSeenAt,
  readyWaitFlag,
} from '@/lib/agent-presence'

const now = new Date('2026-11-16T12:00:00.000Z')
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000)
const none = { lastQueueCheckAt: null, lastHeartbeatAt: null }

describe('agent presence rules (AWTD-1697)', () => {
  it('takes the more recent of the two signals as last seen', () => {
    expect(lastSeenAt({ lastQueueCheckAt: ago(50), lastHeartbeatAt: ago(5) })).toEqual(ago(5))
    expect(lastSeenAt(none)).toBeNull()
  })

  it('is active until two expected intervals have passed, then quiet', () => {
    const limit = (AGENT_EXPECTED_INTERVAL_SECONDS * 2) / 60
    expect(agentPresenceState({ ...none, lastQueueCheckAt: ago(limit - 1) }, now)).toBe('active')
    expect(agentPresenceState({ ...none, lastQueueCheckAt: ago(limit) }, now)).toBe('quiet')
  })

  it('stays active when a fresh heartbeat covers a stale queue check', () => {
    expect(agentPresenceState({ lastQueueCheckAt: ago(300), lastHeartbeatAt: ago(2) }, now)).toBe('active')
  })

  it('flags Ready work past the pickup time with the reason when known', () => {
    expect(readyWaitFlag({ readySince: [ago(5)], agents: [] }, now)).toBeNull()
    expect(readyWaitFlag({ readySince: [ago(45), ago(90)], agents: [] }, now)).toMatchObject({
      count: 2,
      oldestSince: ago(90),
      reason: 'no_agent_enrolled',
    })
    expect(readyWaitFlag({
      readySince: [ago(45)],
      agents: [{ times: { ...none, lastQueueCheckAt: ago(600) } }],
    }, now)?.reason).toBe('agent_not_seen')
    expect(readyWaitFlag({
      readySince: [ago(45)],
      agents: [{ times: { ...none, lastQueueCheckAt: ago(3) } }],
    }, now)?.reason).toBeNull()
  })
})
