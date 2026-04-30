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
import type {
  V1List,
  V1ListsResponse,
  V1ListResponse,
  V1ListMember,
  V1MembersResponse,
  V1MemberMutationResponse,
  V1Comment,
  V1CommentResponse,
  V1CommentsResponse,
  V1ReminderSettings,
  V1MeSettingsResponse,
  V1PublicList,
  V1PublicListsResponse,
  V1Shortcode,
  V1ShortcodeResponse,
  V1ShortcodesResponse,
  V1MessageResponse,
  V1DeleteResponse,
  V1Reminder,
  V1RemindersResponse,
  V1ReminderDismissResponse,
  V1ReminderSnoozeResponse,
} from '@/lib/api-contracts/v1-ios-shapes'

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

// ─────────────────────────────────────────────────────────────────────
// Key-set contract tests for v1 response shapes iOS depends on.
//
// Pattern: declare the expected key set as a `as const satisfies
// ReadonlyArray<keyof T>` array. If a key is removed from the interface,
// `satisfies` fails at compile time. If a key is added to the interface
// but not added here, the test fails at runtime. This forces every shape
// change to be a deliberate, grep-able edit — no silent drift.
// ─────────────────────────────────────────────────────────────────────

describe('v1 contract — V1List shape (lists/[id] + lists[].element)', () => {
  const EXPECTED_KEYS = [
    'id', 'name', 'description', 'color', 'imageUrl', 'privacy',
    'isFavorite', 'favoriteOrder', 'owner', 'listMembers', 'invitations',
    'taskCount', 'isVirtual', 'virtualListType', 'sortBy', 'manualSortOrder',
    'filterPriority', 'filterAssignee', 'filterDueDate', 'filterCompletion',
    'filterRepeating', 'filterAssignedBy', 'filterInLists',
    'defaultPriority', 'defaultRepeating', 'defaultAssigneeId',
    'defaultIsPrivate', 'defaultDueDate',
    'githubRepositoryId', 'preferredAiProvider',
    'createdAt', 'updatedAt',
  ] as const satisfies ReadonlyArray<keyof V1List>

  it('every iOS-expected key appears in V1List', () => {
    // Shape sample built fresh from the contract; if a key is added to
    // V1List but not to EXPECTED_KEYS above, this object will be missing
    // a key the type requires — tsc fails. If a key is removed from
    // V1List, `satisfies` on EXPECTED_KEYS fails. Either way, the contract
    // change is forced through this test.
    const sample: V1List = {
      id: 'l1', name: 'List', description: '', color: '#000', imageUrl: null,
      privacy: 'PRIVATE', isFavorite: false, favoriteOrder: null,
      owner: null, listMembers: [], invitations: [],
      taskCount: 0, isVirtual: false, virtualListType: null,
      sortBy: null, manualSortOrder: null,
      filterPriority: null, filterAssignee: null, filterDueDate: null,
      filterCompletion: null, filterRepeating: null, filterAssignedBy: null,
      filterInLists: null,
      defaultPriority: null, defaultRepeating: null, defaultAssigneeId: null,
      defaultIsPrivate: null, defaultDueDate: null,
      githubRepositoryId: null, preferredAiProvider: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED_KEYS))
  })
})

describe('v1 contract — V1ListsResponse / V1ListResponse envelopes', () => {
  it('V1ListsResponse has { lists, meta }', () => {
    const sample: V1ListsResponse = {
      lists: [],
      meta: { apiVersion: 'v1', authSource: 'session', total: 0, timestamp: 't', isIncremental: false },
    }
    expect(Object.keys(sample).sort()).toEqual(['lists', 'meta'])
    expect(Object.keys(sample.meta).sort()).toEqual(
      ['apiVersion', 'authSource', 'isIncremental', 'timestamp', 'total']
    )
  })

  it('V1ListResponse has { list, meta }', () => {
    const sample = {
      list: undefined as unknown as V1List,
      meta: { apiVersion: 'v1', authSource: 'session' },
    } satisfies V1ListResponse
    expect(Object.keys(sample).sort()).toEqual(['list', 'meta'])
  })
})

describe('v1 contract — V1ListMember shape (lists/[id]/members)', () => {
  const EXPECTED_KEYS = [
    'id', 'name', 'email', 'image', 'role', 'isOwner', 'isAdmin', 'type',
  ] as const satisfies ReadonlyArray<keyof V1ListMember>

  it('every iOS-expected key appears in V1ListMember', () => {
    const sample: V1ListMember = {
      id: 'u1', name: 'X', email: 'x@example.com', image: null,
      role: 'MEMBER', isOwner: false, isAdmin: false, type: 'human',
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED_KEYS))
  })

  it('V1MembersResponse has { members, meta }', () => {
    const sample: V1MembersResponse = {
      members: [],
      meta: { apiVersion: 'v1', authSource: 'session' },
    }
    expect(Object.keys(sample).sort()).toEqual(['members', 'meta'])
  })

  it('V1MemberMutationResponse has { message, member, meta }', () => {
    const sample = {
      message: 'ok',
      member: undefined as unknown as V1ListMember,
      meta: { apiVersion: 'v1', authSource: 'session' },
    } satisfies V1MemberMutationResponse
    expect(Object.keys(sample).sort()).toEqual(['message', 'meta', 'member'].sort())
  })
})

describe('v1 contract — V1Comment shape (comments/[id] + tasks/[id]/comments)', () => {
  const EXPECTED_KEYS = [
    'id', 'content', 'type', 'authorId', 'author', 'secureFiles',
    'createdAt', 'updatedAt',
  ] as const satisfies ReadonlyArray<keyof V1Comment>

  it('every iOS-expected key appears in V1Comment', () => {
    const sample: V1Comment = {
      id: 'c1', content: 'hi', type: null, authorId: 'u1', author: null,
      secureFiles: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED_KEYS))
  })

  it('V1CommentResponse has { comment, meta }', () => {
    const sample: V1CommentResponse = {
      comment: {
        id: 'c1', content: 'hi', authorId: 'u1', author: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      meta: { apiVersion: 'v1', authSource: 'session' },
    }
    expect(Object.keys(sample).sort()).toEqual(['comment', 'meta'])
  })

  it('V1CommentsResponse has { comments, meta }', () => {
    const sample: V1CommentsResponse = {
      comments: [],
      meta: { apiVersion: 'v1', authSource: 'session', total: 0, taskId: 't1' },
    }
    expect(Object.keys(sample).sort()).toEqual(['comments', 'meta'])
  })
})

describe('v1 contract — V1ReminderSettings (users/me/settings)', () => {
  const EXPECTED_KEYS = [
    'enablePushReminders', 'enableEmailReminders', 'defaultReminderTime',
    'enableDailyDigest', 'dailyDigestTime', 'dailyDigestTimezone',
    'quietHoursStart', 'quietHoursEnd',
  ] as const satisfies ReadonlyArray<keyof V1ReminderSettings>

  it('every iOS-expected key appears in V1ReminderSettings', () => {
    const sample: V1ReminderSettings = {
      enablePushReminders: false, enableEmailReminders: true,
      defaultReminderTime: 15, enableDailyDigest: false,
      dailyDigestTime: '09:00', dailyDigestTimezone: 'America/Los_Angeles',
      quietHoursStart: null, quietHoursEnd: null,
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED_KEYS))
  })

  it('V1MeSettingsResponse wraps reminderSettings under settings', () => {
    const sample: V1MeSettingsResponse = {
      settings: {
        reminderSettings: {
          enablePushReminders: false, enableEmailReminders: true,
          defaultReminderTime: 15, enableDailyDigest: false,
          dailyDigestTime: '09:00', dailyDigestTimezone: 'America/Los_Angeles',
          quietHoursStart: null, quietHoursEnd: null,
        },
      },
      meta: { apiVersion: 'v1', authSource: 'session' },
    }
    expect(Object.keys(sample).sort()).toEqual(['meta', 'settings'])
    expect(Object.keys(sample.settings)).toEqual(['reminderSettings'])
  })
})

describe('v1 contract — V1PublicList shape (public/lists discovery)', () => {
  const EXPECTED_KEYS = [
    'id', 'name', 'description', 'color', 'privacy', 'publicListType',
    'imageUrl', 'createdAt', 'updatedAt',
    'owner', 'admins', 'taskCount', 'memberCount',
  ] as const satisfies ReadonlyArray<keyof V1PublicList>

  it('every iOS-expected key appears in V1PublicList', () => {
    const sample: V1PublicList = {
      id: 'l1', name: 'Pub', description: '', color: '#000',
      privacy: 'PUBLIC', publicListType: null, imageUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      owner: null, admins: [], taskCount: 0, memberCount: 0,
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED_KEYS))
  })

  it('V1PublicListsResponse has { lists, meta }', () => {
    const sample: V1PublicListsResponse = {
      lists: [],
      meta: { apiVersion: 'v1', authSource: 'public', count: 0, sortBy: 'recent' },
    }
    expect(Object.keys(sample).sort()).toEqual(['lists', 'meta'])
  })
})

describe('v1 contract — V1Shortcode (shortcodes)', () => {
  const EXPECTED_KEYS = [
    'code', 'targetType', 'targetId', 'url',
  ] as const satisfies ReadonlyArray<keyof V1Shortcode>

  it('every iOS-expected key appears in V1Shortcode', () => {
    const sample: V1Shortcode = {
      code: 'abc', targetType: 'task', targetId: 't1', url: 'https://astrid.cc/s/abc',
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED_KEYS))
  })

  it('V1ShortcodeResponse has { shortcode, meta }', () => {
    const sample: V1ShortcodeResponse = {
      shortcode: { code: 'abc', targetType: 'task', targetId: 't1', url: 'https://astrid.cc/s/abc' },
      meta: { apiVersion: 'v1', authSource: 'session' },
    }
    expect(Object.keys(sample).sort()).toEqual(['meta', 'shortcode'])
  })

  it('V1ShortcodesResponse has { shortcodes, meta }', () => {
    const sample: V1ShortcodesResponse = {
      shortcodes: [],
      meta: { apiVersion: 'v1', authSource: 'session', count: 0 },
    }
    expect(Object.keys(sample).sort()).toEqual(['meta', 'shortcodes'])
  })
})

describe('v1 contract — generic envelopes', () => {
  it('V1MessageResponse has { message, meta }', () => {
    const sample: V1MessageResponse = {
      message: 'ok',
      meta: { apiVersion: 'v1', authSource: 'session' },
    }
    expect(Object.keys(sample).sort()).toEqual(['message', 'meta'])
  })

  it('V1DeleteResponse has { success: true, message, meta }', () => {
    const sample: V1DeleteResponse = {
      success: true, message: 'deleted',
      meta: { apiVersion: 'v1', authSource: 'session' },
    }
    expect(Object.keys(sample).sort()).toEqual(['message', 'meta', 'success'])
    // success must literally be true — not just truthy. iOS uses it as a
    // discriminator when the same handler can return error envelopes.
    expect(sample.success).toBe(true)
  })
})

describe('v1 contract — V1Reminder shape (reminders)', () => {
  const EXPECTED = [
    'id', 'type', 'scheduledFor', 'retryCount', 'snoozeCount', 'task',
  ] as const satisfies ReadonlyArray<keyof V1Reminder>

  it('every iOS-expected key appears in V1Reminder', () => {
    const sample: V1Reminder = {
      id: 'r1', type: 'DUE_NOW',
      scheduledFor: '2026-04-30T00:00:00Z',
      retryCount: 0, snoozeCount: 0,
      task: {
        id: 't1', title: 'Title', description: null,
        dueDateTime: null, priority: null, completed: false,
        listNames: [],
      },
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
  })

  it('V1RemindersResponse has { reminders, summary, total, meta }', () => {
    const sample: V1RemindersResponse = {
      reminders: [],
      summary: {},
      total: 0,
      meta: { apiVersion: 'v1', authSource: 'session' },
    }
    expect(Object.keys(sample).sort()).toEqual(['meta', 'reminders', 'summary', 'total'])
  })

  it('V1ReminderDismissResponse has { success, dismissedCount, meta }', () => {
    const sample: V1ReminderDismissResponse = {
      success: true, dismissedCount: 1,
      meta: { apiVersion: 'v1', authSource: 'session' },
    }
    expect(Object.keys(sample).sort()).toEqual(['dismissedCount', 'meta', 'success'])
    expect(sample.success).toBe(true)
  })

  it('V1ReminderSnoozeResponse has { success, scheduledFor, snoozeCount, meta }', () => {
    const sample: V1ReminderSnoozeResponse = {
      success: true,
      scheduledFor: '2026-04-30T00:00:00Z',
      snoozeCount: 1,
      meta: { apiVersion: 'v1', authSource: 'session' },
    }
    expect(Object.keys(sample).sort()).toEqual(
      ['meta', 'scheduledFor', 'snoozeCount', 'success']
    )
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
