/**
 * astrid-core work handed off by a cloud run, and landed by the ship workflow (AWTD-1682).
 *
 * Jon, 2026-11-15: core work belongs to the web and iOS loops (docs/FIXALL_WORKFLOW.md →
 * *astrid-core is worked by web and iOS*). The web board's unattended worker is
 * `agent-run.yml`, so a `[core]` task there is fixed in the sibling astrid-core checkout and
 * its PR is opened on astrid-core.
 *
 * astrid-core has no deploy, so merged to `main` is done. The handoff therefore says which PR
 * it waits on, not which commit production must serve:
 *
 *   AWAITING-MERGE: Graceful-Tools/astrid-core#<n> <full head sha>
 *
 * `scripts/land-and-deploy.ts --core-repo` merges an eligible PR (at most `--max-land` a tick)
 * and completes every task whose PR is merged at its recorded head, whoever merged it.
 *
 * Pure functions over fetched data, as in land-and-deploy's own lib, so the rules are tested
 * without a network: tests/scripts/core-landing.test.ts.
 */
import { agentEmail } from '@/lib/brand/agent-emails'
import { isAwaitingDeployLane, parseBlockedConditions } from '@/lib/ready-queue-scope'
import { AGENT_BRANCH, branchMailbox, type CloudHandoffComment, type CloudHandoffTask } from './cloud-handoff'
import { landablePullRequests, type LandDecision, type PullRequestSummary } from './land-and-deploy'

/** The core repository the web board's cloud worker opens PRs on. */
export const CORE_REPO = 'Graceful-Tools/astrid-core'

export interface AwaitingMerge {
  repo: string
  number: number
  sha: string
}

// A line of its own, like AWAITING-DEPLOY: prose that mentions the marker is not one.
const AWAITING_MERGE_LINE = /^\s*awaiting-merge:\s*([\w.-]+\/[\w.-]+)#(\d+)\s+([0-9a-f]{7,40})\b/i

/** The marker a comment carries, or null. The last such line in the comment wins. */
export function parseAwaitingMerge(content: string | null | undefined): AwaitingMerge | null {
  let found: AwaitingMerge | null = null
  for (const line of (content ?? '').split('\n')) {
    const match = AWAITING_MERGE_LINE.exec(line)
    if (match) found = { repo: match[1], number: Number(match[2]), sha: match[3].toLowerCase() }
  }
  return found
}

/** The line a run ends its report with. One place, so the docs and the parser agree. */
export function awaitingMergeMarker(handoff: AwaitingMerge): string {
  return `AWAITING-MERGE: ${handoff.repo}#${handoff.number} ${handoff.sha}`
}

export type Handoff = ({ kind: 'merge' } & AwaitingMerge) | { kind: 'deploy'; sha: string }

const time = (value: string | Date | null | undefined) => {
  const at = value ? new Date(value).getTime() : NaN
  return Number.isNaN(at) ? 0 : at
}

/**
 * The task's current handoff: the newest comment carrying either marker. A web
 * `AWAITING-DEPLOY` after a core `AWAITING-MERGE` replaces it, and the other way round,
 * so a task never waits on two things at once.
 */
export function latestHandoff(
  comments: Array<{ content?: string | null; createdAt?: string | Date | null }>,
): Handoff | null {
  const newestFirst = [...comments].sort((a, b) => time(b.createdAt) - time(a.createdAt))
  for (const comment of newestFirst) {
    const merge = parseAwaitingMerge(comment.content)
    if (merge) return { kind: 'merge', ...merge }
    const deploy = parseBlockedConditions([{ content: comment.content ?? '' }]).awaitingDeploy
    if (deploy) return { kind: 'deploy', sha: deploy }
  }
  return null
}

/**
 * ADEV-266: finished work whose assignee went missing. The ship job needs the assignee's own
 * current marker, and two core handoffs lost the assignee after the marker (ADEV-263 was
 * "reassigned from Claude Agent to Unassigned" ten seconds after it). Whatever did it, the
 * marker's author is still on record: when the task is open in Doing/Testing with nobody on it
 * and the newest handoff comment was written by `agentId`, that agent owns it again.
 */
export function orphanedHandoffOwner(input: {
  task: CloudHandoffTask
  comments: Array<{ authorId?: string | null; content?: string | null; createdAt?: string | Date | null }>
  agentId: string | null
}): boolean {
  const { task, comments, agentId } = input
  if (!agentId || task.assignee?.id || !isAwaitingDeployLane(task)) return false
  const newest = [...comments]
    .filter(comment => latestHandoff([comment]))
    .sort((a, b) => time(b.createdAt) - time(a.createdAt))[0]
  return newest?.authorId === agentId
}

/** A core PR as `gh pr list --repo <core> --json` reports it. */
export interface CorePullRequest extends PullRequestSummary {
  baseRefName?: string
}

/**
 * May the ship workflow merge this core PR? The web rule (cloudHandoffEligible) with the
 * core marker: an agent branch naming the task, the task incomplete in Doing or Testing,
 * assigned to that branch's agent, on the board, and both the newest handoff overall and
 * the assignee's own newest handoff name exactly this repo, this PR and its full head sha.
 */
export function coreHandoffEligible(input: {
  repo: string
  pr: CorePullRequest
  listId: string
  task: CloudHandoffTask
  comments: CloudHandoffComment[]
}): boolean {
  const { repo, pr, listId, task, comments } = input
  const parts = AGENT_BRANCH.exec(pr.headRefName)
  const mailbox = parts && branchMailbox(parts[1])
  const head = pr.headRefOid ?? ''
  if (!parts || !mailbox || parts[2].toUpperCase() !== task.identifier?.toUpperCase() ||
      !/^[0-9a-f]{40}$/.test(head) || pr.baseRefName !== 'main' || !isAwaitingDeployLane(task) ||
      task.assignee?.email?.toLowerCase() !== agentEmail(mailbox) || !task.assignee?.id ||
      !task.lists?.some(list => list.id === listId)) return false
  const names = (handoff: Handoff | null) =>
    handoff?.kind === 'merge' && handoff.repo.toLowerCase() === repo.toLowerCase() &&
    handoff.number === pr.number && handoff.sha === head
  return names(latestHandoff(comments)) &&
    names(latestHandoff(comments.filter(comment => comment.authorId === task.assignee?.id)))
}

/**
 * Which core PRs to land. A core PR carries no runner marker in its body (the runner never
 * edits a core PR), so the board handoff is the only permission, and a branch that is not
 * an agent's is refused here before landablePullRequests' marker-free rules could take it.
 */
export function landableCorePullRequests(prs: CorePullRequest[], options: { only?: number[] } = {}): LandDecision {
  const skipped: LandDecision['skipped'] = []
  const candidates = prs.filter(pr => {
    if (!AGENT_BRANCH.test(pr.headRefName) || pr.baseRefName !== 'main') {
      skipped.push({ number: pr.number, why: `not an agent handoff into main (${pr.headRefName})` })
      return false
    }
    return true
  })
  const decision = landablePullRequests(candidates, { requireRunnerMarker: false, only: options.only })
  return { land: decision.land, skipped: [...skipped, ...decision.skipped] }
}

/** A Doing (or Testing) task whose current handoff is AWAITING-MERGE. */
export interface AwaitingMergeTask extends AwaitingMerge {
  id: string
  identifier?: string | null
}

export interface CorePullRequestState {
  state: string
  headRefOid?: string | null
  mergeCommit?: { oid?: string | null } | null
}

/**
 * Which awaiting-merge tasks are done: their PR is MERGED, at the head the marker recorded.
 * A PR merged after more commits were pushed is not the work that was handed off, so its
 * task waits for a person, as a squash-merged web PR does.
 */
export function coreTasksMerged(input: {
  awaiting: AwaitingMergeTask[]
  pullRequest: (repo: string, number: number) => CorePullRequestState | null
}): { done: Array<AwaitingMergeTask & { mergeSha: string }>; waiting: Array<{ task: AwaitingMergeTask; why: string }> } {
  const done: Array<AwaitingMergeTask & { mergeSha: string }> = []
  const waiting: Array<{ task: AwaitingMergeTask; why: string }> = []
  for (const task of input.awaiting) {
    const pr = input.pullRequest(task.repo, task.number)
    const mergeSha = pr?.mergeCommit?.oid
    if (!pr) waiting.push({ task, why: 'its PR could not be read' })
    else if (pr.state !== 'MERGED') waiting.push({ task, why: `its PR is ${pr.state.toLowerCase()}` })
    else if ((pr.headRefOid ?? '').toLowerCase() !== task.sha) {
      waiting.push({ task, why: `its PR merged at ${(pr.headRefOid ?? '?').slice(0, 8)}, not the handed-off ${task.sha.slice(0, 8)}` })
    } else if (!mergeSha) waiting.push({ task, why: 'its PR reports no merge commit' })
    else done.push({ ...task, mergeSha })
  }
  return { done, waiting }
}

/** The comment that completes a core task. It must not carry a marker line itself. */
export function mergedCompletionComment(input: { repo: string; number: number; sha: string; mergeSha: string }): string {
  return (
    `✅ Merged: ${input.repo}#${input.number} landed as merge commit \`${input.mergeSha}\` ` +
    `(handed-off head \`${input.sha.slice(0, 8)}\`). astrid-core has no deploy, so merged is done; ` +
    'consumers take it with a pin bump. Marked complete by the runner (scripts/land-and-deploy.ts).'
  )
}
