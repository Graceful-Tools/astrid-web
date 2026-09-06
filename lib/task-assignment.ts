/**
 * Task Assignment Utilities
 * Handles assignment of tasks to both users and AI agents
 */

import { prisma } from './prisma'


export interface AssignmentTarget {
  type: 'user' | 'ai_agent'
  id: string
  name?: string
}

export interface AssignmentOption {
  type: 'user' | 'ai_agent'
  id: string
  name: string
  email?: string
  description?: string
  icon: '👤' | '🤖'
  service?: string
  agentType?: string
  isActive?: boolean
}

/**
 * Assign a task to either a user or AI agent
 */
export async function assignTask(taskId: string, target: AssignmentTarget): Promise<void> {
  if (target.type === 'user') {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        assigneeId: target.id,
        aiAgentId: null
      }
    })
  } else if (target.type === 'ai_agent') {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        assigneeId: null,
        aiAgentId: target.id
      }
    })
  } else {
    throw new Error(`Invalid assignment target type: ${target.type}`)
  }
}

/**
 * Unassign a task (remove all assignees)
 */
export async function unassignTask(taskId: string): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      assigneeId: null,
      aiAgentId: null
    }
  })
}

/**
 * Get current assignee of a task
 */
export async function getTaskAssignee(taskId: string): Promise<AssignmentTarget | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      assigneeId: true,
      aiAgentId: true,
      assignee: {
        select: { name: true }
      },
      aiAgent: {
        select: { name: true }
      }
    }
  })

  if (!task) {
    throw new Error(`Task ${taskId} not found`)
  }

  if (task.assigneeId && task.assignee) {
    return {
      type: 'user',
      id: task.assigneeId,
      name: task.assignee.name || 'Unknown User'
    }
  }

  if (task.aiAgentId && task.aiAgent) {
    return {
      type: 'ai_agent',
      id: task.aiAgentId,
      name: task.aiAgent.name
    }
  }

  return null
}

/**
 * Get all available assignment options (users + AI agents)
 */
export async function getAssignmentOptions(listId?: string): Promise<AssignmentOption[]> {
  const [users, aiAgents] = await Promise.all([
    // Get active users (optionally filtered by list membership)
    prisma.user.findMany({
      where: {
        isActive: true,
        isAIAgent: false, // Exclude fake AI agent users
        ...(listId && {
          OR: [
            { ownedLists: { some: { id: listId } } },
            { listMemberships: { some: { listId } } }
          ]
        })
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true
      },
      orderBy: { name: 'asc' }
    }),

    // Get active AI agents
    prisma.aIAgent.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        service: true,
        agentType: true,
        description: true
      },
      orderBy: [{ service: 'asc' }, { agentType: 'asc' }]
    })
  ])

  const userOptions: AssignmentOption[] = users.map(user => ({
    type: 'user',
    id: user.id,
    name: user.name || user.email,
    email: user.email,
    icon: '👤' as const,
    isActive: true
  }))

  const aiAgentOptions: AssignmentOption[] = aiAgents.map(agent => ({
    type: 'ai_agent',
    id: agent.id,
    name: agent.name,
    description: agent.description || undefined,
    icon: '🤖' as const,
    service: agent.service,
    agentType: agent.agentType,
    isActive: true
  }))

  // Return users first, then AI agents
  return [...userOptions, ...aiAgentOptions]
}

/**
 * Check if a task is assigned to an AI agent
 */
export async function isTaskAssignedToAI(taskId: string): Promise<boolean> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { aiAgentId: true }
  })

  return task?.aiAgentId !== null
}

/**
 * Get AI agent details for a task (if assigned to AI)
 */
export async function getTaskAIAgent(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      aiAgent: {
        select: {
          id: true,
          name: true,
          service: true,
          agentType: true,
          description: true,
          config: true,
          webhookUrl: true
        }
      }
    }
  })

  return task?.aiAgent || null
}

/**
 * Validate assignment target exists and is active
 */
export async function validateAssignmentTarget(target: AssignmentTarget): Promise<boolean> {
  if (target.type === 'user') {
    const user = await prisma.user.findUnique({
      where: { id: target.id },
      select: { isActive: true, isAIAgent: true }
    })
    return user?.isActive === true && user?.isAIAgent === false
  } else if (target.type === 'ai_agent') {
    const aiAgent = await prisma.aIAgent.findUnique({
      where: { id: target.id },
      select: { isActive: true }
    })
    return aiAgent?.isActive === true
  }

  return false
}

/**
 * Batch assign multiple tasks to the same target
 */
export async function batchAssignTasks(taskIds: string[], target: AssignmentTarget): Promise<void> {
  const isValid = await validateAssignmentTarget(target)
  if (!isValid) {
    throw new Error(`Invalid assignment target: ${target.type}:${target.id}`)
  }

  if (target.type === 'user') {
    await prisma.task.updateMany({
      where: { id: { in: taskIds } },
      data: {
        assigneeId: target.id,
        aiAgentId: null
      }
    })
  } else {
    await prisma.task.updateMany({
      where: { id: { in: taskIds } },
      data: {
        assigneeId: null,
        aiAgentId: target.id
      }
    })
  }
}