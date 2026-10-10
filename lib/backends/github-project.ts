/**
 * The backend for tasks on a list bound to a GitHub Project (AWTD-1151, P4c).
 *
 * P4 is a read-only mirror (docs/specs/GITHUB_PROJECTS_WHITELABEL.md §14): the
 * replica follows GitHub through the sync engine, which writes it directly,
 * not through here. An edit made IN Astrid would only be overwritten by the
 * next hydration, so until write-through (P5) every edit is refused, with a
 * code clients can recognise, rather than accepted and silently lost.
 */

import type { TaskBackend } from './types'

/** The refusal's error code. Stable: clients match on it. */
export const GITHUB_PROJECT_READ_ONLY = 'github_project_read_only'

const refuse = async () => ({ ok: false as const, status: 403 as const, error: GITHUB_PROJECT_READ_ONLY })

export const githubProjectTaskBackend: TaskBackend = {
  kind: 'github_project',
  createTask: refuse,
  updateTask: refuse,
  deleteTask: refuse,
}
