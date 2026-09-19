/**
 * A completion report is not an unanswered question (AWTD-969).
 *
 * The attention inbox shipped in AWTD-963 and its FIRST production read came
 * back with 61 tasks, `truncated: true`, and — audited against each task's
 * `completedAt` — zero that were genuinely unanswered:
 *
 *   open tasks ........................................  2
 *   completed, comment AFTER completion (real) ........  0
 *   completed, comment AT/BEFORE completion (noise) ... 59
 *
 * The 59 were the loop's own completion reports. They are attributed to
 * jonparis@gmail.com because the OAuth client the loop writes through is owned
 * by Jon (AWTD-970 is the attribution defect itself), so `awaitsAgentReply`
 * saw "a human wrote the newest comment" on every task the loop had ever
 * finished.
 *
 * The AWTD-963 simplification — "if the newest comment is a human's, it is by
 * definition newer than any of the agent's" — holds only when agent comments
 * are attributed to the agent. On historical data it is false, and it turns
 * the entire completed backlog into an inbox.
 *
 * THE RULE IS ABOUT TIME, NOT TEXT. A comment written at or before completion
 * is the record of the work; one written after it is somebody reacting to
 * finished work, which is the case the inbox exists for. Matching on wording
 * instead ("Done —", a 📅 prefix) would paper over the attribution defect and
 * break the first time the wording changed.
 */

import { describe, it, expect } from 'vitest'
import { awaitsAgentReply } from '@/lib/ready-queue-scope'

const JON = { id: 'user-1', isAIAgent: false }
const AGENT = { id: 'ai-agent-claude', isAIAgent: true }

const COMPLETED_AT = new Date('2026-09-14T12:00:00Z')

const comment = (over: Record<string, unknown> = {}) => ({
  createdAt: COMPLETED_AT,
  updatedAt: COMPLETED_AT,
  authorId: JON.id,
  author: JON,
  ...over,
})

describe('awaitsAgentReply on a COMPLETED task (AWTD-969)', () => {
  it('ignores the completion report written at the moment of completion', () => {
    // The exact shape of all 59: attributed to Jon, timestamped at completion.
    expect(
      awaitsAgentReply({ comment: comment(), completedAt: COMPLETED_AT }),
    ).toBe(false)
  })

  it('ignores everything said before the task was finished', () => {
    expect(
      awaitsAgentReply({
        comment: comment({ createdAt: new Date('2026-09-14T09:00:00Z') }),
        completedAt: COMPLETED_AT,
      }),
    ).toBe(false)
  })

  it('STILL surfaces a question asked after completion — the case this exists for', () => {
    expect(
      awaitsAgentReply({
        comment: comment({ createdAt: new Date('2026-09-15T09:00:00Z') }),
        completedAt: COMPLETED_AT,
      }),
    ).toBe(true)
  })

  it('uses the later of createdAt/updatedAt, so an EDITED comment still counts', () => {
    // Editing a comment is how a question gets revised. Judging on createdAt
    // alone would let the edit slip under the completion timestamp.
    expect(
      awaitsAgentReply({
        comment: comment({
          createdAt: new Date('2026-09-14T09:00:00Z'),
          updatedAt: new Date('2026-09-15T09:00:00Z'),
        }),
        completedAt: COMPLETED_AT,
      }),
    ).toBe(true)
  })

  it('falls back to surfacing when a completed task has no completedAt recorded', () => {
    // Data predating the stamp. Surfacing a few extra is recoverable; going
    // silent on a real question is not.
    expect(awaitsAgentReply({ comment: comment(), completedAt: null })).toBe(true)
  })
})

describe('awaitsAgentReply on an OPEN task is unchanged (AWTD-969)', () => {
  it('surfaces a human comment', () => {
    expect(awaitsAgentReply({ comment: comment(), completedAt: null })).toBe(true)
  })

  it('still ignores the agent own comment', () => {
    expect(
      awaitsAgentReply({ comment: comment({ authorId: AGENT.id, author: AGENT }), completedAt: null }),
    ).toBe(false)
  })

  it('still ignores a system event, which is nobody question', () => {
    expect(
      awaitsAgentReply({ comment: comment({ authorId: null, author: null }), completedAt: null }),
    ).toBe(false)
  })

  it('treats an absent comment as nothing to answer', () => {
    expect(awaitsAgentReply({ comment: null, completedAt: null })).toBe(false)
  })
})
