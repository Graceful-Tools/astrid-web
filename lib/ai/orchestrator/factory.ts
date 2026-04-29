/**
 * Factory helpers for AIOrchestrator construction.
 *
 * Both functions decide *which AI provider* an orchestrator should use for
 * a given task and which user's API keys / GitHub repo should back it. The
 * AIOrchestrator class re-exports them as static methods (createForTask /
 * createForTaskWithService) for backwards compatibility — the public API
 * surface is unchanged.
 *
 * The constructor is passed in from the call site rather than imported here
 * to avoid a value-level circular dependency between ai-orchestrator.ts
 * and this module.
 */

import { prisma } from '../../prisma'
import { type AIService, getAgentService } from '../agent-config'
import { createLogger } from '../../logger'

const log = createLogger('ai-orchestrator/factory')

/**
 * Minimal contract a constructed AIOrchestrator must satisfy for the
 * factory to wire it up. Real instances satisfy this; the structural type
 * keeps the factory module decoupled from the class.
 */
interface AIOrchestratorLike {
  setCurrentTaskId(taskId: string): void
  loadAstridMd(): Promise<void>
}

type AIOrchestratorCtor<T extends AIOrchestratorLike> = new (
  aiService: AIService,
  userId: string,
  repositoryId?: string,
) => T

/**
 * Create an AIOrchestrator bound to a specific AI service that the caller
 * has already chosen. This is the path used when one orchestrator spawns a
 * sub-orchestrator on the same service (planning → implementation handoff).
 */
export async function createForTaskWithService<T extends AIOrchestratorLike>(
  Orchestrator: AIOrchestratorCtor<T>,
  taskId: string,
  _userId: string,
  aiService: AIService,
): Promise<T> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      lists: {
        select: {
          githubRepositoryId: true,
          aiAgentConfiguredBy: true,
        },
      },
    },
  })

  if (!task || task.lists.length === 0) {
    throw new Error('Task not found or not associated with any list')
  }

  // Task may be in multiple lists; prefer the one with a GitHub repo wired up.
  const listWithRepo = task.lists.find(l => l.githubRepositoryId)
  const taskList = listWithRepo || task.lists[0]
  const githubRepositoryId = listWithRepo?.githubRepositoryId

  const candidateUserIds = [
    _userId,
    taskList.aiAgentConfiguredBy,
    task.creatorId,
  ].filter((value): value is string => Boolean(value))

  const configuredByUserId = candidateUserIds[0]

  if (!configuredByUserId) {
    throw new Error('Task creator no longer exists and no AI agent configured user is set')
  }

  const orchestrator = new Orchestrator(
    aiService,
    configuredByUserId,
    githubRepositoryId || undefined,
  )
  orchestrator.setCurrentTaskId(taskId)

  await orchestrator.loadAstridMd()

  return orchestrator
}

/**
 * Create an AIOrchestrator with optimal configuration based on the task's
 * assigned agent. Provider selection priority:
 *
 *   1. If task is assigned to an AI agent (e.g. claude@astrid.cc), use that
 *      agent's service. OpenClaw is rejected here because it's handled via
 *      the channel plugin (SSE), not the orchestrator.
 *   2. List's preferredAiProvider, if the configuring user has a key for it.
 *   3. List's fallbackAiProvider, same condition.
 *   4. First provider the configuring user has any encrypted key for.
 */
export async function createForTask<T extends AIOrchestratorLike>(
  Orchestrator: AIOrchestratorCtor<T>,
  taskId: string,
  _userId: string,
): Promise<T> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignee: {
        select: {
          email: true,
          isAIAgent: true,
        },
      },
      lists: {
        select: {
          preferredAiProvider: true,
          fallbackAiProvider: true,
          githubRepositoryId: true,
          aiAgentsEnabled: true,
          aiAgentConfiguredBy: true,
        },
      },
    },
  })

  if (!task || task.lists.length === 0) {
    throw new Error('Task not found or not associated with any list')
  }

  const listWithRepo = task.lists.find(l => l.githubRepositoryId)
  const taskList = listWithRepo || task.lists[0]
  const githubRepositoryId = listWithRepo?.githubRepositoryId

  // Use the user who configured the AI agent for this list (not the task
  // creator) so team members can use AI agents without their own API keys.
  const configuredByUserId = taskList.aiAgentConfiguredBy || task.creatorId || _userId
  if (!configuredByUserId) {
    throw new Error('Task creator no longer exists and no AI agent configured user is set')
  }

  const user = await prisma.user.findUnique({
    where: { id: configuredByUserId },
    select: { mcpSettings: true },
  })

  let mcpSettings: Record<string, unknown> = {}
  if (user?.mcpSettings) {
    try {
      mcpSettings = typeof user.mcpSettings === 'string'
        ? JSON.parse(user.mcpSettings)
        : (user.mcpSettings as Record<string, unknown>)
    } catch (error) {
      log.error({ err: error }, 'Failed to parse mcpSettings JSON:')
      mcpSettings = {}
    }
  }

  const apiKeys = (mcpSettings.apiKeys || {}) as Record<string, { encrypted?: boolean }>
  const availableProviders = Object.keys(apiKeys).filter(
    provider => apiKeys[provider]?.encrypted && ['claude', 'openai', 'gemini'].includes(provider),
  )

  let selectedProvider: AIService

  if (task.assignee?.isAIAgent && task.assignee.email) {
    selectedProvider = getAgentService(task.assignee.email)
    log.info(`[AIOrchestrator] Using assigned agent's service: ${selectedProvider} (${task.assignee.email})`)

    if (selectedProvider === 'openclaw') {
      throw new Error('OpenClaw tasks are handled via the channel plugin (SSE), not the AI orchestrator. Do not create workflows for OpenClaw agents.')
    }
  } else if (taskList.preferredAiProvider && availableProviders.includes(taskList.preferredAiProvider)) {
    selectedProvider = taskList.preferredAiProvider as AIService
  } else if (taskList.fallbackAiProvider && availableProviders.includes(taskList.fallbackAiProvider)) {
    selectedProvider = taskList.fallbackAiProvider as AIService
  } else if (availableProviders.length > 0) {
    selectedProvider = availableProviders[0] as AIService
  } else {
    throw new Error('No AI providers available. Please configure API keys in settings.')
  }

  return new Orchestrator(selectedProvider, configuredByUserId, githubRepositoryId || undefined)
}
