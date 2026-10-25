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

export function cloudHandoffEligible(input: {
  branch: string
  headSha: string
  listId: string
  task: CloudHandoffTask
  comments: CloudHandoffComment[]
}): boolean {
  const { task, comments, branch, headSha, listId } = input
  const parts = /^agent\/([^/]+)\/(AWTD-\d+)(?:$|[-/])/i.exec(branch)
  const mailbox = parts && FIXALL_HARNESS_MAILBOXES[parts[1]]
  if (!mailbox || !parts || parts[2].toUpperCase() !== task.identifier?.toUpperCase() ||
      !/^[0-9a-f]{40}$/.test(headSha) || task.completed || task.statusRole !== 'waiting' ||
      task.assignee?.email?.toLowerCase() !== agentEmail(mailbox) || !task.assignee?.id ||
      !task.lists?.some(list => list.id === listId)) return false
  return parseBlockedConditions(comments).awaitingDeploy === headSha &&
    parseBlockedConditions(comments.filter(comment => comment.authorId === task.assignee?.id)).awaitingDeploy === headSha
}
