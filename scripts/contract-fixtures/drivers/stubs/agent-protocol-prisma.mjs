import { state } from './agent-protocol-state.mjs'

export function projectSelectedFields(record, select) {
  if (record === null) return null
  if (Array.isArray(record)) return record.map((row) => projectSelectedFields(row, select))
  if (!record || typeof record !== 'object' || !select || typeof select !== 'object') {
    throw new Error(`agent-protocol fixture: cannot apply select ${JSON.stringify(select)}`)
  }

  const projected = {}
  for (const [field, selection] of Object.entries(select)) {
    if (!selection) continue
    if (!(field in record)) {
      throw new Error(`agent-protocol fixture: selected field "${field}" is missing from its row`)
    }

    const nestedSelect = typeof selection === 'object' ? selection.select : null
    projected[field] = nestedSelect
      ? projectSelectedFields(record[field], nestedSelect)
      : record[field]
  }
  return projected
}

const prisma = {
  user: {
    async findUnique({ where, select }) {
      if (where?.email) {
        if (!state.claim.agentAvailable) return null
        return projectSelectedFields({
          id: 'agent-claude',
          email: where.email,
          name: 'Claude Agent',
          isAIAgent: true,
          isActive: true,
        }, select)
      }
      if (where?.id && select?.mcpSettings) {
        return projectSelectedFields({ mcpSettings: state.mcpSettings }, select)
      }
      throw new Error(`agent-protocol fixture: unexpected user.findUnique ${JSON.stringify({ where, select })}`)
    },
  },
  task: {
    async findMany({ select }) {
      if (select?.isAllDay) return projectSelectedFields(state.queue.tasks, select)
      if (select?.comments) return projectSelectedFields(state.queue.attention, select)
      throw new Error(`agent-protocol fixture: unexpected task.findMany ${JSON.stringify(select)}`)
    },
    async count() {
      return state.queue.notReadyCount
    },
    async findUnique({ select }) {
      return projectSelectedFields({ comments: state.claim.task.comments }, select)
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
