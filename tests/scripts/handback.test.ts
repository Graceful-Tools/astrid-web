/**
 * R4 (Jon, 2026-11-12): "If it is waiting on a user to act on the specific task move it
 * to the inbox." A handback is astrid-core's `handBack` shape — no status, assigned to the
 * person — written in one PUT, and the reply-resume detection keys on exactly that.
 */
import { describe, expect, it } from 'vitest'
import { handbackWrite } from '@/scripts/lib/handback'
import { pendingAgentHandback } from '@/lib/agent-handback'

describe('handbackWrite', () => {
  it('is the Inbox, assigned to the person — never Waiting', () => {
    expect(handbackWrite('jon')).toEqual({ statusRole: null, assigneeId: 'jon' })
  })

  it('needs a person', () => {
    expect(() => handbackWrite(' ')).toThrow(/person/)
  })

  it('lands where the reply-resume detection looks for it', () => {
    const at = (iso: string) => new Date(iso)
    const task = {
      ...handbackWrite('jon'), completed: false, assignee: { isAIAgent: false }, lists: [{ id: 'board' }],
      comments: [
        { id: 'r', authorId: 'jon', author: { isAIAgent: false }, content: '1 — ship it',
          createdAt: at('2026-11-12T11:00:00Z'), updatedAt: at('2026-11-12T11:00:00Z') },
        { id: 'q', authorId: 'agent', author: { isAIAgent: true }, content: '**Decision:** ?\nAGENT-HANDBACK: claude',
          createdAt: at('2026-11-12T10:00:00Z'), updatedAt: at('2026-11-12T10:00:00Z') },
      ],
    }
    expect(pendingAgentHandback({ task, agentId: 'agent', mailbox: 'claude', listId: 'board' }))
      .toMatchObject({ assigneeId: 'jon', handbackCommentId: 'q', replyCommentId: 'r' })
  })
})
