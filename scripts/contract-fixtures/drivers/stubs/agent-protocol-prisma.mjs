import { state } from './agent-protocol-state.mjs'

const prisma = {
  user: {
    async findUnique({ where, select }) {
      if (where?.email) {
        if (!state.claim.agentAvailable) return null
        return {
          id: 'agent-claude',
          email: where.email,
          name: 'Claude Agent',
          isAIAgent: true,
          isActive: true,
        }
      }
      if (where?.id && select?.mcpSettings) return { mcpSettings: state.mcpSettings }
      throw new Error(`agent-protocol fixture: unexpected user.findUnique ${JSON.stringify({ where, select })}`)
    },
  },
  task: {
    async findMany({ select }) {
      if (select?.isAllDay) return state.queue.tasks
      if (select?.comments) return state.queue.attention
      throw new Error(`agent-protocol fixture: unexpected task.findMany ${JSON.stringify(select)}`)
    },
    async count() {
      return state.queue.notReadyCount
    },
    async findUnique() {
      return { comments: state.claim.task.comments }
    },
    async updateMany({ where }) {
      if (state.claim.forceConflict) return { count: 0 }
      const task = state.claim.task
      const ready = where.statusRole === task.statusRole
      const due = !where.AND || task.dueDateTime === null ||
        new Date(task.dueDateTime).getTime() <= new Date().getTime()
      return { count: !task.completed && ready && due ? 1 : 0 }
    },
  },
  comment: {
    async create() {
      return {}
    },
  },
  async $transaction(work) {
    return work(prisma)
  },
}

export { prisma }
