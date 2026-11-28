/**
 * ADEV-360 — "Reply, Reassign & Ready": one tap posts the reply and hands the task back to
 * whoever asked. The same rule as astrid-ios `ReplyHandBack.swift`.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  handBackTarget,
  handBackTitleKey,
  handedBackTask,
  replyThenHandBack,
  type HandBackTarget,
} from '@/lib/reply-hand-back'
import type { Comment, Task, User } from '@/types/task'

const me: User = { id: 'me', name: 'Jon', email: 'jon@example.com', createdAt: new Date() }
const agent: User = { id: 'agent', name: 'Claude', email: 'claude@example.com', createdAt: new Date(), isAIAgent: true }
const person: User = { id: 'pat', name: 'Pat', email: 'pat@example.com', createdAt: new Date() }

let seq = 0
function comment(author: User | null, at: string, extra: Partial<Comment> = {}): Comment {
  seq += 1
  return {
    id: `c${seq}`,
    content: 'x',
    type: 'TEXT',
    author,
    authorId: author?.id ?? null,
    taskId: 't1',
    createdAt: new Date(at),
    updatedAt: new Date(at),
    ...extra,
  }
}

function task(extra: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Question',
    assigneeId: 'me',
    assignee: me,
    completed: false,
    comments: [],
    ...extra,
  } as Task
}

describe('ADEV-360 hand-back target', () => {
  it('ADEV-360: the asker is the newest comment author other than me', () => {
    const t = task({
      comments: [
        comment(person, '2026-11-01T10:00:00Z'),
        comment(agent, '2026-11-02T10:00:00Z'),
        comment(me, '2026-11-03T10:00:00Z'),
        comment(null, '2026-11-04T10:00:00Z'), // system line
      ],
    })
    expect(handBackTarget(t, 'me')).toEqual({ userId: 'agent', name: 'Claude', isAgent: true, statusRole: 'ready' })
  })

  it('ADEV-360: orders by time, not array position, and reads string timestamps', () => {
    const newer = { ...comment(person, '2026-11-05T10:00:00Z'), createdAt: '2026-11-05T10:00:00Z' as unknown as Date }
    const t = task({ comments: [newer, comment(agent, '2026-11-01T10:00:00Z')] })
    expect(handBackTarget(t, 'me')?.userId).toBe('pat')
  })

  it('ADEV-360: a person keeps the column (no statusRole)', () => {
    const t = task({ comments: [comment(person, '2026-11-01T10:00:00Z')] })
    expect(handBackTarget(t, 'me')).toEqual({ userId: 'pat', name: 'Pat', isAgent: false, statusRole: null })
  })

  it('ADEV-360: falls back to email, then id, for the name', () => {
    const noName = { ...person, name: null }
    expect(handBackTarget(task({ comments: [comment(noName, '2026-11-01T10:00:00Z')] }), 'me')?.name).toBe('pat@example.com')
    const bare = comment(null, '2026-11-01T10:00:00Z', { authorId: 'ghost' })
    expect(handBackTarget(task({ comments: [bare] }), 'me')?.name).toBe('ghost')
  })

  it('ADEV-360: counts replies nested under a comment', () => {
    const parent = comment(person, '2026-11-01T10:00:00Z', { replies: [comment(agent, '2026-11-02T10:00:00Z')] })
    expect(handBackTarget(task({ comments: [parent] }), 'me')?.userId).toBe('agent')
  })

  it('ADEV-360: nothing to offer when the task is not mine, is done, or nobody else spoke', () => {
    const asked = [comment(agent, '2026-11-01T10:00:00Z')]
    expect(handBackTarget(task({ comments: asked, assigneeId: 'pat' }), 'me')).toBeNull()
    expect(handBackTarget(task({ comments: asked, assigneeId: null }), 'me')).toBeNull()
    expect(handBackTarget(task({ comments: asked, completed: true }), 'me')).toBeNull()
    expect(handBackTarget(task({ comments: asked }), undefined)).toBeNull()
    expect(handBackTarget(task({ comments: [comment(me, '2026-11-01T10:00:00Z'), comment(null, '2026-11-02T10:00:00Z')] }), 'me')).toBeNull()
    expect(handBackTarget(task({ comments: undefined }), 'me')).toBeNull()
  })
})

describe('ADEV-360 button title', () => {
  const agentTarget: HandBackTarget = { userId: 'a', name: 'A', isAgent: true, statusRole: 'ready' }
  const personTarget: HandBackTarget = { userId: 'p', name: 'P', isAgent: false, statusRole: null }
  it('ADEV-360: says what a tap does', () => {
    expect(handBackTitleKey(agentTarget, true)).toBe('tasks.commentsSection.handBack.replyReassignReady')
    expect(handBackTitleKey(agentTarget, false)).toBe('tasks.commentsSection.handBack.reassignReady')
    expect(handBackTitleKey(personTarget, true)).toBe('tasks.commentsSection.handBack.replyReassign')
    expect(handBackTitleKey(personTarget, false)).toBe('tasks.commentsSection.handBack.reassign')
  })
})

describe('ADEV-360 handed-back task', () => {
  it('ADEV-360: an agent gets the task in Ready, through the assignee object the PUT body reads', () => {
    const asker = comment(agent, '2026-11-01T10:00:00Z')
    const t = task({ comments: [asker], statusRole: 'doing' })
    const next = handedBackTask(t, handBackTarget(t, 'me')!)
    expect(next.assigneeId).toBe('agent')
    expect(next.assignee?.id).toBe('agent')
    expect(next.assignee?.isAIAgent).toBe(true)
    expect(next.statusRole).toBe('ready')
  })

  it('ADEV-360: a person gets it in whatever column it is in', () => {
    const t = task({ comments: [comment(person, '2026-11-01T10:00:00Z')], statusRole: 'waiting' })
    const next = handedBackTask(t, handBackTarget(t, 'me')!)
    expect(next.assigneeId).toBe('pat')
    expect(next.statusRole).toBe('waiting')
  })

  it('ADEV-360: keeps comments posted since the task was read', () => {
    const t = task({ comments: [comment(agent, '2026-11-01T10:00:00Z')] })
    const reply = comment(me, '2026-11-02T10:00:00Z')
    const next = handedBackTask(t, handBackTarget(t, 'me')!, [reply])
    expect(next.comments?.map(c => c.id)).toEqual([...t.comments!.map(c => c.id), reply.id])
  })
})

describe('ADEV-360 reply then hand back', () => {
  const target: HandBackTarget = { userId: 'a', name: 'A', isAgent: true, statusRole: 'ready' }

  it('ADEV-360: posts the reply before handing back', async () => {
    const order: string[] = []
    const ok = await replyThenHandBack(target, async () => { order.push('reply'); return true }, async () => { order.push('handBack') })
    expect(ok).toBe(true)
    expect(order).toEqual(['reply', 'handBack'])
  })

  it('ADEV-360: a failed reply does not hand the task back', async () => {
    const handBack = vi.fn()
    expect(await replyThenHandBack(target, async () => false, handBack)).toBe(false)
    expect(handBack).not.toHaveBeenCalled()
  })

  it('ADEV-360: nothing typed is a plain hand-back', async () => {
    const handBack = vi.fn(async () => {})
    expect(await replyThenHandBack(target, null, handBack)).toBe(true)
    expect(handBack).toHaveBeenCalledWith(target)
  })
})
