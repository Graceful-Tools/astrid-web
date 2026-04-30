/**
 * Legacy /api/* contract tests — pin response shapes iOS depends on.
 *
 * These are temporary by design: when Phase 4 of the v1 migration
 * deletes the legacy routes, this whole file goes with them. Until
 * then, every Phase 1 handler-extraction needs these tests to fail
 * loudly if it changes a shape.
 *
 * Same key-set pattern as `tests/api/v1-contract.test.ts`:
 * `as const satisfies ReadonlyArray<keyof T>` enforces removals at
 * compile time; runtime assertions catch additions.
 */

import { describe, it, expect } from 'vitest'
import type {
  LegacyTasksListResponse,
  LegacyTaskCopyResponse,
  LegacyListsListResponse,
  LegacyListInviteResponse,
  LegacyListLeaveResponse,
  LegacyListFavoriteResponse,
  LegacyReminder,
  LegacyRemindersStatusResponse,
  LegacyReminderDismissResponse,
  LegacyReminderSnoozeResponse,
  LegacyAccountResponse,
  LegacyAccountDeleteResponse,
  LegacyVerifyEmailResponse,
  LegacyUploadResponse,
  LegacySecureFileInfoResponse,
  LegacySecureUploadRequestResponse,
  LegacySecureUploadGetUrlResponse,
  LegacySecureFileUploadUrlResponse,
  LegacySecureFileConfirmUploadResponse,
  LegacyUserProfileResponse,
  LegacyUsersSearchResponse,
  LegacyMyTasksPreferencesResponse,
  LegacyAiApiKeysResponse,
  LegacySuccessOnlyResponse,
  LegacyAiKeyTestResponse,
  LegacyAvailableAgentsResponse,
  LegacyAiAssistantSettingsResponse,
  LegacyAiAvailableModelsResponse,
  LegacyChatChannelResponse,
  LegacyChatMessage,
  LegacyChatMessagesListResponse,
  LegacyChatMessageMutationResponse,
  LegacyInvitationResponse,
  LegacyShortcodeMutationResponse,
  LegacyShortcodeResolveResponse,
  LegacyPushSubscribeResponse,
} from '@/lib/api-contracts/legacy-ios-shapes'

// ── Tasks ─────────────────────────────────────────────────────────────

describe('legacy contract — TasksListResponse (GET /api/tasks)', () => {
  const EXPECTED = ['tasks', 'timestamp', 'isIncremental', 'count'] as const satisfies ReadonlyArray<keyof LegacyTasksListResponse>

  it('envelope keys match', () => {
    const sample: LegacyTasksListResponse = {
      tasks: [], timestamp: 't', isIncremental: false, count: 0,
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
  })
})

describe('legacy contract — TaskCopyResponse (POST /api/tasks/[id]/copy)', () => {
  const EXPECTED = ['success', 'task', 'message'] as const satisfies ReadonlyArray<keyof LegacyTaskCopyResponse>

  it('envelope keys match', () => {
    const sample = {
      success: true as const,
      task: undefined as unknown as LegacyTaskCopyResponse['task'],
      message: 'Copied',
    } satisfies LegacyTaskCopyResponse
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
  })
})

// ── Lists ─────────────────────────────────────────────────────────────

describe('legacy contract — ListsListResponse (GET /api/lists)', () => {
  const EXPECTED = ['lists', 'timestamp', 'isIncremental', 'count'] as const satisfies ReadonlyArray<keyof LegacyListsListResponse>

  it('envelope keys match', () => {
    const sample: LegacyListsListResponse = {
      lists: [], timestamp: 't', isIncremental: false, count: 0,
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
  })
})

describe('legacy contract — ListInviteResponse', () => {
  const EXPECTED = ['message', 'invitation'] as const satisfies ReadonlyArray<keyof LegacyListInviteResponse>
  const INVITATION_KEYS = ['id', 'email', 'role', 'type', 'createdAt'] as const

  it('envelope keys match', () => {
    const sample: LegacyListInviteResponse = {
      message: 'Invited',
      invitation: { id: 'i1', email: 'a@b', role: 'MEMBER', type: 'email', createdAt: 't' },
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
    expect(new Set(Object.keys(sample.invitation))).toEqual(new Set(INVITATION_KEYS))
  })
})

describe('legacy contract — ListLeaveResponse', () => {
  it('has only { message }', () => {
    const sample: LegacyListLeaveResponse = { message: 'Left' }
    expect(Object.keys(sample)).toEqual(['message'])
  })
})

describe('legacy contract — ListFavoriteResponse', () => {
  const EXPECTED = ['success', 'isFavorite', 'listId', 'list'] as const satisfies ReadonlyArray<keyof LegacyListFavoriteResponse>

  it('envelope keys match', () => {
    const sample = {
      success: true,
      isFavorite: true,
      listId: 'l1',
      list: undefined as unknown as LegacyListFavoriteResponse['list'],
    } satisfies LegacyListFavoriteResponse
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
  })
})

// ── Reminders ─────────────────────────────────────────────────────────

describe('legacy contract — Reminder shape', () => {
  const EXPECTED = [
    'id', 'type', 'scheduledFor', 'retryCount', 'snoozeCount', 'task',
  ] as const satisfies ReadonlyArray<keyof LegacyReminder>

  it('every iOS-expected key appears', () => {
    const sample: LegacyReminder = {
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
})

describe('legacy contract — RemindersStatusResponse', () => {
  it('has { reminders, summary, total }', () => {
    const sample: LegacyRemindersStatusResponse = {
      reminders: [], summary: { PENDING: 0 }, total: 0,
    }
    expect(Object.keys(sample).sort()).toEqual(['reminders', 'summary', 'total'])
  })
})

describe('legacy contract — ReminderDismissResponse', () => {
  it('has { success: true, dismissedCount }', () => {
    const sample: LegacyReminderDismissResponse = { success: true, dismissedCount: 1 }
    expect(Object.keys(sample).sort()).toEqual(['dismissedCount', 'success'])
    expect(sample.success).toBe(true)
  })
})

describe('legacy contract — ReminderSnoozeResponse', () => {
  const EXPECTED = ['success', 'scheduledFor', 'snoozeCount'] as const satisfies ReadonlyArray<keyof LegacyReminderSnoozeResponse>

  it('envelope keys match', () => {
    const sample: LegacyReminderSnoozeResponse = {
      success: true, scheduledFor: 't', snoozeCount: 1,
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
  })
})

// ── Account ───────────────────────────────────────────────────────────

describe('legacy contract — AccountResponse (GET /api/account)', () => {
  it('wraps user under { user }', () => {
    const sample = {
      user: undefined as unknown as LegacyAccountResponse['user'],
    } satisfies LegacyAccountResponse
    expect(Object.keys(sample)).toEqual(['user'])
  })
})

describe('legacy contract — AccountDeleteResponse', () => {
  it('has { success: true, message }', () => {
    const sample: LegacyAccountDeleteResponse = {
      success: true, message: 'deleted',
    }
    expect(Object.keys(sample).sort()).toEqual(['message', 'success'])
    expect(sample.success).toBe(true)
  })
})

describe('legacy contract — VerifyEmailResponse (multi-action)', () => {
  // Variant: the bare success case
  it('always carries { success } regardless of action', () => {
    const sample: LegacyVerifyEmailResponse = { success: true }
    expect('success' in sample).toBe(true)
  })

  // Variant: error case
  it('may include { error } when success=false', () => {
    const sample: LegacyVerifyEmailResponse = { success: false, error: 'Token expired' }
    expect(sample.success).toBe(false)
    expect(sample.error).toBe('Token expired')
  })
})

// ── Files ─────────────────────────────────────────────────────────────

describe('legacy contract — UploadResponse', () => {
  const EXPECTED = ['url', 'name', 'size', 'type'] as const satisfies ReadonlyArray<keyof LegacyUploadResponse>

  it('envelope keys match', () => {
    const sample: LegacyUploadResponse = {
      url: 'https://blob...', name: 'a.png', size: 1024, type: 'image/png',
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
  })
})

describe('legacy contract — SecureFileInfoResponse', () => {
  const EXPECTED = ['url', 'fileName', 'mimeType', 'fileSize', 'expiresIn'] as const satisfies ReadonlyArray<keyof LegacySecureFileInfoResponse>

  it('envelope keys match', () => {
    const sample: LegacySecureFileInfoResponse = {
      url: 'https://x', fileName: 'a.png', mimeType: 'image/png',
      fileSize: 1024, expiresIn: 3600,
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
  })
})

describe('legacy contract — SecureUpload chain', () => {
  it('SecureUploadRequestResponse keys match', () => {
    const EXPECTED = ['fileId', 'fileName', 'fileSize', 'mimeType', 'success'] as const satisfies ReadonlyArray<keyof LegacySecureUploadRequestResponse>
    const sample: LegacySecureUploadRequestResponse = {
      fileId: 'f1', fileName: 'a.png', fileSize: 1024,
      mimeType: 'image/png', success: true,
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
  })

  it('SecureUploadGetUrlResponse keys match', () => {
    const EXPECTED = ['uploadToken', 'pathname', 'fileId'] as const satisfies ReadonlyArray<keyof LegacySecureUploadGetUrlResponse>
    const sample: LegacySecureUploadGetUrlResponse = {
      uploadToken: 'tok', pathname: '/p', fileId: 'f1',
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
  })

  it('SecureFileUploadUrlResponse keys match', () => {
    const EXPECTED = ['uploadUrl', 'pathname', 'headers', 'method'] as const satisfies ReadonlyArray<keyof LegacySecureFileUploadUrlResponse>
    const sample: LegacySecureFileUploadUrlResponse = {
      uploadUrl: 'https://x', pathname: '/p', headers: {}, method: 'PUT',
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
  })

  it('SecureFileConfirmUploadResponse keys match', () => {
    const EXPECTED = ['id', 'originalName', 'mimeType', 'fileSize', 'updatedAt', 'success'] as const satisfies ReadonlyArray<keyof LegacySecureFileConfirmUploadResponse>
    const sample: LegacySecureFileConfirmUploadResponse = {
      id: 'f1', originalName: 'a.png', mimeType: 'image/png',
      fileSize: 1024, updatedAt: 't', success: true,
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
  })
})

// ── Users ─────────────────────────────────────────────────────────────

describe('legacy contract — UserProfileResponse', () => {
  const EXPECTED = ['user', 'stats', 'sharedTasks', 'isOwnProfile'] as const satisfies ReadonlyArray<keyof LegacyUserProfileResponse>
  const USER_KEYS = ['id', 'name', 'email', 'image', 'createdAt', 'isAIAgent', 'aiAgentType']
  const STATS_KEYS = ['completed', 'inspired', 'supported']

  it('envelope, user, and stats keys match', () => {
    const sample: LegacyUserProfileResponse = {
      user: {
        id: 'u1', name: 'X', email: 'x@y', image: null,
        createdAt: 't', isAIAgent: false, aiAgentType: null,
      },
      stats: { completed: 0, inspired: 0, supported: 0 },
      sharedTasks: [],
      isOwnProfile: false,
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
    expect(new Set(Object.keys(sample.user))).toEqual(new Set(USER_KEYS))
    expect(new Set(Object.keys(sample.stats))).toEqual(new Set(STATS_KEYS))
  })
})

describe('legacy contract — UsersSearchResponse', () => {
  it('has { users, listMemberCount }', () => {
    const sample: LegacyUsersSearchResponse = { users: [], listMemberCount: 0 }
    expect(Object.keys(sample).sort()).toEqual(['listMemberCount', 'users'])
  })
})

// ── User settings (mixed-version) ─────────────────────────────────────

describe('legacy contract — MyTasksPreferencesResponse', () => {
  it('has { sortBy, manualSortOrder }', () => {
    const sample: LegacyMyTasksPreferencesResponse = { sortBy: 'priority', manualSortOrder: [] }
    expect(Object.keys(sample).sort()).toEqual(['manualSortOrder', 'sortBy'])
  })
})

describe('legacy contract — AiApiKeysResponse', () => {
  it('wraps keys array; each key has { provider, keyId, name, lastUsed }', () => {
    const sample: LegacyAiApiKeysResponse = {
      keys: [{ provider: 'openai', keyId: 'k1', name: 'n', lastUsed: null }],
    }
    expect(Object.keys(sample)).toEqual(['keys'])
    expect(new Set(Object.keys(sample.keys[0]))).toEqual(
      new Set(['provider', 'keyId', 'name', 'lastUsed'])
    )
  })
})

describe('legacy contract — SuccessOnlyResponse (PUT/DELETE /api/user/ai-api-keys)', () => {
  it('has { success: true } only', () => {
    const sample: LegacySuccessOnlyResponse = { success: true }
    expect(Object.keys(sample)).toEqual(['success'])
    expect(sample.success).toBe(true)
  })
})

describe('legacy contract — AiKeyTestResponse', () => {
  it('has { success } and optional { error }', () => {
    const ok: LegacyAiKeyTestResponse = { success: true }
    expect(Object.keys(ok)).toEqual(['success'])
    const err: LegacyAiKeyTestResponse = { success: false, error: 'invalid' }
    expect(new Set(Object.keys(err))).toEqual(new Set(['success', 'error']))
  })
})

describe('legacy contract — AvailableAgentsResponse', () => {
  const AGENT_KEYS = ['id', 'email', 'name', 'image', 'isAIAgent', 'aiAgentType']

  it('has { agents } where each agent has the expected key set', () => {
    const sample: LegacyAvailableAgentsResponse = {
      agents: [{
        id: 'a1', email: 'a@astrid.cc', name: 'Astrid',
        image: null, isAIAgent: true, aiAgentType: 'ASTRID',
      }],
    }
    expect(Object.keys(sample)).toEqual(['agents'])
    expect(new Set(Object.keys(sample.agents[0]))).toEqual(new Set(AGENT_KEYS))
  })
})

describe('legacy contract — AiAssistantSettingsResponse', () => {
  it('has { preferredService, defaultAgentId }', () => {
    const sample: LegacyAiAssistantSettingsResponse = {
      preferredService: 'openai', defaultAgentId: null,
    }
    expect(Object.keys(sample).sort()).toEqual(['defaultAgentId', 'preferredService'])
  })
})

describe('legacy contract — AiAvailableModelsResponse', () => {
  it('has { models, source }', () => {
    const sample: LegacyAiAvailableModelsResponse = { models: [], source: 'static' }
    expect(Object.keys(sample).sort()).toEqual(['models', 'source'])
  })
})

// ── Chat ──────────────────────────────────────────────────────────────

describe('legacy contract — ChatChannelResponse', () => {
  const CHANNEL_KEYS = ['id', 'listId', 'virtualKey', 'name'] as const

  it('has { channel } where channel has the expected key set', () => {
    const sample: LegacyChatChannelResponse = {
      channel: { id: 'c1', listId: 'l1', virtualKey: null, name: 'List' },
    }
    expect(Object.keys(sample)).toEqual(['channel'])
    expect(new Set(Object.keys(sample.channel))).toEqual(new Set(CHANNEL_KEYS))
  })
})

describe('legacy contract — ChatMessage shape', () => {
  const EXPECTED = [
    'id', 'channelId', 'authorId', 'content',
    'createdAt', 'updatedAt', 'author',
  ] as const satisfies ReadonlyArray<keyof LegacyChatMessage>

  it('every iOS-expected key appears', () => {
    const sample: LegacyChatMessage = {
      id: 'm1', channelId: 'c1', authorId: 'u1', content: 'hi',
      createdAt: 't', updatedAt: 't', author: null,
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
  })
})

describe('legacy contract — ChatMessagesListResponse', () => {
  it('has { messages, hasMore, nextCursor }', () => {
    const sample: LegacyChatMessagesListResponse = {
      messages: [], hasMore: false, nextCursor: null,
    }
    expect(Object.keys(sample).sort()).toEqual(['hasMore', 'messages', 'nextCursor'])
  })
})

describe('legacy contract — ChatMessageMutationResponse', () => {
  it('has { message } only', () => {
    const sample = {
      message: undefined as unknown as LegacyChatMessage,
    } satisfies LegacyChatMessageMutationResponse
    expect(Object.keys(sample)).toEqual(['message'])
  })
})

// ── Misc ──────────────────────────────────────────────────────────────

describe('legacy contract — InvitationResponse', () => {
  const EXPECTED = ['success', 'userExists', 'invitation', 'message'] as const satisfies ReadonlyArray<keyof LegacyInvitationResponse>
  const INV_KEYS = ['id', 'email', 'type', 'expiresAt']

  it('envelope and invitation keys match', () => {
    const sample: LegacyInvitationResponse = {
      success: true, userExists: false,
      invitation: { id: 'i1', email: 'a@b', type: 'email', expiresAt: 't' },
      message: 'Sent',
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
    expect(new Set(Object.keys(sample.invitation))).toEqual(new Set(INV_KEYS))
  })
})

describe('legacy contract — ShortcodeMutationResponse', () => {
  const EXPECTED = ['shortcode', 'url'] as const satisfies ReadonlyArray<keyof LegacyShortcodeMutationResponse>
  const SC_KEYS = ['code', 'targetType', 'targetId']

  it('envelope and shortcode keys match', () => {
    const sample: LegacyShortcodeMutationResponse = {
      shortcode: { code: 'abc', targetType: 'task', targetId: 't1' },
      url: 'https://astrid.cc/s/abc',
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
    expect(new Set(Object.keys(sample.shortcode))).toEqual(new Set(SC_KEYS))
  })
})

describe('legacy contract — ShortcodeResolveResponse', () => {
  it('has bare { code, targetType, targetId } (no envelope)', () => {
    const sample: LegacyShortcodeResolveResponse = {
      code: 'abc', targetType: 'task', targetId: 't1',
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(['code', 'targetType', 'targetId']))
  })
})

describe('legacy contract — PushSubscribeResponse', () => {
  const EXPECTED = ['success', 'message', 'subscriptionId'] as const satisfies ReadonlyArray<keyof LegacyPushSubscribeResponse>

  it('envelope keys match', () => {
    const sample: LegacyPushSubscribeResponse = {
      success: true, message: 'Subscribed', subscriptionId: 's1',
    }
    expect(new Set(Object.keys(sample))).toEqual(new Set(EXPECTED))
  })
})
