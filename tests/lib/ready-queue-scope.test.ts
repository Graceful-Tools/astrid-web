/**
 * Which Ready tasks an autonomous loop may take.
 *
 * The rule is one line, but it decides whether the loop rewrites work a person
 * is already doing — so the edges are worth pinning, particularly the ones
 * where the data is incomplete and "assume it is free" would be the expensive
 * guess.
 */

import { describe, it, expect } from 'vitest'
import { isClaimableByAgent, describeAssignee } from '@/lib/ready-queue-scope'

describe('isClaimableByAgent', () => {
  // Jon, 2026-08-15: "only chose tasks assigned to Claude".
  //
  // Unassigned USED to qualify, on the reasoning that nobody had claimed it. That
  // reading made Ready mean "actionable and unclaimed", so anything Jon dropped into
  // Ready to think about was fair game for a loop that would start work on it within
  // fifteen minutes. Assignment is now the handshake: a task is the loop's only when
  // someone hands it over.
  it('leaves an UNASSIGNED task alone — assignment is the handshake', () => {
    expect(isClaimableByAgent({ assigneeId: null })).toBe(false)
    expect(isClaimableByAgent({})).toBe(false)
    expect(isClaimableByAgent({ assigneeId: '' })).toBe(false)
  })

  it('takes a task assigned to the agent itself', () => {
    expect(isClaimableByAgent({
      assigneeId: 'agent-1',
      assignee: { email: 'claude@astrid.cc', name: 'Claude Agent' },
    })).toBe(true)
  })

  it('leaves a task assigned to a person alone', () => {
    expect(isClaimableByAgent({
      assigneeId: 'user-1',
      assignee: { email: 'jonparis@gmail.com', name: 'Jon' },
    })).toBe(false)
  })

  it('leaves a task assigned to a DIFFERENT agent alone', () => {
    // Several agent identities share the domain; the mailbox is what
    // distinguishes them, and openclaw's work is not this loop's.
    expect(isClaimableByAgent({
      assigneeId: 'agent-2',
      assignee: { email: 'openclaw@astrid.cc' },
    })).toBe(false)
  })

  it('matches the agent on any brand domain, not just astrid.cc', () => {
    // A fork keeps the mailbox and changes the domain.
    expect(isClaimableByAgent({
      assigneeId: 'agent-1',
      assignee: { email: 'claude@acme.example' },
    })).toBe(true)
  })

  it('is case-insensitive about the address', () => {
    expect(isClaimableByAgent({
      assigneeId: 'agent-1',
      assignee: { email: 'Claude@Astrid.CC' },
    })).toBe(true)
  })

  it('skips an assigned task whose assignee could not be resolved', () => {
    // The conservative direction. A task IS claimed; we just cannot see by
    // whom, because the serialisation omitted the relation. Taking it on the
    // assumption it is free is the guess that duplicates someone's work.
    expect(isClaimableByAgent({ assigneeId: 'user-1' })).toBe(false)
    expect(isClaimableByAgent({ assigneeId: 'user-1', assignee: null })).toBe(false)
    expect(isClaimableByAgent({ assigneeId: 'user-1', assignee: { email: null } })).toBe(false)
    expect(isClaimableByAgent({ assigneeId: 'user-1', assignee: { name: 'Jon' } })).toBe(false)
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
