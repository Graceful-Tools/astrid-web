import { describe, it, expect } from 'vitest'
import { enrichTaskForAgent } from '@/lib/agent-protocol'

function makeTask(overrides: any = {}) {
  return {
    id: 'task-1',
    title: 'Test Task',
    description: 'Do the thing',
    priority: 2,
    completed: false,
    dueDateTime: new Date('2026-03-01T12:00:00Z'),
    isAllDay: false,
    createdAt: new Date('2026-02-01T00:00:00Z'),
    updatedAt: new Date('2026-02-15T10:00:00Z'),
    lists: [{
      id: 'list-1',
      name: 'Agent Tasks',
      description: 'You are a helpful agent. Complete tasks assigned to you.',
    }],
    creator: { id: 'user-1', name: 'Jon', email: 'jon@example.com' },
    comments: [
      {
        id: 'c1',
        content: 'Please do this ASAP',
        authorId: 'user-1',
        createdAt: new Date('2026-02-10T08:00:00Z'),
        author: { id: 'user-1', name: 'Jon', email: 'jon@example.com', isAIAgent: false },
      },
    ],
    ...overrides,
  }
}

describe('enrichTaskForAgent', () => {
  it('transforms a fully populated task', () => {
    const result = enrichTaskForAgent(makeTask())
    expect(result).toEqual({
      id: 'task-1',
      title: 'Test Task',
      description: 'Do the thing',
      priority: 2,
      completed: false,
      dueDateTime: '2026-03-01T12:00:00.000Z',
      isAllDay: false,
      listId: 'list-1',
      listName: 'Agent Tasks',
      listDescription: 'You are a helpful agent. Complete tasks assigned to you.',
      assignerName: 'Jon',
      assignerId: 'user-1',
      comments: [{
        id: 'c1',
        content: 'Please do this ASAP',
        authorName: 'Jon',
        authorId: 'user-1',
        isAgent: false,
        createdAt: '2026-02-10T08:00:00.000Z',
      }],
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-15T10:00:00.000Z',
    })
  })

  it('handles missing description', () => {
    const result = enrichTaskForAgent(makeTask({ description: null }))
    expect(result.description).toBe('')
  })

  it('handles missing due date', () => {
    const result = enrichTaskForAgent(makeTask({ dueDateTime: null }))
    expect(result.dueDateTime).toBeNull()
  })

  it('handles no list', () => {
    const result = enrichTaskForAgent(makeTask({ lists: [] }))
    expect(result.listId).toBeNull()
    expect(result.listName).toBeNull()
    expect(result.listDescription).toBeNull()
  })

  it('handles missing lists array', () => {
    const result = enrichTaskForAgent(makeTask({ lists: undefined }))
    expect(result.listId).toBeNull()
  })

  it('handles no creator', () => {
    const result = enrichTaskForAgent(makeTask({ creator: null }))
    expect(result.assignerName).toBeNull()
    expect(result.assignerId).toBeNull()
  })

  it('uses email when creator has no name', () => {
    const result = enrichTaskForAgent(makeTask({ creator: { id: 'u2', name: null, email: 'a@b.com' } }))
    expect(result.assignerName).toBe('a@b.com')
  })

  it('handles empty comments', () => {
    const result = enrichTaskForAgent(makeTask({ comments: [] }))
    expect(result.comments).toEqual([])
  })

  it('handles undefined comments', () => {
    const result = enrichTaskForAgent(makeTask({ comments: undefined }))
    expect(result.comments).toEqual([])
  })

  it('marks AI agent comments', () => {
    const result = enrichTaskForAgent(makeTask({
      comments: [{
        id: 'c2', content: 'Done', authorId: 'agent-1',
        createdAt: new Date('2026-02-11T00:00:00Z'),
        author: { id: 'agent-1', name: 'AstridClaw', email: 'agent@example.com', isAIAgent: true },
      }],
    }))
    expect(result.comments[0].isAgent).toBe(true)
    expect(result.comments[0].authorName).toBe('AstridClaw')
  })

  it('handles comment with missing author', () => {
    const result = enrichTaskForAgent(makeTask({
      comments: [{
        id: 'c3', content: 'Orphan', authorId: 'deleted-user',
        createdAt: new Date('2026-02-12T00:00:00Z'),
        author: null,
      }],
    }))
    expect(result.comments[0].authorName).toBeNull()
    expect(result.comments[0].authorId).toBe('deleted-user')
    expect(result.comments[0].isAgent).toBe(false)
  })

  it('passes through list description (agent instructions)', () => {
    const result = enrichTaskForAgent(makeTask({
      lists: [{ id: 'l1', name: 'Work', description: 'Follow these rules:\n1. Be concise\n2. Use markdown' }],
    }))
    expect(result.listDescription).toBe('Follow these rules:\n1. Be concise\n2. Use markdown')
  })

  it('formats dates as ISO 8601', () => {
    const result = enrichTaskForAgent(makeTask())
    expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/)
    expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/)
    expect(result.dueDateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/)
  })

  it.each([0, 1, 2, 3])('handles priority %i', (p) => {
    const result = enrichTaskForAgent(makeTask({ priority: p }))
    expect(result.priority).toBe(p)
  })

  it('defaults priority to 0 when undefined', () => {
    const result = enrichTaskForAgent(makeTask({ priority: undefined }))
    expect(result.priority).toBe(0)
  })

  it('defaults completed to false when undefined', () => {
    const result = enrichTaskForAgent(makeTask({ completed: undefined }))
    expect(result.completed).toBe(false)
  })

  it('defaults isAllDay to false when undefined', () => {
    const result = enrichTaskForAgent(makeTask({ isAllDay: undefined }))
    expect(result.isAllDay).toBe(false)
  })
})
