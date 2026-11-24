import { describe, expect, it } from 'vitest'
import { pendingAgentAnswer, pendingAgentHandback } from '@/lib/agent-handback'
import { awaitsAgentReply } from '@/lib/ready-queue-scope'

const question = {
  id: 'question', authorId: 'agent', author: { isAIAgent: true },
  content: 'Which behaviour?\nAGENT-HANDBACK: claude',
  createdAt: new Date('2026-10-25T10:00:00Z'), updatedAt: new Date('2026-10-25T10:00:00Z'),
}
const reply = {
  id: 'reply', authorId: 'human', author: { isAIAgent: false }, content: 'Use the existing behaviour.',
  createdAt: new Date('2026-10-25T11:00:00Z'), updatedAt: new Date('2026-10-25T11:00:00Z'),
}
// R4: a handback is the Inbox (no status), assigned to the person — never Waiting.
const task: { completed: boolean; statusRole: string | null; assigneeId: string; assignee: { isAIAgent: boolean };
  lists: Array<{ id: string }>; comments: Array<typeof question> } = {
  completed: false, statusRole: null, assigneeId: 'human',
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
    // A handback parked in Waiting predates R4; Waiting holds only date/task waits.
    expect(pending({ statusRole: 'waiting' })).toBeNull()
    expect(pending({ assignee: { isAIAgent: true } })).toBeNull()
    expect(pending({ lists: [{ id: 'other-board' }] })).toBeNull()
  })
})

describe('AWTD-1695: one agent asking another', () => {
  const answer = {
    id: 'answer', authorId: 'other-agent', author: { isAIAgent: true }, content: 'It reads /api/v1.',
    createdAt: new Date('2026-10-25T11:00:00Z'), updatedAt: new Date('2026-10-25T11:00:00Z'),
  }
  const answered = (comments: Array<typeof question>) => pendingAgentAnswer({ comments, agentId: 'agent', mailbox: 'claude' })

  it('AWTD-1695: a recorded question from another agent awaits the reader; a remark, or the reader\'s own, does not', () => {
    expect(awaitsAgentReply({ comment: question, readerId: 'other-agent' })).toBe(true)
    expect(awaitsAgentReply({ comment: question, readerId: 'agent' })).toBe(false)
    expect(awaitsAgentReply({ comment: { ...question, content: 'FYI, done.' }, readerId: 'other-agent' })).toBe(false)
  })

  it('AWTD-1695: without a reader, an agent comment is nobody\'s question (the human path is unchanged)', () => {
    expect(awaitsAgentReply({ comment: question })).toBe(false)
    expect(awaitsAgentReply({ comment: reply })).toBe(true)
  })

  it('AWTD-1695: another agent answering the question is the asker\'s attention, once', () => {
    expect(answered([answer, question])).toEqual({ questionCommentId: 'question', answerCommentId: 'answer' })
    // The asker writing again closes it.
    expect(answered([{ ...question, id: 'next', content: 'Thanks', createdAt: new Date('2026-10-25T12:00:00Z'),
      updatedAt: new Date('2026-10-25T12:00:00Z') }, answer, question])).toBeNull()
  })

  it('AWTD-1695: a person\'s reply, an unasked question, or another mailbox is not an agent answer', () => {
    expect(answered([reply, question])).toBeNull()
    expect(answered([answer, { ...question, content: 'Just a note.' }])).toBeNull()
    expect(answered([answer, { ...question, content: 'Q?\nAGENT-HANDBACK: codex' }])).toBeNull()
    expect(answered([question])).toBeNull()
  })
})
