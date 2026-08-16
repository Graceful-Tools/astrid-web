/**
 * Which Ready tasks an autonomous loop may take.
 *
 * The rule is one line, but it decides whether the loop rewrites work a person
 * is already doing — so the edges are worth pinning, particularly the ones
 * where the data is incomplete and "assume it is free" would be the expensive
 * guess.
 */

import { describe, it, expect } from 'vitest'
import {
  describeAssignee,
  FIXALL_HARNESS_MAILBOXES,
  isClaimableByAgent,
  resolveReadyQueueOptions,
} from '@/lib/ready-queue-scope'
import { agentEmail } from '@/lib/brand/agent-emails'

describe('isClaimableByAgent', () => {
  // Jon, 2026-08-15: "only chose tasks assigned to Claude".
  //
  // Unassigned USED to qualify, on the reasoning that nobody had claimed it. That
  // reading made Ready mean "actionable and unclaimed", so anything Jon dropped into
  // Ready to think about was fair game for a loop that would start work on it within
  // fifteen minutes. Assignment is now the handshake: a task is the loop's only when
  // someone hands it over.
  it('leaves an UNASSIGNED task alone — assignment is the handshake', () => {
    expect(isClaimableByAgent({ assigneeId: null }, 'claude-code')).toBe(false)
    expect(isClaimableByAgent({}, 'claude-code')).toBe(false)
    expect(isClaimableByAgent({ assigneeId: '' }, 'claude-code')).toBe(false)
  })

  it('takes a task assigned to the agent itself', () => {
    expect(isClaimableByAgent({
      assigneeId: 'agent-1',
      assignee: { email: 'claude@astrid.cc', name: 'Claude Agent' },
    }, 'claude-code')).toBe(true)
  })

  it('leaves a task assigned to a person alone', () => {
    expect(isClaimableByAgent({
      assigneeId: 'user-1',
      assignee: { email: 'jonparis@gmail.com', name: 'Jon' },
    }, 'claude-code')).toBe(false)
  })

  it('regression for cross-harness fixall routing: each harness takes only its exact identity', () => {
    for (const [harness, mailbox] of Object.entries(FIXALL_HARNESS_MAILBOXES)) {
      expect(isClaimableByAgent({
        assigneeId: `${mailbox}-agent`,
        assignee: { email: agentEmail(mailbox) },
      }, harness)).toBe(true)

      for (const otherMailbox of Object.values(FIXALL_HARNESS_MAILBOXES)) {
        if (otherMailbox === mailbox) continue
        expect(isClaimableByAgent({
          assigneeId: `${otherMailbox}-agent`,
          assignee: { email: agentEmail(otherMailbox) },
        }, harness)).toBe(false)
      }
    }
  })

  it('does not accept the right mailbox on the wrong domain', () => {
    expect(isClaimableByAgent({
      assigneeId: 'agent-1',
      assignee: { email: 'claude@acme.example' },
    }, 'claude-code')).toBe(false)
  })

  it('is case-insensitive about the address', () => {
    expect(isClaimableByAgent({
      assigneeId: 'agent-1',
      assignee: { email: 'Claude@Astrid.CC' },
    }, 'claude-code')).toBe(true)
  })

  it('skips an assigned task whose assignee could not be resolved', () => {
    // The conservative direction. A task IS claimed; we just cannot see by
    // whom, because the serialisation omitted the relation. Taking it on the
    // assumption it is free is the guess that duplicates someone's work.
    expect(isClaimableByAgent({ assigneeId: 'user-1' }, 'claude-code')).toBe(false)
    expect(isClaimableByAgent({ assigneeId: 'user-1', assignee: null }, 'claude-code')).toBe(false)
    expect(isClaimableByAgent({ assigneeId: 'user-1', assignee: { email: null } }, 'claude-code')).toBe(false)
    expect(isClaimableByAgent({ assigneeId: 'user-1', assignee: { name: 'Jon' } }, 'claude-code')).toBe(false)
  })
})

describe('resolveReadyQueueOptions', () => {
  it('requires an explicit harness selector and fails closed on unknown identities', () => {
    expect(() => resolveReadyQueueOptions([], {})).toThrow(/ASTRID_FIXALL_HARNESS/)
    expect(() => resolveReadyQueueOptions(['--harness', 'openai'], {})).toThrow(/Unknown harness/)
    expect(() => isClaimableByAgent({
      assigneeId: 'agent-1',
      assignee: { email: 'openai@astrid.cc' },
    }, 'openai')).toThrow(/Unknown harness/)
  })

  it('accepts the CLI forms, defaults only the board, and lets CLI override the environment', () => {
    expect(resolveReadyQueueOptions(
      ['--harness', 'github-copilot'],
      { ASTRID_FIXALL_HARNESS: 'claude-code' },
    )).toEqual({ board: 'web', harness: 'github-copilot' })

    expect(resolveReadyQueueOptions(
      ['ios', '--harness=codex'],
      {},
    )).toEqual({ board: 'ios', harness: 'codex' })
  })

  it('uses ASTRID_FIXALL_HARNESS when the CLI selector is absent', () => {
    expect(resolveReadyQueueOptions(
      ['ios'],
      { ASTRID_FIXALL_HARNESS: 'astrid-server' },
    )).toEqual({ board: 'ios', harness: 'astrid-server' })
  })

  it('rejects unknown boards and extra positional arguments rather than widening scope', () => {
    expect(() => resolveReadyQueueOptions(
      ['android', '--harness', 'claude-code'],
      {},
    )).toThrow(/Unknown board/)
    expect(() => resolveReadyQueueOptions(
      ['web', 'ios', '--harness', 'claude-code'],
      {},
    )).toThrow(/Unexpected argument/)
  })
})

describe('describeAssignee', () => {
  it('prefers a name, falls back to email, then to the raw id', () => {
    expect(describeAssignee({ assigneeId: 'u1', assignee: { name: 'Jon', email: 'j@x.com' } })).toBe('Jon')
    expect(describeAssignee({ assigneeId: 'u1', assignee: { email: 'j@x.com' } })).toBe('j@x.com')
    expect(describeAssignee({ assigneeId: 'u1' })).toBe('u1')
  })

  it('never returns an empty string, so the skip line always says something', () => {
    expect(describeAssignee({})).not.toBe('')
    expect(describeAssignee({ assigneeId: 'u1' })).not.toBe('')
  })

  // Unassigned is now the COMMON skip rather than an edge case, so it has to read as a
  // normal state. "unknown" sent a reader looking for a data bug that was not there.
  it('says unassigned rather than unknown when nobody has it', () => {
    expect(describeAssignee({})).toBe('unassigned')
    expect(describeAssignee({ assigneeId: null })).toBe('unassigned')
  })
})
