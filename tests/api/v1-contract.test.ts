/**
 * v1 API contract tests — pin response shapes for /api/v1/* endpoints.
 *
 * These exist because iOS consumes /api/v1/* directly. A field rename or
 * removal here = silent breakage in production. The tests below assert the
 * response shape every endpoint must produce; if a refactor changes the
 * shape, these fail loudly with a clear message about which key drifted.
 *
 * Strategy: instead of hitting a real DB, we test the shape *transformer*
 * (enrichTaskForAgent) against a representative Prisma-shaped fixture.
 * If the transformer's output structure changes, these fail. If the
 * transformer is bypassed in a route, the route-level integration tests
 * are responsible for covering it.
 *
 * Touching the canonical shape is a deliberate decision — bump the iOS
 * minimum version + ship a coordinated release. Don't silence these tests.
 */

import { describe, it, expect } from 'vitest'
import {
  enrichTaskForAgent,
  mapEventType,
  type AgentTask,
  type AgentComment,
} from '@/lib/agent-protocol'

/** Frozen task fixture matching the Prisma include shape iOS endpoints use. */
const makePrismaTask = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  title: 'Test task',
  description: 'A description',
  priority: 1,
  completed: false,
  dueDateTime: new Date('2026-05-01T12:00:00Z'),
  isAllDay: false,
  createdAt: new Date('2026-04-01T00:00:00Z'),
  updatedAt: new Date('2026-04-15T00:00:00Z'),
  creatorId: 'user-creator',
  assigneeId: 'user-assignee',
  creator: {
    id: 'user-creator',
    name: 'Creator User',
    email: 'creator@example.com',
  },
  lists: [
    {
      id: 'list-1',
      name: 'My List',
      description: 'List description',
    },
  ],
  comments: [
    {
      id: 'comment-1',
      content: 'A comment',
      authorId: 'user-creator',
      author: {
        id: 'user-creator',
        name: 'Creator User',
        email: 'creator@example.com',
        isAIAgent: false,
      },
      createdAt: new Date('2026-04-10T00:00:00Z'),
    },
  ],
  ...overrides,
})

describe('v1 contract — AgentTask shape', () => {
  it('produces every key iOS expects with the correct types', () => {
    const result = enrichTaskForAgent(makePrismaTask())

    // Top-level keys: assert every key exists with the expected type.
    // If a refactor renames any of these, this test fails with a clear
    // mismatch — iOS will break in production if we ship that.
    expect(typeof result.id).toBe('string')
    expect(typeof result.title).toBe('string')
    expect(typeof result.description).toBe('string')
    expect(typeof result.priority).toBe('number')
    expect(typeof result.completed).toBe('boolean')
    expect(result.dueDateTime === null || typeof result.dueDateTime === 'string').toBe(true)
    expect(typeof result.isAllDay).toBe('boolean')
    expect(result.listId === null || typeof result.listId === 'string').toBe(true)
    expect(result.listName === null || typeof result.listName === 'string').toBe(true)
    expect(result.listDescription === null || typeof result.listDescription === 'string').toBe(true)
    expect(result.assignerName === null || typeof result.assignerName === 'string').toBe(true)
    expect(result.assignerId === null || typeof result.assignerId === 'string').toBe(true)
    expect(Array.isArray(result.comments)).toBe(true)
    expect(typeof result.createdAt).toBe('string')
    expect(typeof result.updatedAt).toBe('string')

    // Frozen key set — adding a key is fine; removing or renaming one is not
    // without a coordinated iOS release.
    const expectedKeys = new Set<keyof AgentTask>([
      'id', 'title', 'description', 'priority', 'completed',
      'dueDateTime', 'isAllDay',
      'listId', 'listName', 'listDescription',
      'assignerName', 'assignerId',
      'comments',
      'createdAt', 'updatedAt',
    ])
    for (const key of expectedKeys) {
      expect(Object.keys(result)).toContain(key)
    }
  })

  it('serialises dates as ISO 8601 strings', () => {
    const result = enrichTaskForAgent(makePrismaTask())
    expect(result.dueDateTime).toBe('2026-05-01T12:00:00.000Z')
    expect(result.createdAt).toBe('2026-04-01T00:00:00.000Z')
    expect(result.updatedAt).toBe('2026-04-15T00:00:00.000Z')
    expect(result.comments[0].createdAt).toBe('2026-04-10T00:00:00.000Z')
  })

  it('returns null for missing optional fields rather than undefined', () => {
    // iOS's JSON decoder treats undefined and null differently; we always
    // emit null for absent values.
    const result = enrichTaskForAgent(
      makePrismaTask({
        dueDateTime: null,
        creator: null,
        lists: [],
        comments: [],
      }),
    )
    expect(result.dueDateTime).toBeNull()
    expect(result.assignerName).toBeNull()
    expect(result.assignerId).toBeNull()
    expect(result.listId).toBeNull()
    expect(result.listName).toBeNull()
    expect(result.listDescription).toBeNull()
    expect(result.comments).toEqual([])
  })

  it('falls back to creator.email when creator.name is null', () => {
    const result = enrichTaskForAgent(
      makePrismaTask({
        creator: { id: 'u', name: null, email: 'fallback@example.com' },
      }),
    )
    expect(result.assignerName).toBe('fallback@example.com')
  })

  it('uses assigneeId / creatorId fallbacks correctly', () => {
    // priority null → 0
    // completed null → false
    // isAllDay null → false
    // description null → ''
    // These defaults are part of the contract — iOS relies on them.
    const result = enrichTaskForAgent({
      ...makePrismaTask(),
      priority: null,
      completed: null,
      isAllDay: null,
      description: null,
    })
    expect(result.priority).toBe(0)
    expect(result.completed).toBe(false)
    expect(result.isAllDay).toBe(false)
    expect(result.description).toBe('')
  })
})

describe('v1 contract — AgentComment shape', () => {
  it('produces every key iOS expects with the correct types', () => {
    const result = enrichTaskForAgent(makePrismaTask())
    const comment = result.comments[0]

    expect(typeof comment.id).toBe('string')
    expect(typeof comment.content).toBe('string')
    expect(comment.authorName === null || typeof comment.authorName === 'string').toBe(true)
    expect(typeof comment.authorId).toBe('string')
    expect(typeof comment.isAgent).toBe('boolean')
    expect(typeof comment.createdAt).toBe('string')

    const expectedKeys = new Set<keyof AgentComment>([
      'id', 'content', 'authorName', 'authorId', 'isAgent', 'createdAt',
    ])
    for (const key of expectedKeys) {
      expect(Object.keys(comment)).toContain(key)
    }
  })

  it('marks agent comments correctly via author.isAIAgent', () => {
    const result = enrichTaskForAgent(
      makePrismaTask({
        comments: [
          {
            id: 'c1',
            content: 'human comment',
            authorId: 'human',
            author: { id: 'human', name: 'Human', email: 'human@x', isAIAgent: false },
            createdAt: new Date('2026-04-10T00:00:00Z'),
          },
          {
            id: 'c2',
            content: 'agent comment',
            authorId: 'astrid',
            author: { id: 'astrid', name: 'Astrid', email: 'astrid@astrid.cc', isAIAgent: true },
            createdAt: new Date('2026-04-11T00:00:00Z'),
          },
        ],
      }),
    )
    expect(result.comments[0].isAgent).toBe(false)
    expect(result.comments[1].isAgent).toBe(true)
  })

  it('falls back authorId to comment.authorId when author relation missing', () => {
    // Edge case: orphan comments where author was deleted but authorId
    // is still on the row. iOS expects authorId to be present.
    const result = enrichTaskForAgent(
      makePrismaTask({
        comments: [
          {
            id: 'c1',
            content: 'orphan',
            authorId: 'deleted-user-id',
            author: null,
            createdAt: new Date('2026-04-10T00:00:00Z'),
          },
        ],
      }),
    )
    expect(result.comments[0].authorId).toBe('deleted-user-id')
    expect(result.comments[0].authorName).toBeNull()
    expect(result.comments[0].isAgent).toBe(false)
  })
})

describe('v1 contract — agent event type mapping', () => {
  // iOS's SSE consumer subscribes to these protocol-level event names.
  // Adding new mappings is fine; changing or removing existing ones is not.
  it.each([
    ['task_assigned', 'task.assigned'],
    ['task_created', 'task.assigned'],
    ['task_updated', 'task.updated'],
    ['task_completed', 'task.completed'],
    ['task_deleted', 'task.deleted'],
    ['comment_created', 'task.commented'],
    ['comment_added', 'task.commented'],
    ['agent_task_comment', 'task.commented'],
  ])('maps %s → %s', (internal, expected) => {
    expect(mapEventType(internal)).toBe(expected)
  })

  it('returns null for unknown event types (silently ignored by iOS)', () => {
    expect(mapEventType('unknown_event')).toBeNull()
    expect(mapEventType('list_created')).toBeNull()
  })
})
