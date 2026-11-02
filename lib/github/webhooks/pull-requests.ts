/**
 * Pull requests and their reviews, on the task that caused them (AWTD-1492).
 *
 * In the /starthere setup an agent opens a PR for its task and GitHub asks
 * Copilot to review it. None of that reached Astrid: the `pull_request`
 * handler only updated the hosted coding workflow's own rows, and nothing
 * listened for reviews at all — so the owner had to open GitHub to learn
 * whether a PR was reviewed, approved or blocked.
 *
 * Now a PR that names a task — its identifier (AWTD-123) in the branch, title
 * or body, or a link to it — gets a comment on that task when it is opened,
 * reviewed, merged or closed.
 *
 * Two rules keep this safe and quiet:
 * - **The repo must be the task's.** A task is only commented on when one of
 *   its lists is linked to the PR's repository. A stranger's public PR that
 *   happens to say "AWTD-1" reaches nothing.
 * - **Each event lands once.** The comment carries a remoteNodeId (unique), so
 *   a redelivered webhook is a no-op rather than a second comment.
 *
 * The comment is attributed to the GitHub login (remoteAuthorLogin, no Astrid
 * author), the same way the Projects mirror shows a GitHub comment.
 *
 * Pure: what a PR names and what each event says. The write — resolving tasks,
 * scoping them to the repo, inserting once — is services/github-pull-requests.service.ts.
 */

import { parseIdentifier } from '@/lib/task-identifier-core'

/** A PR naming more tasks than this is a changelog, not a task's PR. */
export const MAX_TASK_REFS = 5
/** Review bodies can be long; the task gets the start and a link. */
export const REVIEW_EXCERPT_CHARS = 1200

const IDENTIFIER_TOKEN = /\b([A-Za-z][A-Za-z0-9]{1,4}-\d+)\b/g
const TASK_URL_UUID = /\/tasks?\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi

/**
 * The task references in a PR, in the order they appear: identifiers in the
 * branch, title and body, and task links (/task/<uuid>, /tasks/<uuid>).
 * Deduplicated, capped at MAX_TASK_REFS. Pure.
 *
 * Over-matching is harmless — "SHA-256" parses as an identifier and then
 * matches no task — because every reference is resolved, and scoped to the
 * repo, before anything is written.
 */
export function taskReferencesInPullRequest(pr: {
  branch?: string | null
  title?: string | null
  body?: string | null
}): string[] {
  const refs: string[] = []
  const add = (ref: string) => {
    if (!refs.includes(ref) && refs.length < MAX_TASK_REFS) refs.push(ref)
  }
  for (const text of [pr.branch, pr.title, pr.body]) {
    if (!text) continue
    for (const match of text.matchAll(TASK_URL_UUID)) add(match[1].toLowerCase())
    for (const match of text.matchAll(IDENTIFIER_TOKEN)) {
      const parsed = parseIdentifier(match[1])
      if (parsed) add(`${parsed.key}-${parsed.sequence}`)
    }
  }
  return refs
}

export interface PullRequestShape {
  number: number
  title: string
  html_url: string
  node_id: string
  merged?: boolean | null
  closed_at?: string | null
  updated_at?: string | null
  head?: { ref?: string | null } | null
  base?: { ref?: string | null } | null
  body?: string | null
  user?: { login?: string | null } | null
  merged_by?: { login?: string | null } | null
}

export interface ReviewShape {
  node_id: string
  state: string
  body?: string | null
  html_url?: string | null
  user?: { login?: string | null } | null
}

export interface PullRequestTaskComment {
  /** Unique per event; suffixed with the task id when written. */
  key: string
  login: string
  content: string
}

const REVIEW_VERDICT: Record<string, string> = {
  approved: 'approved',
  changes_requested: 'requested changes on',
  commented: 'reviewed',
  dismissed: 'dismissed a review on',
}

function prLink(pr: PullRequestShape): string {
  return `[#${pr.number} ${pr.title.replace(/[[\]]/g, '')}](${pr.html_url})`
}

/**
 * What one webhook says on the task, or null when the event is not one worth a
 * comment (a push to the PR, a label, an empty "commented" review). Pure.
 */
export function pullRequestEventComment(
  event: string,
  payload: { action?: string; pull_request?: PullRequestShape; review?: ReviewShape },
): PullRequestTaskComment | null {
  const pr = payload.pull_request
  if (!pr) return null

  if (event === 'pull_request') {
    const author = pr.user?.login ?? 'ghost'
    switch (payload.action) {
      case 'opened':
        return { key: `astrid:pr:${pr.node_id}:opened`, login: author, content: `Opened pull request ${prLink(pr)}.` }
      case 'reopened':
        return { key: `astrid:pr:${pr.node_id}:reopened:${pr.updated_at ?? ''}`, login: author, content: `Reopened pull request ${prLink(pr)}.` }
      case 'closed':
        if (pr.merged) {
          const by = pr.merged_by?.login ?? author
          return {
            key: `astrid:pr:${pr.node_id}:merged`,
            login: by,
            content: `Merged pull request ${prLink(pr)} into \`${pr.base?.ref ?? 'the base branch'}\`.`,
          }
        }
        return {
          key: `astrid:pr:${pr.node_id}:closed:${pr.closed_at ?? pr.updated_at ?? ''}`,
          login: author,
          content: `Closed pull request ${prLink(pr)} without merging.`,
        }
      default:
        return null
    }
  }

  if (event === 'pull_request_review' && payload.action === 'submitted' && payload.review) {
    const review = payload.review
    const state = review.state.toLowerCase()
    const body = (review.body ?? '').trim()
    // A bare "commented" review is the container for line comments; the
    // verdict-less shell says nothing on its own.
    if (state === 'commented' && !body) return null
    const verdict = REVIEW_VERDICT[state] ?? 'reviewed'
    const excerpt =
      body.length > REVIEW_EXCERPT_CHARS ? `${body.slice(0, REVIEW_EXCERPT_CHARS).trimEnd()}…` : body
    const link = review.html_url ? `\n\n[Read the full review](${review.html_url})` : ''
    return {
      key: review.node_id,
      login: review.user?.login ?? 'ghost',
      content: `${capitalize(verdict)} pull request ${prLink(pr)}.${excerpt ? `\n\n${quote(excerpt)}` : ''}${link}`,
    }
  }

  return null
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function quote(text: string): string {
  return text.split('\n').map(line => `> ${line}`).join('\n')
}
