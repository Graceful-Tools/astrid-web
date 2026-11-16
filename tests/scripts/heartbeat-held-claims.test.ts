/**
 * ADEV-37: a cloud run renews the claim leases it holds, and only those.
 *
 * On 2026-11-16 ADEV-22 went back to Ready three times mid-run: MCP claim_task
 * holds a 15-minute lease and nothing in a cloud run renewed it. The runner now
 * renews every Doing task held by its agent whose lease was taken or renewed
 * since the run started. A claim older than the run (a dead session) is left to
 * expire, or one stray lease would live forever under continuous runs.
 */
import { describe, expect, it } from 'vitest'
import { claimsToRenew } from '../../scripts/lib/held-claims'

const runStartedAt = new Date('2026-11-16T16:00:00Z')
const now = new Date('2026-11-16T16:20:00Z')
const base = { statusRole: 'doing', claimHolderId: 'ai-agent-claude', claimLeaseExpiresAt: '2026-11-16T16:25:00Z' }

describe('claimsToRenew (ADEV-37)', () => {
  it('renews a lease this run took', () => {
    const tasks = [{ id: 'a', ...base, claimHeartbeatAt: '2026-11-16T16:10:00Z' }]
    expect(claimsToRenew(tasks, { agentId: 'ai-agent-claude', runStartedAt, now })).toEqual(['a'])
  })
  it('leaves a claim older than the run alone (a dead session)', () => {
    const tasks = [{ id: 'b', ...base, claimHeartbeatAt: '2026-11-16T15:50:00Z' }]
    expect(claimsToRenew(tasks, { agentId: 'ai-agent-claude', runStartedAt, now })).toEqual([])
  })
  it('leaves another holder, a non-Doing task, a lease-less claim and an expired lease alone', () => {
    const tasks = [
      { id: 'c', ...base, claimHolderId: 'ai-agent-codex', claimHeartbeatAt: '2026-11-16T16:10:00Z' },
      { id: 'd', ...base, statusRole: 'ready', claimHeartbeatAt: '2026-11-16T16:10:00Z' },
      { id: 'e', ...base, claimLeaseExpiresAt: null, claimHeartbeatAt: '2026-11-16T16:10:00Z' },
      { id: 'f', ...base, claimLeaseExpiresAt: '2026-11-16T16:19:00Z', claimHeartbeatAt: '2026-11-16T16:04:00Z' },
    ]
    expect(claimsToRenew(tasks, { agentId: 'ai-agent-claude', runStartedAt, now })).toEqual([])
  })
})

describe('agent-run.yml keeps the leases alive (ADEV-37)', () => {
  it('both harness steps run the heartbeat loop in the background and stop it on exit', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('.github/workflows/agent-run.yml', 'utf8')
    expect(src.match(/scripts\/heartbeat-held-claims\.ts/g)?.length).toBe(2)
    expect(src.match(/trap 'kill "\$\{HEARTBEAT\}"/g)?.length).toBe(2)
    expect(src).toContain('ASTRID_RUN_STARTED_AT')
  })
})
