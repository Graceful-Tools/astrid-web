/**
 * Workflow Queue System
 *
 * Manages AI workflow execution with rate limiting and retry logic
 * to prevent Claude API rate limit errors.
 *
 * Features:
 * - ✅ PER-API-KEY queuing (isolated rate limits per user)
 * - Token budget tracking (30k tokens/minute limit per API key)
 * - Automatic queuing when rate limit approached
 * - Exponential backoff retry logic
 * - Concurrent workflow execution with limits
 */

import type { PrismaClient } from '@prisma/client'
import { prisma as sharedPrisma } from './prisma'
import type { AIService } from '@/lib/ai/agent-config'
import { createLogger } from '@/lib/logger'

const log = createLogger('workflow-queue')


interface QueuedWorkflow {
  id: string
  taskId: string
  userId: string // User who owns the API key (aiAgentConfiguredBy)
  repository: string
  aiService: AIService
  priority: number
  retries: number
  maxRetries: number
  createdAt: Date
  estimatedTokens: number
}

interface QueueStats {
  queueLength: number
  activeWorkflows: number
  tokensUsedInWindow: number
  tokenBudgetRemaining: number
  nextAvailableSlot: Date
}

/**
 * Per-API-key queue state
 */
interface ApiKeyQueue {
  queue: QueuedWorkflow[]
  activeWorkflows: Map<string, Promise<void>>
  tokenUsageWindow: Array<{ timestamp: number; tokens: number }>
  processorInterval?: NodeJS.Timeout
}

export class WorkflowQueue {
  private static instance: WorkflowQueue
  private prisma: PrismaClient

  // ✅ Per-API-key queues (keyed by userId who owns the API key)
  private apiKeyQueues: Map<string, ApiKeyQueue> = new Map()

  // Rate limit configuration (per API key)
  private readonly TOKEN_BUDGET_PER_MINUTE = 30000
  private readonly MAX_CONCURRENT_WORKFLOWS = 2
  private readonly ESTIMATED_TOKENS_PER_WORKFLOW = 8000 // Planning phase estimate

  // Retry configuration
  private readonly BASE_RETRY_DELAY_MS = 60000 // 1 minute (for normal errors)
  private readonly RATE_LIMIT_RETRY_DELAY_MS = 2.5 * 60000 // 2.5 minutes (for rate limits - Claude has 60s rolling window)
  private readonly MAX_RETRIES = 3

  private constructor() {
    this.prisma = sharedPrisma
    this.startGlobalTokenWindowCleaner()
  }

  static getInstance(): WorkflowQueue {
    if (!WorkflowQueue.instance) {
      WorkflowQueue.instance = new WorkflowQueue()
    }
    return WorkflowQueue.instance
  }

  /**
   * ✅ Get or create queue for specific API key (user)
   */
  private getOrCreateQueue(userId: string): ApiKeyQueue {
    if (!this.apiKeyQueues.has(userId)) {
      const newQueue: ApiKeyQueue = {
        queue: [],
        activeWorkflows: new Map(),
        tokenUsageWindow: []
      }

      this.apiKeyQueues.set(userId, newQueue)

      // Start processor for this queue
      this.startQueueProcessor(userId)

      log.info(`✅ [QUEUE] Created new queue for user: ${userId}`)
    }

    return this.apiKeyQueues.get(userId)!
  }

  /**
   * Add workflow to queue (automatically uses correct per-API-key queue)
   */
  async enqueue(
    taskId: string,
    userId: string, // User who owns the API key (aiAgentConfiguredBy)
    repository: string,
    aiService: AIService = 'claude',
    priority: number = 0
  ): Promise<{ queued: boolean; position?: number; estimatedWaitTime?: number }> {
    const workflowId = `${taskId}-${Date.now()}`

    const queuedWorkflow: QueuedWorkflow = {
      id: workflowId,
      taskId,
      userId,
      repository,
      aiService,
      priority,
      retries: 0,
      maxRetries: this.MAX_RETRIES,
      createdAt: new Date(),
      estimatedTokens: this.ESTIMATED_TOKENS_PER_WORKFLOW
    }

    // ✅ Get queue for this user's API key
    const apiQueue = this.getOrCreateQueue(userId)

    // Check if we can execute immediately on this API key's queue
    if (this.canExecuteImmediately(userId)) {
      log.info(`✅ [QUEUE:${userId}] Executing workflow immediately: ${taskId}`)
      this.executeWorkflow(queuedWorkflow, userId)
      return { queued: false }
    }

    // Add to this API key's queue
    apiQueue.queue.push(queuedWorkflow)
    apiQueue.queue.sort((a, b) => b.priority - a.priority) // Higher priority first

    const position = apiQueue.queue.findIndex(w => w.id === workflowId) + 1
    const estimatedWaitTime = this.calculateEstimatedWaitTime(position)

    log.info(`📋 [QUEUE:${userId}] Workflow queued: ${taskId} (position: ${position}, wait: ${estimatedWaitTime}s)`)

    // ✅ Post queue notification to user
    try {
      const { createAIAgentComment } = await import('@/lib/ai-agent-comment-service')
      const stats = this.getStats(userId)
      const waitMinutes = Math.ceil(estimatedWaitTime / 60)

      await createAIAgentComment(
        taskId,
        `⏱️ **Workflow Queued**\n\n` +
        `Your workflow is in the queue and will start automatically.\n\n` +
        `**Queue Status:**\n` +
        `- Position: ${position} of ${stats.queueLength}\n` +
        `- Estimated wait: ~${waitMinutes} ${waitMinutes === 1 ? 'minute' : 'minutes'}\n` +
        `- Active workflows: ${stats.activeWorkflows}\n` +
        `- Token budget: ${Math.round(stats.tokenBudgetRemaining / 1000)}k / 30k per minute\n\n` +
        `*Your queue is isolated from other users' API keys.*`
      )
    } catch (error) {
      log.error({ err: error }, 'Failed to post queue notification:')
    }

    return {
      queued: true,
      position,
      estimatedWaitTime
    }
  }

  /**
   * ✅ Check if workflow can execute immediately (per API key)
   */
  private canExecuteImmediately(userId: string): boolean {
    const apiQueue = this.getOrCreateQueue(userId)

    const hasCapacity = apiQueue.activeWorkflows.size < this.MAX_CONCURRENT_WORKFLOWS
    const hasTokenBudget = this.getTokenBudgetRemaining(userId) >= this.ESTIMATED_TOKENS_PER_WORKFLOW

    return hasCapacity && hasTokenBudget
  }

  /**
   * ✅ Calculate remaining token budget in current minute (per API key)
   */
  private getTokenBudgetRemaining(userId: string): number {
    const apiQueue = this.getOrCreateQueue(userId)
    const now = Date.now()
    const oneMinuteAgo = now - 60000

    // Clean old entries
    apiQueue.tokenUsageWindow = apiQueue.tokenUsageWindow.filter(
      entry => entry.timestamp > oneMinuteAgo
    )

    const tokensUsed = apiQueue.tokenUsageWindow.reduce(
      (sum, entry) => sum + entry.tokens,
      0
    )

    return Math.max(0, this.TOKEN_BUDGET_PER_MINUTE - tokensUsed)
  }

  /**
   * ✅ PUBLIC: Get tokens used in rolling window (for AIOrchestrator integration)
   */
  getTokensUsedInWindow(userId: string): number {
    const apiQueue = this.getOrCreateQueue(userId)
    const now = Date.now()
    const oneMinuteAgo = now - 60000

    // Clean old entries
    apiQueue.tokenUsageWindow = apiQueue.tokenUsageWindow.filter(
      entry => entry.timestamp > oneMinuteAgo
    )

    return apiQueue.tokenUsageWindow.reduce(
      (sum, entry) => sum + entry.tokens,
      0
    )
  }

  /**
   * ✅ Record token usage (per API key)
   */
  private recordTokenUsage(userId: string, tokens: number) {
    const apiQueue = this.getOrCreateQueue(userId)

    apiQueue.tokenUsageWindow.push({
      timestamp: Date.now(),
      tokens
    })
  }

  /**
   * ✅ PUBLIC: Record token usage (for AIOrchestrator integration)
   */
  recordTokens(userId: string, tokens: number) {
    this.recordTokenUsage(userId, tokens)
  }

  /**
   * Calculate estimated wait time
   */
  private calculateEstimatedWaitTime(position: number): number {
    const queueAhead = position - 1
    const averageWorkflowTime = 120 // 2 minutes per workflow (estimate)
    const parallelCapacity = this.MAX_CONCURRENT_WORKFLOWS

    const estimatedSeconds = Math.ceil((queueAhead / parallelCapacity) * averageWorkflowTime)
    return estimatedSeconds
  }

  /**
   * ✅ Execute workflow with rate limiting and retry logic (per API key)
   */
  private async executeWorkflow(workflow: QueuedWorkflow, userId: string): Promise<void> {
    const { id, taskId, repository, aiService } = workflow
    const apiQueue = this.getOrCreateQueue(userId)

    // Mark as active in this API key's queue
    const executionPromise = (async () => {
      try {
        // ✅ CRITICAL: Verify task still exists and is incomplete before starting
        const task = await this.prisma.task.findUnique({
          where: { id: taskId }
        })

        if (!task) {
          log.info(`❌ [QUEUE:${userId}] Workflow cancelled - task ${taskId} was deleted`)
          return
        }

        if (task.completed) {
          log.info(`✅ [QUEUE:${userId}] Workflow cancelled - task ${taskId} was completed`)
          return
        }

        log.info(`🚀 [QUEUE:${userId}] Starting workflow execution: ${taskId}`)

        // Record estimated token usage upfront for this API key
        this.recordTokenUsage(userId, workflow.estimatedTokens)

        // Dynamic import to avoid circular dependencies
        const { AIOrchestrator } = await import('@/lib/ai-orchestrator')

        // ✅ Use existing workflow record (created by frontend) or create new one
        let workflowRecord = await this.prisma.codingTaskWorkflow.findUnique({
          where: { taskId }
        })

        if (!workflowRecord) {
          // Create workflow record if it doesn't exist
          workflowRecord = await this.prisma.codingTaskWorkflow.create({
            data: {
              taskId,
              status: 'PENDING',
              aiService,
              repositoryId: repository,
              metadata: {
                triggeredBy: 'workflow_queue',
                queuedAt: workflow.createdAt.toISOString(),
                startedAt: new Date().toISOString(),
                retries: workflow.retries
              }
            }
          })
        } else {
          // Update existing workflow to mark as started
          workflowRecord = await this.prisma.codingTaskWorkflow.update({
            where: { taskId },
            data: {
              status: 'PLANNING',
              metadata: {
                ...(workflowRecord.metadata as any || {}),
                queuedAt: workflow.createdAt.toISOString(),
                startedAt: new Date().toISOString(),
                retries: workflow.retries
              }
            }
          })
          log.info(`✅ [QUEUE] Using existing workflow record: ${workflowRecord.id}`)
        }

        // Create orchestrator
        let orchestrator
        try {
          orchestrator = await AIOrchestrator.createForTaskWithService(
            taskId,
            userId,
            aiService
          )
        } catch (createError: any) {
          log.error({ err: createError }, `❌ [QUEUE:${userId}] Failed to create AIOrchestrator:`)
          throw new Error(`Failed to initialize AI workflow: ${createError.message || 'Unknown error'}. Check that AI API keys are configured correctly.`)
        }

        // Execute - this posts "Starting work" comment
        log.info(`🎬 [QUEUE:${userId}] ABOUT TO CALL executeCompleteWorkflow for task ${taskId}`)
        log.info(`🎬 [QUEUE:${userId}] Workflow ID: ${workflowRecord.id}`)
        log.info(`🎬 [QUEUE:${userId}] Orchestrator trace ID: ${orchestrator.getTraceId() || 'unknown'}`)

        try {
          log.info(`▶️ [QUEUE:${userId}] CALLING orchestrator.executeCompleteWorkflow NOW`)
          await orchestrator.executeCompleteWorkflow(workflowRecord.id, taskId)
          log.info(`✅ [QUEUE:${userId}] executeCompleteWorkflow COMPLETED for task ${taskId}`)
        } catch (executeError: any) {
          log.error({ err: executeError }, `❌ [QUEUE:${userId}] executeCompleteWorkflow FAILED:`)
          log.error(executeError.message, `❌ [QUEUE:${userId}] Error message:`)
          log.error(executeError.stack, `❌ [QUEUE:${userId}] Error stack:`)
          throw new Error(`Workflow execution failed: ${executeError.message || 'Unknown error'}`)
        }

      } catch (error: any) {
        log.error({ err: error }, `❌ [QUEUE:${userId}] Workflow failed: ${taskId}`)
        log.error(error?.stack, `❌ [QUEUE:${userId}] Error stack:`)

        // Check if rate limit error
        const isRateLimitError = error?.message?.includes('rate_limit_error') ||
                                error?.message?.includes('Too Many Requests')

        if (isRateLimitError && workflow.retries < workflow.maxRetries) {
          // Retry with longer delay for rate limits
          await this.retryWorkflow(workflow, userId, true) // true = isRateLimit
        } else {
          // Post error comment with queue context
          await this.postErrorComment(taskId, error, workflow.retries, userId)
        }
      } finally {
        // Remove from active workflows for this API key
        apiQueue.activeWorkflows.delete(id)

        // Process next in queue for this API key
        this.processQueue(userId)
      }
    })()

    apiQueue.activeWorkflows.set(id, executionPromise)
  }

  /**
   * ✅ Retry workflow with exponential backoff (per API key)
   */
  private async retryWorkflow(workflow: QueuedWorkflow, userId: string, isRateLimit: boolean = false): Promise<void> {
    workflow.retries++

    // ✅ Use longer delay for rate limits (2.5 min) vs normal retries (exponential backoff)
    const delay = isRateLimit
      ? this.RATE_LIMIT_RETRY_DELAY_MS // Fixed 2.5 minute delay for rate limits
      : this.BASE_RETRY_DELAY_MS * Math.pow(2, workflow.retries - 1) // Exponential for other errors

    const delaySeconds = Math.round(delay / 1000)
    const delayMinutes = Math.round(delaySeconds / 60)

    log.info(`🔄 [QUEUE:${userId}] Retrying workflow ${workflow.taskId} in ${delayMinutes}min (attempt ${workflow.retries}/${workflow.maxRetries})${isRateLimit ? ' [RATE LIMIT]' : ''}`)

    // Post retry notice with queue info
    await this.postRetryComment(workflow.taskId, workflow.retries, delaySeconds, isRateLimit, userId)

    // Add back to this API key's queue after delay
    const apiQueue = this.getOrCreateQueue(userId)

    setTimeout(async () => {
      // ✅ CRITICAL: Verify task still exists and is incomplete before retrying
      try {
        const task = await this.prisma.task.findUnique({
          where: { id: workflow.taskId }
        })

        if (!task) {
          log.info(`❌ [QUEUE:${userId}] Retry cancelled - task ${workflow.taskId} was deleted`)
          return
        }

        if (task.completed) {
          log.info(`✅ [QUEUE:${userId}] Retry cancelled - task ${workflow.taskId} was completed`)
          return
        }

        // Task is still valid, proceed with retry
        log.info(`✅ [QUEUE:${userId}] Task ${workflow.taskId} still active, proceeding with retry`)
        apiQueue.queue.unshift(workflow) // Add to front of queue
        this.processQueue(userId)

      } catch (error) {
        log.error({ err: error }, `❌ [QUEUE:${userId}] Error checking task status for retry:`)
        // Don't retry if we can't verify task status
      }
    }, delay)
  }

  /**
   * Post retry comment to task
   */
  private async postRetryComment(taskId: string, attempt: number, delaySeconds: number, isRateLimit: boolean = false, userId?: string): Promise<void> {
    try {
      const { createAIAgentComment } = await import('@/lib/ai-agent-comment-service')

      const delayMinutes = Math.round(delaySeconds / 60)
      const delayText = delayMinutes >= 1
        ? `${delayMinutes} ${delayMinutes === 1 ? 'minute' : 'minutes'}`
        : `${delaySeconds} seconds`

      let message = `🔄 **Retrying Workflow** (Attempt ${attempt})\n\n`

      if (isRateLimit) {
        message += `I hit the API rate limit (30,000 tokens/minute per API key). I'll retry automatically in ${delayText}.\n\n`

        // Add queue info if available
        if (userId) {
          const stats = this.getStats(userId)
          message += `**Your Queue Status:**\n`
          message += `- Queued workflows: ${stats.queueLength}\n`
          message += `- Active workflows: ${stats.activeWorkflows}\n`
          message += `- Token budget: ${Math.round(stats.tokenBudgetRemaining / 1000)}k remaining\n\n`
        }

        message += `*Rate limits are per API key, so your workflows won't be affected by other users.*`
      } else {
        message += `I encountered an error, but I'll retry automatically in ${delayText}.\n\n*This is normal and will complete shortly.*`
      }

      await createAIAgentComment(taskId, message)
    } catch (error) {
      log.error({ err: error }, 'Failed to post retry comment:')
    }
  }

  /**
   * Post error comment to task
   */
  private async postErrorComment(taskId: string, error: any, retries: number, userId?: string): Promise<void> {
    try {
      const { createAIAgentComment } = await import('@/lib/ai-agent-comment-service')
      const errorMessage = error?.message || 'Unknown error'

      // ✅ Better message: "Failed" (0 retries) vs "Failed After N Retries"
      const retriesMessage = retries === 0
        ? '**Workflow Failed**'
        : `**Workflow Failed After ${retries} ${retries === 1 ? 'Retry' : 'Retries'}**`

      let message = `❌ ${retriesMessage}\n\n**Error:**\n${errorMessage}\n\n`

      // ✅ Add specific context for initialization errors
      const isInitializationError = errorMessage.includes('Failed to initialize') ||
                                     errorMessage.includes('API keys')
      if (isInitializationError) {
        message += `**This looks like a configuration issue:**\n`
        message += `- Check that your AI API keys are configured in Settings → AI Agents\n`
        message += `- Verify the API keys are valid and have sufficient credits\n`
        message += `- Make sure the list has a GitHub repository configured\n\n`
      }

      // Add queue context for rate limit errors
      const isRateLimit = errorMessage.includes('rate_limit') || errorMessage.includes('Too Many Requests')
      if (isRateLimit && userId) {
        const stats = this.getStats(userId)
        message += `**Rate Limit Info:**\n`
        message += `- Limit: 30,000 tokens/minute per API key\n`
        message += `- Your queue: ${stats.queueLength} waiting, ${stats.activeWorkflows} active\n`
        message += `- Token budget resets every minute\n\n`
        message += `*Your workflows are isolated from other users' API keys.*\n\n`
      }

      message += `**Next Steps:**\n`
      if (isInitializationError) {
        message += `- Go to Settings → AI Agents and verify your API keys\n`
        message += `- Check List Settings and ensure a GitHub repository is selected\n`
        message += `- Try reassigning the task after fixing configuration\n`
      } else if (isRateLimit) {
        message += `- Wait 5-10 minutes for rate limit to reset\n`
        message += `- Reassign the task to try again\n`
        message += `- Consider spreading out multiple workflow requests\n`
      } else {
        message += `- Wait a few minutes and try reassigning the task\n`
        message += `- Check if the issue persists\n`
        message += `- Contact support if this continues\n`
      }

      await createAIAgentComment(taskId, message)
    } catch (err) {
      log.error({ err: err }, 'Failed to post error comment:')
    }
  }

  /**
   * ✅ Process queue - start next workflow if capacity available (per API key)
   */
  private processQueue(userId: string): void {
    const apiQueue = this.getOrCreateQueue(userId)

    // Check if we can start more workflows on this API key
    if (!this.canExecuteImmediately(userId)) {
      return
    }

    // Get next workflow from this API key's queue
    const nextWorkflow = apiQueue.queue.shift()
    if (!nextWorkflow) {
      return
    }

    log.info(`⏭️  [QUEUE:${userId}] Starting next workflow from queue: ${nextWorkflow.taskId}`)
    this.executeWorkflow(nextWorkflow, userId)

    // Try to process more if capacity available
    if (this.canExecuteImmediately(userId) && apiQueue.queue.length > 0) {
      this.processQueue(userId)
    }
  }

  /**
   * ✅ Start background queue processor for a specific API key
   */
  private startQueueProcessor(userId: string): void {
    const apiQueue = this.getOrCreateQueue(userId)

    // Don't start multiple processors for same queue
    if (apiQueue.processorInterval) {
      return
    }

    apiQueue.processorInterval = setInterval(() => {
      this.processQueue(userId)
    }, 5000) // Check every 5 seconds

    log.info(`✅ [QUEUE:${userId}] Started queue processor`)
  }

  /**
   * ✅ Clean token usage window periodically for ALL API keys
   */
  private startGlobalTokenWindowCleaner(): void {
    setInterval(() => {
      const now = Date.now()
      const oneMinuteAgo = now - 60000

      // Clean token windows for all API keys
      for (const [userId, apiQueue] of this.apiKeyQueues.entries()) {
        apiQueue.tokenUsageWindow = apiQueue.tokenUsageWindow.filter(
          entry => entry.timestamp > oneMinuteAgo
        )
      }
    }, 10000) // Clean every 10 seconds
  }

  /**
   * ✅ Get queue statistics (aggregated across all API keys, or per-key if userId provided)
   */
  getStats(userId?: string): QueueStats {
    if (userId) {
      // Get stats for specific API key
      const apiQueue = this.apiKeyQueues.get(userId)
      if (!apiQueue) {
        return {
          queueLength: 0,
          activeWorkflows: 0,
          tokensUsedInWindow: 0,
          tokenBudgetRemaining: this.TOKEN_BUDGET_PER_MINUTE,
          nextAvailableSlot: new Date()
        }
      }

      const tokensUsed = apiQueue.tokenUsageWindow.reduce((sum: number, entry) => sum + entry.tokens, 0)
      const tokenBudgetRemaining = this.TOKEN_BUDGET_PER_MINUTE - tokensUsed

      const oldestEntry = apiQueue.tokenUsageWindow[0]
      const nextAvailableSlot = oldestEntry
        ? new Date(oldestEntry.timestamp + 60000)
        : new Date()

      return {
        queueLength: apiQueue.queue.length,
        activeWorkflows: apiQueue.activeWorkflows.size,
        tokensUsedInWindow: tokensUsed,
        tokenBudgetRemaining,
        nextAvailableSlot
      }
    }

    // Aggregate stats across all API keys
    let totalQueueLength = 0
    let totalActiveWorkflows = 0

    for (const apiQueue of this.apiKeyQueues.values()) {
      totalQueueLength += apiQueue.queue.length
      totalActiveWorkflows += apiQueue.activeWorkflows.size
    }

    return {
      queueLength: totalQueueLength,
      activeWorkflows: totalActiveWorkflows,
      tokensUsedInWindow: 0, // Not meaningful in aggregate
      tokenBudgetRemaining: 0, // Not meaningful in aggregate
      nextAvailableSlot: new Date()
    }
  }

  /**
   * ✅ Get queue status for a specific task (searches all queues)
   */
  getTaskStatus(taskId: string): { queued: boolean; position?: number; userId?: string } | null {
    // Search all queues for this task
    for (const [userId, apiQueue] of this.apiKeyQueues.entries()) {
      const position = apiQueue.queue.findIndex(w => w.taskId === taskId)

      if (position !== -1) {
        return {
          queued: true,
          position: position + 1,
          userId
        }
      }

      // Check if actively running
      const isActive = Array.from(apiQueue.activeWorkflows.keys()).some(id => id.includes(taskId))
      if (isActive) {
        return { queued: false, userId }
      }
    }

    return null
  }
}

// Export singleton instance
export const workflowQueue = WorkflowQueue.getInstance()
