import { handbackMailboxOf, latestCommentWatermark } from '@/lib/ready-queue-scope'

export interface AgentResumeContext {
  listId: string
  assigneeId: string
  handbackCommentId: string
  replyCommentId: string
  commentWatermark: string
}

interface HandbackComment {
  id: string
  authorId: string | null
  author?: { isAIAgent: boolean } | null
  content: string
  createdAt: Date
  updatedAt: Date
}

export interface HandbackTask {
  completed: boolean
  statusRole: string | null
  assigneeId: string | null
  assignee: { isAIAgent: boolean } | null
  lists: Array<{ id: string }>
  comments: HandbackComment[]
}

/**
 * A reply resumes an explicit agent handback, never an unrelated human task.
 *
 * A handback is "waiting on a person to act on this task", which is not
 * Waiting: it is the Inbox (no status), assigned to that person — astrid-core's
 * `handBack` shape (R4). Waiting holds only tasks waiting on a date or a task.
 */
export function pendingAgentHandback(input: {
  task: HandbackTask
  agentId: string
  mailbox: string
  listId: string
}): AgentResumeContext | null {
  const { task, agentId, mailbox, listId } = input
  if (task.completed || task.statusRole !== null || !task.assigneeId ||
      !task.assignee || task.assignee.isAIAgent || !task.lists.some(list => list.id === listId)) return null

  const authored = task.comments.filter(comment => comment.authorId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const reply = authored[0]
  const question = authored.find(comment => comment.author?.isAIAgent)
  if (!reply || reply.authorId !== task.assigneeId || reply.author?.isAIAgent !== false ||
      !question || question.authorId !== agentId || reply.createdAt <= question.createdAt ||
      reply.createdAt < question.updatedAt) return null
  if (!question.content.split(/\r?\n/).some(line => line.trim() === `AGENT-HANDBACK: ${mailbox}`)) return null

  const watermark = latestCommentWatermark(task.comments.map(comment => ({
    createdAt: comment.createdAt.toISOString(), updatedAt: comment.updatedAt.toISOString(),
  })))
  if (!watermark) return null
  return { listId, assigneeId: task.assigneeId, handbackCommentId: question.id,
    replyCommentId: reply.id, commentWatermark: watermark }
}

export interface AgentAnswer {
  questionCommentId: string
  answerCommentId: string
}

/**
 * Another agent answered this agent's recorded question (AWTD-1695).
 *
 * The question is this agent's newest comment, carrying `AGENT-HANDBACK: <its mailbox>`; the
 * answer is the newest authored comment on the task, written AFTER it by a different agent. A
 * person's reply is `pendingAgentHandback`'s, and this agent writing again (its next step, or the
 * next question) closes it, so one answer is attention once.
 */
export function pendingAgentAnswer(input: {
  comments: HandbackComment[]
  agentId: string
  mailbox: string
}): AgentAnswer | null {
  const { comments, agentId, mailbox } = input
  const authored = comments.filter(comment => comment.authorId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const answer = authored[0]
  const question = authored.find(comment => comment.authorId === agentId)
  if (!answer || !question || answer.authorId === agentId || answer.author?.isAIAgent !== true) return null
  if (handbackMailboxOf(question.content) !== mailbox.toLowerCase()) return null
  if (answer.createdAt <= question.createdAt || answer.createdAt < question.updatedAt) return null
  return { questionCommentId: question.id, answerCommentId: answer.id }
}

export function parseAgentResumeContext(value: unknown): AgentResumeContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resume context is required')
  const row = value as Record<string, unknown>
  const keys = ['listId', 'assigneeId', 'handbackCommentId', 'replyCommentId', 'commentWatermark'] as const
  for (const key of keys) {
    if (typeof row[key] !== 'string' || !row[key].trim()) throw new Error(`Resume context requires ${key}`)
  }
  if (!Number.isFinite(Date.parse(String(row.commentWatermark)))) throw new Error('Invalid resume comment watermark')
  return {
    listId: String(row.listId), assigneeId: String(row.assigneeId),
    handbackCommentId: String(row.handbackCommentId), replyCommentId: String(row.replyCommentId),
    commentWatermark: String(row.commentWatermark),
  }
}
