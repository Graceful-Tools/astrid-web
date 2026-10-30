import { agentEmail } from '@/lib/brand/agent-emails'
import { FIXALL_HARNESS_MAILBOXES, parseBlockedConditions } from '@/lib/ready-queue-scope'

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
function branchMailbox(who: string): string | undefined {
  const key = who.toLowerCase()
  if (key in FIXALL_HARNESS_MAILBOXES) return FIXALL_HARNESS_MAILBOXES[key]
  return Object.values(FIXALL_HARNESS_MAILBOXES).includes(key) ? key : undefined
}

/**
 * Whether the task's report hands work to the deploy (`AWAITING-DEPLOY:`), so a
 * pushed branch must exist. A task closed with no code claims nothing, and its
 * missing branch is not a failure (AWTD-1416).
 */
export function claimsCloudHandoff(comments: CloudHandoffComment[]): boolean {
  return Boolean(parseBlockedConditions(comments).awaitingDeploy)
}

export function cloudHandoffEligible(input: {
  branch: string
  headSha: string
  listId: string
  task: CloudHandoffTask
  comments: CloudHandoffComment[]
}): boolean {
  const { task, comments, branch, headSha, listId } = input
  const parts = /^agent\/([^/]+)\/(AWTD-\d+)(?:$|[-/])/i.exec(branch)
  const mailbox = parts && branchMailbox(parts[1])
  if (!mailbox || !parts || parts[2].toUpperCase() !== task.identifier?.toUpperCase() ||
      !/^[0-9a-f]{40}$/.test(headSha) || task.completed || task.statusRole !== 'waiting' ||
      task.assignee?.email?.toLowerCase() !== agentEmail(mailbox) || !task.assignee?.id ||
      !task.lists?.some(list => list.id === listId)) return false
  return parseBlockedConditions(comments).awaitingDeploy === headSha &&
    parseBlockedConditions(comments.filter(comment => comment.authorId === task.assignee?.id)).awaitingDeploy === headSha
}
