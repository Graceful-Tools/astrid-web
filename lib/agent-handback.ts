import { latestCommentWatermark } from '@/lib/ready-queue-scope'

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

/** A reply resumes an explicit agent handback, never an unrelated human task. */
export function pendingAgentHandback(input: {
  task: HandbackTask
  agentId: string
  mailbox: string
  listId: string
}): AgentResumeContext | null {
  const { task, agentId, mailbox, listId } = input
  if (task.completed || task.statusRole !== 'waiting' || !task.assigneeId ||
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
