/**
 * RED for task 72717eff — the /list/[id] page stored the v1 envelope instead of
 * the list, so the chat-eligibility fallback in TaskManager never matched.
 *
 * GET /api/v1/lists/:id returns `{ list, meta }`. The page did
 * `setListData(await response.json())`, handing TaskManager the envelope.
 * TaskManager's fallback reads `listMetadata.id`, which on an envelope is
 * undefined and therefore never equals the selected id — so the fallback
 * silently yielded null for every list.
 *
 * That matters because of which way it fails. `userCanRequestListChatChannel`
 * treats a null list as "no information, allow it":
 *
 *     if (!list) return true
 *
 * So the eligibility rules were not being consulted at all for a list reached
 * by direct link and not already loaded — the branch defaulted open rather
 * than closed. Exactly the "reads undefined and takes a silently wrong branch"
 * this task was filed about.
 *
 * The test targets the seam that decides it, rather than mounting the page:
 * the eligibility helper's contract with the shape the page passes down.
 */

import { describe, it, expect } from 'vitest'
import { userCanRequestListChatChannel } from '@/lib/chat-channel-eligibility'
import { unwrapList } from '@/lib/v1-response'

/** Exactly what GET /api/v1/lists/:id sends. */
const v1Body = {
  list: {
    id: 'list-1',
    name: 'Someone else\'s private list',
    privacy: 'PRIVATE',
    ownerId: 'owner-1',
    listMembers: [],
  },
  meta: { apiVersion: 'v1', authSource: 'session' },
}

/** TaskManager's fallback, reproduced. */
function resolveListForChat(listMetadata: unknown, selectedId: string) {
  return listMetadata && (listMetadata as { id?: string }).id === selectedId
    ? (listMetadata as { id: string })
    : null
}

describe('list page → chat eligibility (task 72717eff)', () => {
  it('the raw envelope never matches the selected list id', () => {
    // This is the bug, stated as a fact about the data rather than a behaviour:
    // the envelope has no `id` of its own.
    expect(resolveListForChat(v1Body, 'list-1')).toBeNull()
  })

  it('and a null list makes eligibility default OPEN, not closed', () => {
    // So the failure is permissive. The rules are skipped rather than applied.
    expect(userCanRequestListChatChannel(null, 'stranger-1')).toBe(true)
  })

  it('the unwrapped list DOES match, and is then judged on its merits', () => {
    const list = unwrapList(v1Body as never)

    expect(resolveListForChat(list, 'list-1')).not.toBeNull()
    // A stranger on someone else's private list is refused once the rules
    // actually see the list.
    expect(userCanRequestListChatChannel(list as never, 'stranger-1')).toBe(false)
  })

  it('unwrapping is safe for a body that is already a bare list', () => {
    // Guards the fix itself: unwrapList must not break callers that were
    // already handing it an unwrapped object.
    const bare = { id: 'list-1', name: 'Bare', privacy: 'PRIVATE', ownerId: 'owner-1' }

    expect(unwrapList(bare as never)).toMatchObject({ id: 'list-1' })
  })
})
