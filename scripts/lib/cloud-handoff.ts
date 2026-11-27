import { agentEmail } from '@/lib/brand/agent-emails'
import { FIXALL_HARNESS_MAILBOXES, isAwaitingDeployLane, parseBlockedConditions } from '@/lib/ready-queue-scope'

export interface CloudHandoffTask {
  identifier?: string | null
  completed?: boolean
  statusRole?: string | null
  assignee?: { id?: string; email?: string | null } | null
  lists?: Array<{ id: string }>
}
export interface CloudHandoffComment {
  authorId?: string | null
  content?: string | null
  createdAt?: string | null
}

/**
 * The mailbox an `agent/<who>/` branch belongs to. `<who>` is the harness
 * selector (`claude-code`) or its mailbox (`claude`); agents write both, and
 * run 40973959090's handoff went unregistered over that (AWTD-1416).
 */
export function branchMailbox(who: string): string | undefined {
  const key = who.toLowerCase()
  if (key in FIXALL_HARNESS_MAILBOXES) return FIXALL_HARNESS_MAILBOXES[key]
  return Object.values(FIXALL_HARNESS_MAILBOXES).includes(key) ? key : undefined
}

/**
 * Whether the task's report hands work to the deploy (`AWAITING-DEPLOY:`), so a
 * pushed branch must exist. A task closed with no code claims nothing, and its
 * missing branch is not a failure (AWTD-1416).
 */
/**
 * An agent's task branch: `agent/<mailbox or harness>/<task id>-…`.
 *
 * Any board prefix, because a task keeps its id when it moves boards: "Non repeating tasks
 * say 'never'" is AITD-582 on the web board, and spelling the id AWTD-only refused its
 * handoff and its landing (run 41621632959, PR #663). Safe to widen only because this shape
 * is matched at the start of an `agent/` branch, never anywhere in a name: a
 * `dependabot/…/prisma-7.10.0` branch is not an id. Every caller then requires the id to be
 * the task's own on the board (cloudHandoffEligible).
 */
export const AGENT_BRANCH = /^agent\/([^/]+)\/([A-Z][A-Z0-9]*-\d+)(?:$|[-/])/i

/** The task id an agent branch names, uppercased, or null for any other branch. */
export function agentBranchTaskId(branch: string): string | null {
  const id = AGENT_BRANCH.exec(branch)?.[2]
  return id ? id.toUpperCase() : null
}

export function claimsCloudHandoff(comments: CloudHandoffComment[]): boolean {
  return Boolean(parseBlockedConditions(comments).awaitingDeploy)
}

/**
 * A handoff for a fix that an earlier PR already merged: the marker names a commit on main, so
 * there is no branch to open and nothing is broken. land-and-deploy completes the task once
 * production serves that commit. `onMain` is `git merge-base --is-ancestor <sha> origin/main`.
 */
export function handoffAlreadyOnMain(comments: CloudHandoffComment[], onMain: (sha: string) => boolean): boolean {
  const sha = parseBlockedConditions(comments).awaitingDeploy
  return Boolean(sha) && onMain(sha as string)
}

/**
 * May the runner release this agent branch to the ship workflow? Only for a live
 * handoff: the task is incomplete, still in Doing (or the optional Testing column —
 * finished work awaiting its deploy stays there, R6), assigned to the branch's agent,
 * on the board, and that agent's latest marker names exactly the pushed head.
 */
export function cloudHandoffEligible(input: {
  branch: string
  headSha: string
  listId: string
  task: CloudHandoffTask
  comments: CloudHandoffComment[]
}): boolean {
  const { task, comments, branch, headSha, listId } = input
  const parts = AGENT_BRANCH.exec(branch)
  const mailbox = parts && branchMailbox(parts[1])
  if (!mailbox || !parts || parts[2].toUpperCase() !== task.identifier?.toUpperCase() ||
      !/^[0-9a-f]{40}$/.test(headSha) || !isAwaitingDeployLane(task) ||
      task.assignee?.email?.toLowerCase() !== agentEmail(mailbox) || !task.assignee?.id ||
      !task.lists?.some(list => list.id === listId)) return false
  return parseBlockedConditions(comments).awaitingDeploy === headSha &&
    parseBlockedConditions(comments.filter(comment => comment.authorId === task.assignee?.id)).awaitingDeploy === headSha
}

/**
 * Which of a branch's PRs is the handoff (ADEV-338). `gh pr list --head <branch> --state all`
 * lists a closed PR from an earlier attempt as readily as the open one, and the runner took
 * the first: ADEV-306's agent updated its open PR at the recorded sha, an older closed one
 * sorted first, and the check failed the run (exit 3). The open, main-targeted PR at the
 * recorded sha wins; then any open PR on the branch; then the first, so a branch with only a
 * stale PR is still refused.
 */
export function pickHandoffPr<T extends { state: string; baseRefName: string; headRefOid: string }>(
  prs: readonly T[],
  awaitingSha: string | null | undefined,
): T | undefined {
  return (
    prs.find(pr => pr.state === 'OPEN' && pr.baseRefName === 'main' && pr.headRefOid === awaitingSha) ??
    prs.find(pr => pr.state === 'OPEN') ??
    prs[0]
  )
}
