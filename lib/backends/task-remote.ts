/**
 * `remote` and `syncState` on a v1 task (AWTD-1222, spec §11.2).
 *
 * Present only on a GitHub-backed task. A classic task carries neither, and
 * not the raw columns behind them either: absent already means classic, and
 * the full task response sits close to its payload budget.
 *
 * Pure, so every surface that shapes a task draws the same chip.
 */

import { GITHUB_WEB_URL } from '@/lib/github/host'

export interface TaskRemote {
  kind: string
  /** The issue or pull request on GitHub. Null for a draft, which has no page of its own. */
  url: string | null
  nodeId: string
  /** The content's updatedAt: the base a body edit is checked against (§8.7). */
  version: string | null
  /** "owner/repo" and the number, for a `repo#N` chip. Null for a draft. */
  repo: string | null
  number: number | null
}

/** 'pending' while a write-through is half done and a writeback job is finishing it (§8.5). */
export type TaskSyncState = 'synced' | 'pending' | 'error'

interface RemoteColumns {
  remoteNodeId?: string | null
  remoteKind?: string | null
  remoteVersion?: string | null
  /** "owner/repo#N" on an issue or pull request (lib/github/projects/apply.ts). */
  identifier?: string | null
  syncState?: string | null
}

const REPO_NUMBER = /^([^/\s#]+\/[^/\s#]+)#(\d+)$/
const PATH: Record<string, string> = { issue: 'issues', pull_request: 'pull' }

export function taskRemoteFields(task: RemoteColumns): { remote?: TaskRemote; syncState?: TaskSyncState } {
  if (!task.remoteNodeId) return {}
  const kind = task.remoteKind ?? 'issue'
  const match = PATH[kind] ? REPO_NUMBER.exec(task.identifier ?? '') : null
  const repo = match?.[1] ?? null
  const number = match ? Number(match[2]) : null
  return {
    remote: {
      kind,
      url: match ? `${GITHUB_WEB_URL}/${repo}/${PATH[kind]}/${number}` : null,
      nodeId: task.remoteNodeId,
      version: task.remoteVersion ?? null,
      repo,
      number,
    },
    syncState: (task.syncState as TaskSyncState | null) ?? 'synced',
  }
}

/** A task row for the wire: the raw remote columns out, `remote` and `syncState` in where they apply. */
export function withTaskRemote<T extends RemoteColumns>(
  task: T,
): Omit<T, 'remoteNodeId' | 'remoteKind' | 'remoteVersion' | 'syncState'> & ReturnType<typeof taskRemoteFields> {
  const { remoteNodeId: _nodeId, remoteKind: _kind, remoteVersion: _version, syncState: _syncState, ...rest } = task
  return { ...rest, ...taskRemoteFields(task) }
}
