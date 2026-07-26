import type { TaskList } from '@/types/task'
import { hasExplicitListRole } from "@/lib/list-permissions"

type ListChatFields = Pick<TaskList, 'id' | 'ownerId' | 'privacy' | 'publicListType'> & {
  listMembers?: { userId: string }[] | null
}

/**
 * Client-side mirror of POST /api/chat/channels access rules.
 * When list is unknown (null), returns true so the server can still authorize after load.
 */
export function userCanRequestListChatChannel(
  list: ListChatFields | null | undefined,
  userId: string | undefined
): boolean {
  if (!userId) return false
  if (!list) return true

  // Owner/admin/member via the canonical lookup (task e2803305).
  if (hasExplicitListRole({ id: userId }, list as never)) return true

  const pt = String(list.publicListType || '').toLowerCase()
  if (list.privacy === 'PUBLIC' && pt === 'collaborative') return true

  return false
}

/** virtual-chat:{userId}:{type} — userId must not contain colons (cuid/uuid safe). */
export function parseVirtualChatKey(virtualKey: string): { userId: string; type: string } | null {
  const m = virtualKey.match(/^virtual-chat:([^:]+):(.+)$/)
  if (!m) return null
  return { userId: m[1], type: m[2] }
}
