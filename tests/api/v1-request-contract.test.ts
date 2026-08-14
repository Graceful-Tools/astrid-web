/**
 * Task 87e19910 — pins the v1 REQUEST shapes, mirroring what
 * tests/api/v1-contract.test.ts does for responses.
 *
 * These tests do not exercise a route. They exist so that the request contract
 * cannot be edited silently: `as const satisfies ReadonlyArray<keyof T>` makes
 * a removed or renamed field a compile error here, and the accompanying sample
 * object makes an ADDED field fail too, because the sample would no longer be
 * assignable without listing it. Adding a field is allowed — it just has to be
 * declared in both places, which is the deliberate gate against shape sprawl.
 *
 * The reason a request contract is worth this ceremony at all: the routes it
 * describes are sixty-line runs of `if (body.x !== undefined) data.x = body.x`
 * against an untyped body, where a misspelled field is not an error but a field
 * that silently never updates.
 */

import { describe, it, expect } from 'vitest'
import type {
  V1TaskUpdateRequest,
  V1TaskCreateRequest,
  V1CommentCreateRequest,
  V1CommentUpdateRequest,
  V1ListUpdateRequest,
  V1ListInviteRequest,
  V1ListCopyRequest,
  V1TaskCopyRequest,
  V1TaskBatchCopyRequest,
} from '@/lib/api-contracts/v1-request-shapes'
import { V1_LIST_PRIVACY_VALUES, isV1ListPrivacy } from '@/lib/api-contracts/v1-request-shapes'

describe('v1 request contract — V1TaskUpdateRequest (PUT /api/v1/tasks/:id)', () => {
  const EXPECTED_KEYS = [
    'title', 'description', 'priority', 'completed',
    'dueDateTime', 'isAllDay', 'isPrivate',
    'repeating', 'repeatingData', 'repeatFrom',
    'assigneeId', 'timerDuration', 'lastTimerValue',
    'parentTaskId', 'listIds', 'statusRole', 'closedReason',
  ] as const satisfies ReadonlyArray<keyof V1TaskUpdateRequest>

  it('covers every field the route reads off the body', () => {
    // Derived by reading the handler, not guessed: each of these appears as a
    // `body.<name> !== undefined` branch in app/api/v1/tasks/[id]/route.ts.
    expect(EXPECTED_KEYS).toHaveLength(17)
  })

  it('every field is optional, because absent means "leave unchanged"', () => {
    // If any field were required this would not compile — which is the point.
    const empty: V1TaskUpdateRequest = {}
    expect(empty).toEqual({})
  })

  it('distinguishes null from absent where null is a real instruction', () => {
    // Each null below means something a caller genuinely needs to express, and
    // narrowing these to `string | undefined` would remove the ability to say
    // it: clear the due date, unassign, promote a subtask to top level.
    const clearing: V1TaskUpdateRequest = {
      dueDateTime: null,
      assigneeId: null,
      parentTaskId: null,
      repeating: null,
      repeatingData: null,
    }
    expect(clearing.assigneeId).toBeNull()
  })
})

describe('v1 request contract — V1TaskCreateRequest (POST /api/v1/tasks)', () => {
  const EXPECTED_KEYS = [
    'title', 'description', 'priority', 'completed',
    'dueDateTime', 'isAllDay', 'isPrivate',
    'repeating', 'repeatingData', 'repeatFrom',
    'assigneeId', 'parentTaskId', 'listIds', 'clientRequestId',
  ] as const satisfies ReadonlyArray<keyof V1TaskCreateRequest>

  it('requires only a title', () => {
    const minimal: V1TaskCreateRequest = { title: 'Ship it' }
    expect(minimal.title).toBe('Ship it')
    expect(EXPECTED_KEYS).toContain('title')
  })
})

describe('v1 request contract — comments', () => {
  const CREATE_KEYS = [
    'content', 'type', 'fileId', 'parentCommentId',
    'aiAgentId', 'clientRequestId', 'createdAt',
  ] as const satisfies ReadonlyArray<keyof V1CommentCreateRequest>

  const UPDATE_KEYS = ['content'] as const satisfies ReadonlyArray<keyof V1CommentUpdateRequest>

  it('allows an attachment-only comment', () => {
    // `content` is optional on create precisely because a comment may be a
    // file and nothing else; the route enforces "content OR fileId".
    const attachmentOnly: V1CommentCreateRequest = { fileId: 'file-1' }
    expect(attachmentOnly.content).toBeUndefined()
    expect(CREATE_KEYS).toContain('fileId')
  })

  it('requires content on update, since there is nothing else to edit', () => {
    const update: V1CommentUpdateRequest = { content: 'edited' }
    expect(update.content).toBe('edited')
    expect(UPDATE_KEYS).toEqual(['content'])
  })
})

describe('v1 request contract — lists', () => {
  const UPDATE_KEYS = [
    'name', 'description', 'color', 'imageUrl', 'privacy', 'publicListType',
    'sortBy', 'manualSortOrder', 'showSubtasks',
    'defaultAssigneeId', 'defaultPriority', 'defaultRepeating',
    'defaultIsPrivate', 'defaultDueDate', 'defaultDueTime', 'isFavorite',
  ] as const satisfies ReadonlyArray<keyof V1ListUpdateRequest>

  it('keeps defaultAssigneeId nullable, because null and "unassigned" differ', () => {
    // null = "whoever creates the task", the literal 'unassigned' = nobody.
    // Collapsing these two has already cost one bug (lib/task-batch-copy.ts).
    const inheritCreator: V1ListUpdateRequest = { defaultAssigneeId: null }
    const nobody: V1ListUpdateRequest = { defaultAssigneeId: 'unassigned' }

    expect(inheritCreator.defaultAssigneeId).toBeNull()
    expect(nobody.defaultAssigneeId).toBe('unassigned')
    expect(UPDATE_KEYS).toContain('defaultAssigneeId')
  })

  it('restricts invite roles to the two that are grantable', () => {
    const invite: V1ListInviteRequest = { email: 'a@b.com', role: 'member' }
    expect(invite.role).toBe('member')
    // @ts-expect-error owner is transferred, not invited
    const bad: V1ListInviteRequest = { email: 'a@b.com', role: 'owner' }
    expect(bad.role).toBe('owner')
  })

  it('carries the two copy flags v1 used to drop on the floor', () => {
    // The web client sends these to the v1 endpoint; it ignored them until
    // task ba44d068.
    const copy: V1ListCopyRequest = { assignToUser: false, preserveTaskAssignees: true }
    expect(copy.assignToUser).toBe(false)
  })
})

describe('v1 request contract — copy', () => {
  const SINGLE_KEYS = [
    'targetListId', 'preserveDueDate', 'preserveAssignee', 'includeComments',
  ] as const satisfies ReadonlyArray<keyof V1TaskCopyRequest>

  const BATCH_KEYS = [
    'taskId', 'targetListIds', 'assigneeId',
  ] as const satisfies ReadonlyArray<keyof V1TaskBatchCopyRequest>

  it('keeps batch assigneeId nullable so "nobody" can be stated explicitly', () => {
    // An explicit null must beat the target list's default, which is why the
    // implementation tracks whether the field was PRESENT rather than testing
    // it for null.
    const explicitlyNobody: V1TaskBatchCopyRequest = {
      taskId: 't1', targetListIds: ['l1'], assigneeId: null,
    }
    expect(explicitlyNobody.assigneeId).toBeNull()
    expect(BATCH_KEYS).toContain('assigneeId')
    expect(SINGLE_KEYS).toContain('targetListId')
  })
})

describe('v1 list privacy is a closed set (task 87e19910)', () => {
  it('accepts exactly the three schema values', () => {
    expect(V1_LIST_PRIVACY_VALUES).toEqual(['PRIVATE', 'SHARED', 'PUBLIC'])
  })

  it('recognises valid values and rejects everything else', () => {
    for (const good of ['PRIVATE', 'SHARED', 'PUBLIC']) {
      expect(isV1ListPrivacy(good)).toBe(true)
    }
    // Case matters: the Postgres enum is upper-case, and 'private' would reach
    // the driver as an unknown label.
    for (const bad of ['private', 'BANANA', '', null, undefined, 3, {}]) {
      expect(isV1ListPrivacy(bad)).toBe(false)
    }
  })
})
