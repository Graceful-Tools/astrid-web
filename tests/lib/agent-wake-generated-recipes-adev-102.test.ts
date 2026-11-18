/**
 * ADEV-102 — an event wake never reached a generated workflow.
 *
 * lib/agent-wake.ts sends `repository_dispatch` (type astrid-wake) with
 * `client_payload.mailbox` to the board's repository, but the generated
 * workflows listened only to schedule + workflow_dispatch, so a third-party
 * board waited for the 30-minute cron (which GitHub often skips). Each
 * generated workflow now also wakes on astrid-wake, and its gate runs only for
 * a wake addressed to its own mailbox or to `any`: one repository can hold a
 * Claude and a Copilot workflow, and a Copilot wake must not start Claude.
 *
 * agent-run.yml is the owner's Claude cloud worker, so it keeps ignoring the
 * copilot mailbox: routing Copilot's wake there would make Claude do its work.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  actionsClaudeCodeWorkflow,
  actionsCopilotWorkflow,
  actionsQueueGateWorkflow,
} from '@/lib/agent-skill/loop-recipes'
import { ANY_AGENT_MAILBOX, WAKE_EVENT_TYPE } from '@/lib/agent-wake'

const { load } = require('js-yaml') as { load(source: string): unknown }

type Doc = { on: Record<string, unknown>; jobs: Record<string, { if?: string; needs?: string }> }

const ORIGIN = 'https://example.test'
const WORKFLOWS = {
  'queue gate': { mailbox: 'codex', make: actionsQueueGateWorkflow, agentJob: 'run-your-agent' },
  'Claude Code workflow': { mailbox: 'claude', make: actionsClaudeCodeWorkflow, agentJob: 'claude' },
  'Copilot workflow': { mailbox: 'copilot', make: actionsCopilotWorkflow, agentJob: 'copilot' },
}

/**
 * Evaluate the gate job's `if` the way GitHub would for one event. The
 * expression is always `<event check> || contains(fromJSON('<json>'), <mailbox>)`.
 */
function gateRuns(condition: string, event: string, mailbox?: string): boolean {
  const match = /^\$\{\{ github\.event_name != 'repository_dispatch' \|\| contains\(fromJSON\('(\[[^\]]*\])'\), github\.event\.client_payload\.mailbox\) \}\}$/
    .exec(condition.trim())
  if (!match) throw new Error(`Unexpected gate condition: ${condition}`)
  return event !== 'repository_dispatch' || (JSON.parse(match[1]) as string[]).includes(mailbox ?? '')
}

describe('generated workflows wake on astrid-wake (ADEV-102)', () => {
  for (const [label, { mailbox, make, agentJob }] of Object.entries(WORKFLOWS)) {
    const doc = load(make({ mailbox, origin: ORIGIN, listId: 'l1' }).content) as Doc

    it(`ADEV-102: the ${label} listens for the dispatch lib/agent-wake.ts sends`, () => {
      expect(doc.on.repository_dispatch).toEqual({ types: [WAKE_EVENT_TYPE] })
      expect(doc.on).toHaveProperty('schedule')
      expect(doc.on).toHaveProperty('workflow_dispatch')
    })

    it(`ADEV-102: the ${label} wakes only for its own mailbox or ${ANY_AGENT_MAILBOX}`, () => {
      const condition = doc.jobs['queue-gate'].if!
      expect(gateRuns(condition, 'repository_dispatch', mailbox)).toBe(true)
      expect(gateRuns(condition, 'repository_dispatch', ANY_AGENT_MAILBOX)).toBe(true)
      expect(gateRuns(condition, 'repository_dispatch', mailbox === 'copilot' ? 'claude' : 'copilot')).toBe(false)
      expect(gateRuns(condition, 'repository_dispatch', undefined)).toBe(false)
      expect(gateRuns(condition, 'schedule')).toBe(true)
      expect(gateRuns(condition, 'workflow_dispatch')).toBe(true)
      // A skipped gate skips the agent job, so a wrong-mailbox wake costs no agent session.
      expect(doc.jobs[agentJob].needs).toBe('queue-gate')
    })
  }

  it('ADEV-102: agent-run.yml (the Claude worker) still ignores the copilot mailbox', () => {
    const source = readFileSync('.github/workflows/agent-run.yml', 'utf8')
    expect(source).toContain(`contains(fromJSON('["claude","any"]'), github.event.client_payload.mailbox)`)
    expect(source).not.toMatch(/fromJSON\('\[[^\]]*"copilot"/)
  })
})
