/**
 * `list.supports` on the v1 wire (spec §11.2): what a list's backend can do
 * that a client would otherwise have to guess from `backend`. Every key is at
 * its classic value on a local list. It grows a key as each capability lands;
 * `multipleAssignees` was the first (AWTD-1190), `repeatMode` the second
 * (AWTD-1118), `fields` the third (AWTD-1208), and the rest came together
 * (AWTD-1222).
 */

import type { RepeatMode } from '@/lib/github/projects/recur'

/** The value of TaskList.backend for a GitHub Project. Also lib/backends/resolve.ts, which cannot be imported client-side. */
const GITHUB_PROJECT = 'github_project'

/** The part of a GitHub Project binding that decides what its list supports. */
export interface ListBindingSupport {
  priorityFieldId?: string | null
  dueFieldId?: string | null
}

export interface ListSupports {
  /** A task here may hold several assignees (`assigneeIds`). Classic lists keep at most one. */
  multipleAssignees: boolean
  /**
   * How a repeating task advances when it is completed (AWTD-1118, §10). On a
   * GitHub board the completed issue stays closed as history and the next
   * occurrence is a NEW issue linked to it, so a client must send the
   * completion and NOT roll the row forward itself — the successor arrives by
   * SSE or delta. A classic list rolls forward in place, as it always has.
   */
  repeatMode: RepeatMode
  /** `isPrivate` means something here. A GitHub board's tasks are as visible as the project is (§9.1). */
  privateTasks: boolean
  /** Members and invitations are managed in Astrid. On a GitHub board the roster is GitHub's. */
  membership: boolean
  /** Priority can be set. False on a GitHub board with no Priority field mapped: the write is refused (§9.2). */
  priority: boolean
  /** A due date can be set. False on a GitHub board with no date field mapped, for the same reason. */
  dueDate: boolean
  comments: boolean
  /**
   * Tasks on this list can carry `fields` — the project's own field values,
   * keyed by `ProjectField.id` (AWTD-1208, §9.4.3). The schema that explains
   * them is `GET /api/v1/projects/:id/fields`.
   *
   * True does NOT mean every payload carries them. List responses omit them
   * unless asked with `?include=fields`, because a thousand tasks carrying
   * eight fields adds 42.2 KiB to a response already over its wire budget; the
   * detail route always includes them. A client reads this key to know whether
   * asking is worth a round trip at all.
   */
  fields: boolean
  /** What deleting a task does: a GitHub board takes the item off the project and leaves the issue. */
  deleteTask: 'delete' | 'remove_from_list'
}

/**
 * `binding` is only read for a GitHub-backed list. Without one, such a list
 * reports priority and due as unsupported: that is what a write would find.
 */
export function listSupports(list: { backend?: string | null }, binding?: ListBindingSupport | null): ListSupports {
  const github = list.backend === GITHUB_PROJECT
  return {
    multipleAssignees: github,
    repeatMode: github ? 'spawn' : 'roll_forward',
    privateTasks: !github,
    membership: !github,
    priority: github ? Boolean(binding?.priorityFieldId) : true,
    dueDate: github ? Boolean(binding?.dueFieldId) : true,
    comments: true,
    fields: github,
    deleteTask: github ? 'remove_from_list' : 'delete',
  }
}
