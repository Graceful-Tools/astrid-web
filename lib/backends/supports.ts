/**
 * `list.supports` on the v1 wire (spec §11.2): what a list's backend can do
 * that a client would otherwise have to guess from `backend`. Every key is at
 * its classic value on a local list. It grows a key as each capability lands;
 * `multipleAssignees` is the first (AWTD-1190).
 */

/** The value of TaskList.backend for a GitHub Project. Also lib/backends/resolve.ts, which cannot be imported client-side. */
const GITHUB_PROJECT = 'github_project'

export interface ListSupports {
  /** A task here may hold several assignees (`assigneeIds`). Classic lists keep at most one. */
  multipleAssignees: boolean
}

export function listSupports(list: { backend?: string | null }): ListSupports {
  return { multipleAssignees: list.backend === GITHUB_PROJECT }
}
