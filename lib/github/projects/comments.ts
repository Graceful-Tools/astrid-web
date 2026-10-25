/**
 * Comments made on github.com → the mirrored Astrid task (AWTD-1283). Spec:
 * docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.7. Pure, like agent-labels.ts:
 *
 *   commentSyncDedupeKey(id, now)    one re-read per comment per 2s burst
 *   REMOTE_COMMENT_QUERY             what the job asks GitHub
 *   parseRemoteComment(data)         its answer, or null when the comment is gone
 *   planInboundComment(...)          create, update, adopt, delete or nothing
 *
 * The `issue_comment` webhook is a trigger, never data — the same rule as
 * `projects_v2_item` — so created, edited and deleted are one path: read the
 * comment again, and make the replica match what GitHub says now. A comment
 * GitHub no longer returns was deleted.
 *
 * Echo suppression. Astrid's own comments reach GitHub too (the `comment` job)
 * and come back as `issue_comment` events, so three things keep them from
 * returning as duplicates:
 *   1. the push records the node id GitHub answers, so the echo matches it;
 *   2. anything the App itself wrote (`viewerDidAuthor` on the installation
 *      token — an agent's comment, prefixed) is the mirror's own and is skipped;
 *   3. a person's push whose echo is read before its id was recorded is ADOPTED:
 *      their unlinked comment on that task, same text, made within ADOPT_WINDOW_MS.
 */

import { COALESCE_WINDOW_MS } from './jobs'

/** How recent an unlinked Astrid comment must be to be the echo of its own push. */
export const ADOPT_WINDOW_MS = 10 * 60_000

/** What an `issue_comment` sync job carries. */
export interface IssueCommentPayload {
  commentNodeId: string
}

export function commentSyncDedupeKey(commentNodeId: string, now: number): string {
  return `issue_comment:${commentNodeId}:${Math.floor(now / COALESCE_WINDOW_MS)}`
}

/**
 * A conversation comment on an issue or a pull request. A PR's comment names
 * the PR as `pullRequest` — whose node id is what a PR task stores — and an
 * issue-shaped twin of it as `issue`, so the PR wins.
 */
export const REMOTE_COMMENT_QUERY = `query($id: ID!) {
  node(id: $id) {
    ... on IssueComment {
      id
      body
      createdAt
      viewerDidAuthor
      author { __typename login ... on User { id } }
      issue { id }
      pullRequest { id }
    }
  }
}`

export interface RemoteComment {
  nodeId: string
  /** The issue's or the PR's node id: the task's `remoteNodeId`. */
  subjectNodeId: string
  body: string
  createdAt: Date
  /** Written by this App (as its bot): Astrid's own comment, never mirrored back. */
  viewerDidAuthor: boolean
  /** A GitHub user's node id; null for a bot or a deleted account ("ghost"). */
  authorNodeId: string | null
  authorLogin: string | null
}

interface RemoteCommentNode {
  id?: string
  body?: string
  createdAt?: string
  viewerDidAuthor?: boolean
  author?: { __typename?: string; login?: string; id?: string } | null
  issue?: { id?: string } | null
  pullRequest?: { id?: string } | null
}

/** Null when GitHub no longer has the comment — deleted, or no longer visible to the App. */
export function parseRemoteComment(data: { node?: RemoteCommentNode | null } | null | undefined): RemoteComment | null {
  const node = data?.node
  // node(id:) on an id of another type resolves to {}: not a comment.
  if (!node?.id || typeof node.body !== 'string') return null
  const subjectNodeId = node.pullRequest?.id ?? node.issue?.id
  if (!subjectNodeId) return null
  const author = node.author ?? null
  return {
    nodeId: node.id,
    subjectNodeId,
    body: node.body,
    createdAt: new Date(node.createdAt ?? Date.now()),
    viewerDidAuthor: Boolean(node.viewerDidAuthor),
    authorNodeId: author?.__typename === 'User' && author.id ? author.id : null,
    authorLogin: author?.login ?? null,
  }
}

/** The Astrid comment already mirroring this GitHub comment. */
export interface MirroredComment {
  id: string
  content: string
}

/** An Astrid comment that could be the not-yet-linked origin of an echo. */
export interface AdoptableComment {
  id: string
  authorId: string | null
  content: string
  createdAt: Date
}

export type InboundCommentPlan =
  | { kind: 'none' }
  | { kind: 'delete'; commentId: string }
  | { kind: 'update'; commentId: string; content: string }
  | { kind: 'adopt'; commentId: string }
  | {
      kind: 'create'
      content: string
      authorId: string | null
      /** Shown for an author with no Astrid identity. */
      remoteAuthorLogin: string | null
      createdAt: Date
    }

export function planInboundComment(args: {
  remote: RemoteComment | null
  mirrored: MirroredComment | null
  /** The Astrid user whose `githubNodeId` is the comment's author, if any. */
  authorId: string | null
  /** Unlinked comments on the task, for adopting an echo. Not read when `mirrored` is set. */
  candidates: readonly AdoptableComment[]
  now: Date
}): InboundCommentPlan {
  const { remote, mirrored } = args
  if (!remote) return mirrored ? { kind: 'delete', commentId: mirrored.id } : { kind: 'none' }
  if (mirrored) {
    return mirrored.content === remote.body ? { kind: 'none' } : { kind: 'update', commentId: mirrored.id, content: remote.body }
  }
  // The App's own writing: an agent's comment, already on the task.
  if (remote.viewerDidAuthor) return { kind: 'none' }

  if (args.authorId) {
    const echo = args.candidates.find(
      c =>
        c.authorId === args.authorId &&
        c.content.trim() === remote.body.trim() &&
        args.now.getTime() - c.createdAt.getTime() <= ADOPT_WINDOW_MS,
    )
    if (echo) return { kind: 'adopt', commentId: echo.id }
  }
  if (!remote.body.trim()) return { kind: 'none' }

  return {
    kind: 'create',
    content: remote.body,
    authorId: args.authorId,
    remoteAuthorLogin: args.authorId ? null : (remote.authorLogin ?? 'ghost'),
    createdAt: remote.createdAt,
  }
}
