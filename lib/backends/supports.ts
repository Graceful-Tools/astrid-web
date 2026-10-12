/**
 * `list.supports` on the v1 wire (spec §11.2): what a list's backend can do
 * that a client would otherwise have to guess from `backend`. Every key is at
 * its classic value on a local list. It grows a key as each capability lands;
 * `multipleAssignees` was the first (AWTD-1190), `repeatMode` the second
 * (AWTD-1118), `fields` the third (AWTD-1208).
 */

import type { RepeatMode } from '@/lib/github/projects/recur'

/** The value of TaskList.backend for a GitHub Project. Also lib/backends/resolve.ts, which cannot be imported client-side. */
const GITHUB_PROJECT = 'github_project'

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
}

export function listSupports(list: { backend?: string | null }): ListSupports {
  const github = list.backend === GITHUB_PROJECT
  return {
    multipleAssignees: github,
    repeatMode: github ? 'spawn' : 'roll_forward',
    fields: github,
  }
}
