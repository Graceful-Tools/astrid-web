import { describe, expect, it } from 'vitest'
import { pendingAgentHandback } from '@/lib/agent-handback'

const question = {
  id: 'question', authorId: 'agent', author: { isAIAgent: true },
  content: 'Which behaviour?\nAGENT-HANDBACK: claude',
  createdAt: new Date('2026-10-25T10:00:00Z'), updatedAt: new Date('2026-10-25T10:00:00Z'),
}
const reply = {
  id: 'reply', authorId: 'human', author: { isAIAgent: false }, content: 'Use the existing behaviour.',
  createdAt: new Date('2026-10-25T11:00:00Z'), updatedAt: new Date('2026-10-25T11:00:00Z'),
}
const task = {
  completed: false, statusRole: 'waiting', assigneeId: 'human',
  assignee: { isAIAgent: false }, lists: [{ id: 'board' }], comments: [reply, question],
}
const pending = (over: Partial<typeof task> = {}) =>
  pendingAgentHandback({ task: { ...task, ...over }, agentId: 'agent', mailbox: 'claude', listId: 'board' })

describe('Astrid lifecycle reply routing', () => {
  it('routes the human assignee reply to the agent that asked without reassignment', () => {
    expect(pending()).toEqual({
      listId: 'board', assigneeId: 'human', handbackCommentId: 'question',
      replyCommentId: 'reply', commentWatermark: reply.updatedAt.toISOString(),
    })
  })

  it('refuses spoofed, other-harness, superseded and unrelated handbacks', () => {
    expect(pending({ comments: [reply, { ...question, authorId: 'other-agent' }] })).toBeNull()
    expect(pending({ comments: [reply, { ...question, content: 'AGENT-HANDBACK: codex' }] })).toBeNull()
    expect(pending({ comments: [reply, { ...question, content: 'quoted AGENT-HANDBACK: claude' }] })).toBeNull()
    expect(pending({ comments: [{ ...reply, authorId: 'bystander' }, question] })).toBeNull()
    expect(pending({ comments: [question] })).toBeNull()
    expect(pending({ comments: [reply] })).toBeNull()
    expect(pending({ comments: [reply, { ...question, id: 'answered', content: 'Already answered',
      createdAt: new Date('2026-10-25T10:30:00Z') }, question] })).toBeNull()
  })

  it('never widens task state or board scope', () => {
    expect(pending({ completed: true })).toBeNull()
    expect(pending({ statusRole: 'doing' })).toBeNull()
    expect(pending({ assignee: { isAIAgent: true } })).toBeNull()
    expect(pending({ lists: [{ id: 'other-board' }] })).toBeNull()
  })
})
