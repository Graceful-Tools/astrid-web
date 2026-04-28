/**
 * AI Agent Orchestrator
 * Handles the complete AI-driven coding workflow
 *
 * TODO: Future refactoring (see docs/architecture/REFACTORING_PROPOSAL.md)
 * - Extract planning logic to lib/ai/planning-service.ts
 * - Extract GitHub operations to lib/ai/github-integration.ts
 * - Extract workflow management to lib/ai/workflow-manager.ts
 */

import { getCachedApiKey } from './api-key-cache'
import { createAIAgentComment } from './ai-agent-comment-service'
import { prisma } from './prisma'
import { type AIService, getAgentService } from './ai/agent-config'
import { type ClaudeSystemBlock } from './ai/clients'
import {
  callProvider,
  type ToolExecutionCallback,
} from './ai/providers'
import {
  buildMinimalPlanningPrompt,
  buildCodeGenerationPrompt,
} from './ai/prompts'
import {
  buildSystemBlocks as buildSystemBlocksUtil,
  type PlanningContextData,
} from './ai/system-blocks-builder'
import {
  loadRepositoryGuidelines,
  type RepositoryContextGitHubClient,
} from './ai/repository-context-loader'
import {
  validateAndDeduplicatePlan,
  validateFileSizes,
  loadFilesDirectly,
  filterGeneratedCode,
  type FileValidatorGitHubClient,
  type PlanningContextFiles,
} from './ai/file-validator'
import {
  extractSection,
  assessComplexity,
  extractConsiderations,
  extractFilePaths,
  mapToKnownPath,
  countBraceBalance,
  parseGeneratedCode as parseGeneratedCodeUtil,
} from './ai/response-parser'
import { CONFIG_DEFAULTS } from './ai/config/defaults'
import type { ResolvedAstridConfig } from './ai/config/schema'
import {
  formatPlanComment,
  formatPlanSummary,
  formatImplementationComment,
  formatCompletionSummary,
  parseWorkflowSteps as parseWorkflowStepsUtil,
  DEFAULT_WORKFLOW_STEPS,
  MINIMAL_WORKFLOW_STEPS,
  type ImplementationDetails,
} from './ai/workflow-comments'
// NOTE: Built-in Claude Agent SDK executor removed. Astrid now dispatches to
// external agent runtimes (OpenClaw, Claude Code Remote) via webhooks/SSE.
import {
  createGitHubImplementation as createGitHubImpl,
  resolveTargetRepository as resolveTargetRepo,
  type GitHubWorkflowDependencies,
} from './ai/github-workflow-service'
import {
  executeMCPTool,
  type MCPToolDependencies,
} from './ai/mcp-tool-executor'
import { createLogger } from '@/lib/logger'
import type {
  CodeGenerationRequest,
  GeneratedCode,
  ImplementationPlan,
} from './ai/types'

const log = createLogger('ai-orchestrator')

// Re-export types for backwards compatibility
export type { CodeGenerationRequest, GeneratedCode, ImplementationPlan }

// Tool definitions are now in lib/ai/providers/ modules

/**
 * Main orchestrator for AI coding workflows
 */
/**
 * Configuration for hybrid Claude Agent SDK execution mode
 */
// NOTE: HybridExecutionConfig removed — built-in executors stripped.
// Code generation now dispatches to external agent runtimes via webhooks/SSE.

export class AIOrchestrator {
  private aiService: AIService
  private userId: string
  private _repositoryId?: string // Repository ID for GitHub integration
  private traceId: string // ✅ Trace ID for debugging and log correlation
  private currentPhase?: string // ✅ Track current phase for error context

  // ✅ Context preservation: Track files explored during planning
  private exploredFiles: Map<string, { content: string; timestamp: number }> = new Map()

  // ✅ Progressive context caching: Store ASTRID.md for reuse across phases
  private astridMdContent?: string
  private currentTaskId?: string // Track current task for context storage

  // ✅ Hybrid execution mode configuration
  // hybridConfig removed — built-in executors stripped

  constructor(aiService: AIService, userId: string, repositoryId?: string) {
    this.aiService = aiService
    this.userId = userId // This is the user who configured the AI agent (has API keys)
    this._repositoryId = repositoryId
    // ✅ Generate unique trace ID for this workflow execution
    this.traceId = `trace-${Date.now()}-${Math.random().toString(36).substring(7)}`
    this.log('info', 'AIOrchestrator created', {
      aiService,
      repositoryId: repositoryId || 'none',
      traceId: this.traceId
    })
  }

  // setHybridExecutionConfig removed — built-in executors stripped

  /**
   * Expose trace identifier for external logging without leaking internal state
   */
  getTraceId(): string {
    return this.traceId
  }

  /**
   * ✅ Structured logging with trace correlation
   */
  private log(level: 'info' | 'warn' | 'error', message: string, meta: any = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      traceId: this.traceId,
      level,
      service: 'AIOrchestrator',
      message,
      phase: this.currentPhase,
      ...meta
    }
    log.info(JSON.stringify(logEntry))
  }

  /**
   * Load project config from GitHub repo or use defaults
   */
  private async loadProjectConfig(): Promise<ResolvedAstridConfig> {
    if (!this._repositoryId) {
      this.log('info', 'No repository ID, using default config')
      return CONFIG_DEFAULTS
    }

    try {
      // Try to load .astrid.config.json from the repository
      const { GitHubClient } = await import('./github-client')
      const githubClient = await GitHubClient.forUser(this.userId)

      const configContent = await githubClient.getFile(
        this._repositoryId,
        '.astrid.config.json',
        'main'
      )

      if (configContent) {
        const userConfig = JSON.parse(configContent)
        // Deep merge with defaults
        const merged = {
          ...CONFIG_DEFAULTS,
          ...userConfig,
          safety: { ...CONFIG_DEFAULTS.safety, ...userConfig.safety },
          validation: { ...CONFIG_DEFAULTS.validation, ...userConfig.validation },
          agent: { ...CONFIG_DEFAULTS.agent, ...userConfig.agent },
          retry: { ...CONFIG_DEFAULTS.retry, ...userConfig.retry },
        }
        this.log('info', 'Loaded project config from repository', {
          requirePlanApproval: merged.safety.requirePlanApproval
        })
        return merged as ResolvedAstridConfig
      }
    } catch (error) {
      this.log('info', 'No .astrid.config.json found in repo, using defaults', {
        error: error instanceof Error ? error.message : String(error)
      })
    }

    return CONFIG_DEFAULTS
  }

  /**
   * ✅ Store planning context in workflow metadata for implementation phase
   */
  private async storePlanningContext(plan: ImplementationPlan): Promise<void> {
    if (!this.currentTaskId) {
      this.log('warn', 'No task ID set, cannot store planning context')
      return
    }

    try {
      // Serialize explored files
      const exploredFiles = Array.from(this.exploredFiles.entries()).map(([path, data]) => ({
        path,
        content: data.content,
        relevance: 'Explored during planning',
        timestamp: data.timestamp
      }))

      await prisma.codingTaskWorkflow.updateMany({
        where: { taskId: this.currentTaskId },
        data: {
          metadata: {
            planningContext: {
              plan,
              exploredFiles,
              astridMdContent: this.astridMdContent,
              timestamp: Date.now()
            }
          } as any
        }
      })

      this.log('info', 'Stored planning context for implementation phase', {
        taskId: this.currentTaskId,
        exploredFilesCount: exploredFiles.length,
        hasAstridMd: !!this.astridMdContent
      })
    } catch (error) {
      this.log('error', 'Failed to store planning context', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  /**
   * ✅ Load planning context from workflow metadata
   */
  private async loadPlanningContext(): Promise<any | null> {
    if (!this.currentTaskId) {
      this.log('warn', 'No task ID set, cannot load planning context')
      return null
    }

    try {
      const workflow = await prisma.codingTaskWorkflow.findFirst({
        where: { taskId: this.currentTaskId },
        orderBy: { createdAt: 'desc' }
      })

      if (!workflow || !workflow.metadata) {
        this.log('warn', 'No workflow or metadata found for task')
        return null
      }

      const metadata = workflow.metadata as any
      const planningContext = metadata.planningContext

      if (!planningContext) {
        this.log('warn', 'No planning context found in workflow metadata')
        return null
      }

      // Restore ASTRID.md if it was stored
      if (planningContext.astridMdContent && !this.astridMdContent) {
        this.astridMdContent = planningContext.astridMdContent
        this.log('info', 'Restored ASTRID.md from planning context')
      }

      this.log('info', 'Loaded planning context from workflow', {
        taskId: this.currentTaskId,
        exploredFilesCount: planningContext.exploredFiles?.length || 0,
        hasAstridMd: !!planningContext.astridMdContent
      })

      return planningContext
    } catch (error) {
      this.log('error', 'Failed to load planning context', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return null
    }
  }

  /**
   * Load ASTRID.md for progressive context caching
   * Delegates to extracted repository-context-loader service
   */
  private async loadAstridMd(): Promise<void> {
    if (!this._repositoryId) {
      this.log('info', 'No repository ID, skipping ASTRID.md load')
      return
    }

    const result = await loadRepositoryGuidelines(
      {
        repositoryId: this._repositoryId,
        userId: this.userId,
        logger: (level, msg, meta) => this.log(level, msg, meta)
      },
      async (userId) => {
        const { GitHubClient } = await import('./github-client')
        return GitHubClient.forUser(userId) as Promise<RepositoryContextGitHubClient>
      }
    )

    this.astridMdContent = result.content || undefined
  }

  /**
   * Create an AIOrchestrator for a specific AI agent service
   */
  static async createForTaskWithService(
    taskId: string,
    _userId: string,
    aiService: AIService
  ): Promise<AIOrchestrator> {
    // Get task with list information
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        lists: {
          select: {
            githubRepositoryId: true,
            aiAgentConfiguredBy: true
          }
        }
      }
    })

    if (!task || task.lists.length === 0) {
      throw new Error('Task not found or not associated with any list')
    }

    // Find the first list with a GitHub repository connected (task may be in multiple lists)
    const listWithRepo = task.lists.find(l => l.githubRepositoryId)
    const taskList = listWithRepo || task.lists[0]
    const githubRepositoryId = listWithRepo?.githubRepositoryId

    const candidateUserIds = [
      _userId,
      taskList.aiAgentConfiguredBy,
      task.creatorId
    ].filter((value): value is string => Boolean(value))

    const configuredByUserId = candidateUserIds[0]

    if (!configuredByUserId) {
      throw new Error('Task creator no longer exists and no AI agent configured user is set')
    }

    const orchestrator = new AIOrchestrator(aiService, configuredByUserId, githubRepositoryId || undefined)
    orchestrator.currentTaskId = taskId

    // ✅ Load ASTRID.md for progressive context caching
    await orchestrator.loadAstridMd()

    return orchestrator
  }

  /**
   * Create an AIOrchestrator with optimal configuration based on task's assigned agent
   *
   * Priority for AI provider selection:
   * 1. If task is assigned to an AI agent (e.g., claude@astrid.cc), use that agent's service
   * 2. Fall back to list's preferredAiProvider
   * 3. Fall back to list's fallbackAiProvider
   * 4. Fall back to first available provider in user's API keys
   */
  static async createForTask(taskId: string, _userId: string): Promise<AIOrchestrator> {
    // Get task with list information AND assignee
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignee: {
          select: {
            email: true,
            isAIAgent: true
          }
        },
        lists: {
          select: {
            preferredAiProvider: true,
            fallbackAiProvider: true,
            githubRepositoryId: true,
            aiAgentsEnabled: true,
            aiAgentConfiguredBy: true
          }
        }
      }
    })

    if (!task || task.lists.length === 0) {
      throw new Error('Task not found or not associated with any list')
    }

    // Find the first list with a GitHub repository connected (task may be in multiple lists)
    const listWithRepo = task.lists.find(l => l.githubRepositoryId)
    const taskList = listWithRepo || task.lists[0]
    const githubRepositoryId = listWithRepo?.githubRepositoryId

    // Get the user who configured the AI agent for this list (not the task creator)
    // This ensures team members can use AI agents without needing their own API keys
    // The configuredByUserId is the list admin who added the agent with their own API keys
    const configuredByUserId = taskList.aiAgentConfiguredBy || task.creatorId || _userId // fallback for existing lists
    if (!configuredByUserId) {
      throw new Error('Task creator no longer exists and no AI agent configured user is set')
    }
    const user = await prisma.user.findUnique({
      where: { id: configuredByUserId },
      select: { mcpSettings: true }
    })

    // Parse mcpSettings from JSON string if needed
    let mcpSettings: Record<string, unknown> = {}
    if (user?.mcpSettings) {
      try {
        mcpSettings = typeof user.mcpSettings === 'string'
          ? JSON.parse(user.mcpSettings)
          : user.mcpSettings as Record<string, unknown>
      } catch (error) {
        log.error({ err: error }, 'Failed to parse mcpSettings JSON:')
        mcpSettings = {}
      }
    }

    // Use standard apiKeys location
    const apiKeys = (mcpSettings.apiKeys || {}) as Record<string, { encrypted?: boolean }>
    const availableProviders = Object.keys(apiKeys).filter(provider =>
      apiKeys[provider]?.encrypted && ['claude', 'openai', 'gemini'].includes(provider)
    )

    // Determine best AI provider - PRIORITY: assigned agent > list preference > fallback > first available
    let selectedProvider: AIService

    // First: Check if task is assigned to an AI agent and use their service
    if (task.assignee?.isAIAgent && task.assignee.email) {
      selectedProvider = getAgentService(task.assignee.email)
      log.info(`[AIOrchestrator] Using assigned agent's service: ${selectedProvider} (${task.assignee.email})`)

      // OpenClaw tasks use the channel plugin (SSE), not the orchestrator
      if (selectedProvider === 'openclaw') {
        throw new Error('OpenClaw tasks are handled via the channel plugin (SSE), not the AI orchestrator. Do not create workflows for OpenClaw agents.')
      }
    } else if (taskList.preferredAiProvider && availableProviders.includes(taskList.preferredAiProvider)) {
      selectedProvider = taskList.preferredAiProvider as AIService
    } else if (taskList.fallbackAiProvider && availableProviders.includes(taskList.fallbackAiProvider)) {
      selectedProvider = taskList.fallbackAiProvider as AIService
    } else if (availableProviders.length > 0) {
      // Use first available provider
      selectedProvider = availableProviders[0] as AIService
    } else {
      throw new Error('No AI providers available. Please configure API keys in settings.')
    }

    return new AIOrchestrator(selectedProvider, configuredByUserId, githubRepositoryId || undefined)
  }

  /**
   * Generate an implementation plan for a task
   */
  async generateImplementationPlan(request: CodeGenerationRequest): Promise<ImplementationPlan> {
    this.log('info', 'Generating implementation plan with progressive context caching')

    // ✅ Build progressive system blocks (will be cached and reused in implementation)
    const systemBlocks = this.buildSystemBlocks('planning')

    const prompt = await this.buildPlanningPrompt(request)

    // ✅ Call AI with system blocks for caching
    const response = await this.callAIService(prompt, 8192, false, systemBlocks)

    // Parse the AI response into a structured plan
    const plan = this.parseImplementationPlan(response)

    // ✅ Store raw response for error reporting
    plan.rawPlanningResponse = response

    // ✅ Attach explored files for implementation phase context
    plan.exploredFiles = Array.from(this.exploredFiles.entries()).map(([path, data]) => ({
      path,
      content: data.content,
      relevance: 'Explored during planning phase'
    }))

    plan.analysisNotes = `Planning phase explored ${this.exploredFiles.size} files with progressive caching enabled.`

    this.log('info', 'Implementation plan generated with context', {
      filesInPlan: plan.files.length,
      exploredFiles: plan.exploredFiles.length,
      complexity: plan.estimatedComplexity,
      systemBlocksCount: systemBlocks.length,
      cachedLayers: systemBlocks.filter(b => b.cache_control).length
    })

    // ✅ Store planning context for implementation phase
    await this.storePlanningContext(plan)

    return plan
  }

  /**
   * Generate actual code based on approved plan
   */
  async generateCode(
    request: CodeGenerationRequest,
    approvedPlan: ImplementationPlan
  ): Promise<GeneratedCode> {
    this.log('info', 'Generating code with progressive context from planning phase')

    // Validate and auto-deduplicate plan files using extracted service
    const validationResult = validateAndDeduplicatePlan(
      approvedPlan,
      (level, msg, meta) => this.log(level, msg, meta)
    )

    if (!validationResult.success) {
      throw new Error(validationResult.error)
    }

    // Validate file sizes using extracted service
    await validateFileSizes(
      approvedPlan,
      {
        repositoryId: this._repositoryId!,
        userId: this.userId,
        logger: (level, msg, meta) => this.log(level, msg, meta)
      },
      async (userId) => {
        const { GitHubClient } = await import('./github-client')
        return GitHubClient.forUser(userId) as Promise<FileValidatorGitHubClient>
      }
    )

    // Load planning context (includes ASTRID.md and explored files)
    let planningContext: PlanningContextFiles | null = await this.loadPlanningContext()

    if (!planningContext) {
      this.log('warn', 'No planning context found, implementation will use minimal context')
    }

    // Safety net: If planning context is incomplete, try to load small files directly
    if (!planningContext || !planningContext.exploredFiles || planningContext.exploredFiles.length === 0) {
      planningContext = await loadFilesDirectly(
        approvedPlan,
        planningContext,
        {
          repositoryId: this._repositoryId!,
          userId: this.userId,
          logger: (level, msg, meta) => this.log(level, msg, meta)
        },
        async (userId) => {
          const { GitHubClient } = await import('./github-client')
          return GitHubClient.forUser(userId) as Promise<FileValidatorGitHubClient>
        }
      )
    }

    // ✅ Build progressive system blocks (extends planning cache + adds planning insights)
    const systemBlocks = this.buildSystemBlocks('implementation', planningContext)

    const prompt = this.getCodeGenerationPrompt(request, approvedPlan)

    // ✅ Call AI with progressive system blocks (JSON-only mode, no tools)
    let response = await this.callAIService(prompt, 8192, true, systemBlocks)

    // Parse the AI response into structured code changes
    let generatedCode: GeneratedCode
    try {
      generatedCode = this.parseGeneratedCode(response)
    } catch (error) {
      // If parsing failed because of format issues, retry with stronger prompt
      if (error instanceof Error && error.message === 'RETRY_WITH_FORMAT_ENFORCEMENT') {
        this.log('warn', 'AI response was not in expected format, retrying with format enforcement')

        // Create a strong format enforcement prompt
        const formatEnforcementPrompt = `The previous response was not in the correct JSON format.

CRITICAL: You MUST respond with ONLY valid JSON. No explanations, no markdown, no code blocks - just raw JSON.

Required JSON structure:
\`\`\`json
{
  "files": [
    {
      "path": "exact/path/to/file.ts",
      "content": "complete file content here",
      "action": "modify"
    }
  ],
  "commitMessage": "brief commit message",
  "prTitle": "PR title",
  "prDescription": "PR description"
}
\`\`\`

IMPORTANT RULES:
1. Return ONLY the JSON object - no other text
2. Include complete file content, not snippets
3. Use exact file paths from the approved plan
4. Do not truncate or summarize code

Here is the original request again:
${prompt}

Respond with ONLY the JSON object as specified above.`

        // Retry with format enforcement
        response = await this.callAIService(formatEnforcementPrompt, 8192, true, systemBlocks)

        // Try parsing again
        try {
          generatedCode = this.parseGeneratedCode(response)
          this.log('info', 'Successfully parsed response after format enforcement retry')
        } catch (retryError) {
          // If it still fails, save the full response for debugging and throw informative error
          const diagnostics = {
            responseLength: response.length,
            responsePreview: response.substring(0, 1000),
            responseTail: response.length > 1000 ? response.substring(response.length - 500) : '',
            responseMiddle: response.length > 2000 ? response.substring(Math.floor(response.length / 2) - 250, Math.floor(response.length / 2) + 250) : '',
            error: retryError instanceof Error ? retryError.message : String(retryError),
            attemptedPatterns: [
              'Pure JSON parse',
              'Markdown code block extraction',
              'Balanced brace matching',
              'Regex JSON object search',
              'First-to-last brace extraction',
              'Markdown file header patterns'
            ],
            // Additional diagnostics
            hasJsonCodeBlock: response.includes('```json'),
            hasCodeBlock: response.includes('```'),
            hasFilesKey: response.includes('"files"'),
            hasBraces: response.includes('{') && response.includes('}'),
            braceBalance: countBraceBalance(response),
            firstBraceIndex: response.indexOf('{'),
            lastBraceIndex: response.lastIndexOf('}'),
            // ✅ NEW: File size diagnostics to help debug large file issues
            attemptedFiles: approvedPlan.files.map(f => ({
              path: f.path,
              estimatedSize: planningContext?.exploredFiles?.find((ef: any) => ef.path === f.path)?.content?.length || 'unknown'
            })),
            largestFile: planningContext?.exploredFiles?.reduce((largest: any, file: any) =>
              (file.content?.length > (largest?.content?.length || 0)) ? file : largest
            , null)?.path || 'unknown',
            totalContextSize: planningContext?.exploredFiles?.reduce((sum: number, file: any) =>
              sum + (file.content?.length || 0), 0) || 0
          }
          
          this.log('error', 'Failed to parse AI response even after format enforcement', diagnostics)

          // Include more helpful error details in the user-facing error
          const errorPreview = response.length > 1000 
            ? response.substring(0, 1000) + '\n\n... (truncated, full response logged)' 
            : response
          const actualError = retryError instanceof Error ? retryError.message : String(retryError)
          
          // Create a more detailed error message
          let errorMessage = 'AI did not return code in the expected format after retry.\n\n'
          errorMessage += `Parsing error: ${actualError}\n\n`
          
          // Add diagnostic info
          if (!diagnostics.hasBraces) {
            errorMessage += '⚠️ Response does not contain JSON braces ({}).\n'
          } else if (diagnostics.braceBalance !== 0) {
            errorMessage += `⚠️ JSON braces are unbalanced (balance: ${diagnostics.braceBalance}).\n`
          }
          
          if (diagnostics.hasCodeBlock && !diagnostics.hasJsonCodeBlock) {
            errorMessage += '⚠️ Response contains code blocks but not JSON code blocks.\n'
          }
          
          if (!diagnostics.hasFilesKey) {
            errorMessage += '⚠️ Response does not contain "files" key.\n'
          }

          // ✅ NEW: Add file size warning if we detect large files
          if (diagnostics.totalContextSize > 50000) {
            errorMessage += `\n⚠️ Large files detected in context (${Math.round(diagnostics.totalContextSize / 1024)}KB total).\n`
            errorMessage += `   Largest file: ${diagnostics.largestFile}\n`
            errorMessage += '   Large files often cause JSON parsing failures.\n'
          }

          errorMessage += `\nResponse preview (first 1000 chars):\n${errorPreview}\n\n`
          errorMessage += 'The AI may need more specific instructions or the response may be too large. '
          errorMessage += 'Try simplifying the task or breaking it into smaller steps.'
          
          throw new Error(errorMessage)
        }
      } else {
        // Re-throw other errors
        throw error
      }
    }

    // Validate that generated files match the plan using extracted service
    const plannedPaths = new Set(approvedPlan.files.map(f => f.path))
    generatedCode.files = filterGeneratedCode(
      generatedCode.files,
      plannedPaths,
      (level, msg, meta) => this.log(level, msg, meta)
    )

    this.log('info', 'Code generation completed with progressive context', {
      filesGenerated: generatedCode.files.length,
      paths: generatedCode.files.map(f => f.path),
      systemBlocksCount: systemBlocks.length,
      cachedLayers: systemBlocks.filter(b => b.cache_control).length,
      hadPlanningContext: !!planningContext
    })

    return generatedCode
  }

    // NOTE: generateCodeWithSDK and generateCodeSmart removed — built-in executors stripped.
  // Code generation now dispatches to external agent runtimes via webhooks/SSE.
  // Use generateCode() for basic/fallback mode.

  /**
   * ✅ Check if workflow or task has been cancelled/completed
   */
  private async checkWorkflowStatus(workflowId: string, taskId: string): Promise<void> {
    const workflow = await prisma.codingTaskWorkflow.findUnique({
      where: { id: workflowId },
      include: {
        task: true
      }
    })

    if (!workflow) {
      throw new Error('Workflow not found - may have been deleted')
    }

    if (workflow.status === 'CANCELLED') {
      throw new Error('Workflow has been cancelled')
    }

    if (workflow.task?.completed) {
      throw new Error('Task has been marked as completed')
    }

    // Task was deleted (orphaned workflow)
    if (!workflow.task) {
      throw new Error('Task has been deleted')
    }
  }

  /**
   * Complete workflow: plan → code → GitHub → PR
   */
  async executeCompleteWorkflow(workflowId: string, taskId: string): Promise<void> {
    try {
      this.currentPhase = 'STARTING'
      this.log('info', 'Starting complete workflow execution', { workflowId, taskId, traceId: this.traceId })

      // ✅ Initial status check
      await this.checkWorkflowStatus(workflowId, taskId)

      // Get workflow and task details
      const workflow = await prisma.codingTaskWorkflow.findUnique({
        where: { id: workflowId },
        include: {
          task: {
            include: {
              creator: true,
              lists: true
            }
          }
        }
      })

      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found`)
      }

      const task = workflow.task

      // ✅ Store trace ID in workflow metadata for debugging
      await prisma.codingTaskWorkflow.update({
        where: { id: workflowId },
        data: {
          metadata: {
            ...(workflow.metadata as any || {}),
            traceId: this.traceId,
            startedAt: new Date().toISOString()
          }
        }
      })

      // ✅ Read ASTRID.md from repository to get workflow steps
      let workflowSteps: string[] = []
      let astridMdContent = ''

      try {
        const repository = await resolveTargetRepo({
          lists: task.lists,
          creator: task.creator
        })

        const { GitHubClient } = await import('./github-client')
        const githubClient = await GitHubClient.forUser(this.userId)

        try {
          astridMdContent = await githubClient.getFile(repository, 'ASTRID.md')
          // Use extracted utility with logger callback
          workflowSteps = parseWorkflowStepsUtil(astridMdContent, (level, msg, meta) => this.log(level, msg, meta))

          this.log('info', 'Loaded ASTRID.md from repository', {
            repository,
            stepsFound: workflowSteps.length
          })
        } catch (fileError) {
          // ASTRID.md not found, use default workflow
          this.log('warn', 'ASTRID.md not found in repository, using default workflow', { repository })
          workflowSteps = DEFAULT_WORKFLOW_STEPS
        }
      } catch (repoError) {
        this.log('warn', 'Could not load repository workflow', {
          error: repoError instanceof Error ? repoError.message : 'Unknown error'
        })
        workflowSteps = MINIMAL_WORKFLOW_STEPS
      }

      this.log('info', 'Workflow metadata updated with trace ID', {
        workflowId,
        taskTitle: task.title
      })

      // Post immediate status update
      await this.postStatusComment(
        taskId,
        '🤖 **Starting work**',
        `Working on: **"${task.title}"**\n\nAnalyzing codebase...`
      )

      // ✅ Phase 2: Step 2 - PLANNING with dedicated context
      this.currentPhase = 'PLANNING'
      await this.updateWorkflowStatus(workflowId, 'PLANNING')
      this.log('info', 'Phase 2: Creating dedicated planning context', { taskTitle: task.title })

      // ✅ Check status before starting planning
      await this.checkWorkflowStatus(workflowId, taskId)

      // Add progress timeout - if planning takes >5 minutes, post update
      const planningTimeout = setTimeout(async () => {
        await this.postStatusComment(taskId, '🕒 **Still analyzing**', 'Taking longer than expected, still working...')
      }, 5 * 60 * 1000) // 5 minutes

      const planRequest: CodeGenerationRequest = {
        taskTitle: task.title,
        taskDescription: task.description,
        targetFramework: 'react-typescript' // Default for now
      }

      try {
        // ✅ Create dedicated orchestrator for planning (fresh context)
        const planningOrchestrator = await AIOrchestrator.createForTaskWithService(
          taskId,
          this.userId,
          this.aiService
        )

        const plan = await planningOrchestrator.generateImplementationPlan(planRequest)
        clearTimeout(planningTimeout)

        // ✅ Check status after planning completes
        await this.checkWorkflowStatus(workflowId, taskId)

        this.log('info', 'Planning phase complete (dedicated context)', {
          filesIdentified: plan.files.length,
          complexity: plan.estimatedComplexity,
          planningTraceId: planningOrchestrator.traceId
        })

        // ✅ Validate plan has at least one file before proceeding
        if (!plan.files || plan.files.length === 0) {
          // Include the AI's actual response so user can see what the model said
          const aiResponse = plan.rawPlanningResponse
            ? `\n\n**AI Response:**\n${plan.rawPlanningResponse.substring(0, 2000)}${plan.rawPlanningResponse.length > 2000 ? '\n...(truncated)' : ''}`
            : ''
          throw new Error(`Planning produced no files to modify.${aiResponse}\n\n**Please provide more specific task details or reply with clarification.**`)
        }

        // Step 3: Post plan and check if approval is required
        await this.postPlanComment(taskId, plan)

        // ✅ Check config for requirePlanApproval
        const config = await this.loadProjectConfig()
        if (config.safety.requirePlanApproval) {
          // Store plan in workflow metadata for later retrieval
          await prisma.codingTaskWorkflow.update({
            where: { id: workflowId },
            data: {
              status: 'AWAITING_APPROVAL',
              metadata: {
                plan: JSON.parse(JSON.stringify(plan)),
                awaitingApprovalSince: new Date().toISOString()
              }
            }
          })

          await this.postStatusComment(taskId, '⏸️ **Awaiting Approval**',
            `I've created an implementation plan with ${plan.files.length} file${plan.files.length === 1 ? '' : 's'}.\n\n` +
            `**Reply "approve" or "lgtm" to start implementation**, or provide feedback to revise the plan.`)

          this.log('info', 'Plan requires approval, workflow paused', {
            workflowId,
            filesInPlan: plan.files.length
          })

          return // Exit - will resume when user approves via comment
        }

        // ✅ Phase 2: Step 3 - IMPLEMENTATION with FRESH context (autonomous mode)
        this.currentPhase = 'IMPLEMENTING'
        await this.updateWorkflowStatus(workflowId, 'IMPLEMENTING')
        this.log('info', 'Phase 2: Creating fresh implementation context (no planning context carryover)')

        // ✅ Check status before starting implementation
        await this.checkWorkflowStatus(workflowId, taskId)

        await this.postStatusComment(taskId, '⚙️ **Implementing**',
          `Generating code for ${plan.files.length} file${plan.files.length === 1 ? '' : 's'}...`)

        // Step 4: Autonomous implementation with NEW orchestrator (fresh context)
        // ✅ This is critical: planning context doesn't leak into implementation
        const implementationOrchestrator = await AIOrchestrator.createForTaskWithService(
          taskId,
          this.userId,
          this.aiService
        )

        const codeRequest: CodeGenerationRequest = {
          taskTitle: task.title,
          taskDescription: task.description,
          targetFramework: 'react-typescript'
        }

        const generatedCode = await implementationOrchestrator.generateCode(codeRequest, plan)

        // ✅ Check status after implementation completes
        await this.checkWorkflowStatus(workflowId, taskId)

        this.log('info', 'Implementation phase complete (fresh context)', {
          filesGenerated: generatedCode.files.length,
          implementationTraceId: implementationOrchestrator.traceId
        })

        // ✅ Check if any files were generated before trying to commit
        if (generatedCode.files.length === 0) {
          throw new Error('Code generation produced no files. The AI may not have understood the task or hit iteration limits. Please try simplifying the task description or breaking it into smaller tasks.')
        }

        // Step 5: Create GitHub branch and commit changes
        this.currentPhase = 'GITHUB_OPERATIONS'
        this.log('info', 'Creating GitHub branch and PR')
        await this.createGitHubImplementation(workflow, generatedCode)

        this.currentPhase = 'COMPLETED'
        this.log('info', 'Workflow completed successfully', {
          workflowId,
          taskId,
          totalDuration: Date.now() - parseInt(this.traceId.split('-')[1])
        })
      } catch (error) {
        clearTimeout(planningTimeout)
        throw error
      }

    } catch (error) {
      this.log('error', 'Workflow execution failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        phase: this.currentPhase
      })

      await this.handleWorkflowError(workflowId, this.currentPhase || 'unknown', error)

      // ✅ Post error with trace ID for debugging
      await this.postStatusComment(taskId, '❌ **Error**', `Issue during ${this.currentPhase || 'execution'}:\n\n**${error instanceof Error ? error.message : 'Unknown error'}**\n\nTrace ID: \`${this.traceId}\``)
      throw error
    }
  }

  /**
   * Handle user approval and continue with implementation
   */
  async handlePlanApproval(workflowId: string, _approvalCommentId: string): Promise<void> {
    let taskId = ''

    try {
      this.log('info', 'Plan approved, starting implementation', { workflowId })

      const workflow = await prisma.codingTaskWorkflow.findUnique({
        where: { id: workflowId },
        include: { task: true }
      })

      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found`)
      }

      // Get the approved plan from workflow metadata
      const approvedPlan = workflow.metadata && typeof workflow.metadata === 'object' && 'plan' in workflow.metadata
        ? (workflow.metadata.plan as unknown) as ImplementationPlan
        : null

      if (!approvedPlan) {
        throw new Error('No approved plan found in workflow metadata')
      }

      taskId = workflow.task.id

      // Post implementation start message
      await this.postStatusComment(taskId, '⚙️ **Implementing**',
        `Plan approved! Starting implementation of ${approvedPlan.files.length} file${approvedPlan.files.length === 1 ? '' : 's'}...`)

      // Update status and start implementation
      await this.updateWorkflowStatus(workflowId, 'IMPLEMENTING')

      // Add implementation timeout - if takes >10 minutes, post update
      const implementationTimeout = setTimeout(async () => {
        await this.postStatusComment(taskId, '🔄 **Still implementing**', 'Taking longer than expected, still working...')
      }, 10 * 60 * 1000) // 10 minutes

      try {
        // Step 3: Generate code
        const codeRequest: CodeGenerationRequest = {
          taskTitle: workflow.task.title,
          taskDescription: workflow.task.description,
          targetFramework: 'react-typescript'
        }

        const generatedCode = await this.generateCode(codeRequest, approvedPlan)
        clearTimeout(implementationTimeout)

        // Post code generation complete
        await this.postStatusComment(taskId, '✅ **Code ready**',
          `Generated ${generatedCode.files.length} file${generatedCode.files.length === 1 ? '' : 's'}. Creating PR...`)

        // Step 4: Create GitHub branch and commit changes
        await this.createGitHubImplementation(workflow, generatedCode)

        this.log('info', 'Implementation completed successfully', { workflowId })

      } catch (error) {
        clearTimeout(implementationTimeout)
        throw error
      }

    } catch (error) {
      this.log('error', 'Implementation failed', { workflowId, error: error instanceof Error ? error.message : String(error) })
      await this.handleWorkflowError(workflowId, 'implementation', error)
      // Post error to user
      await this.postStatusComment(taskId, '❌ **Error**',
        `Implementation failed: **${error instanceof Error ? error.message : 'Unknown error'}**`)
      throw error
    }
  }

  /**
   * Create GitHub branch, commit code, and create PR
   * Delegates to the extracted GitHubWorkflowService
   */
  private async createGitHubImplementation(
    workflow: any,
    generatedCode: GeneratedCode
  ): Promise<void> {
    // Load config to get preview settings
    const config = await this.loadProjectConfig()

    const deps: GitHubWorkflowDependencies = {
      userId: this.userId,
      logger: (level, msg, meta) => this.log(level, msg, meta),
      postStatusComment: (taskId, title, msg) => this.postStatusComment(taskId, title, msg),
      postImplementationComment: (taskId, details) => this.postImplementationComment(taskId, details),
      previewConfig: config.preview,
    }
    await createGitHubImpl(workflow, generatedCode, deps)
  }

  /**
   * Call the appropriate AI service
   * @param systemBlocksOverride - Optional system blocks for progressive caching
   */
  private async callAIService(
    prompt: string,
    maxTokens: number = 8192,
    jsonOnly: boolean = false,
    systemBlocksOverride?: Array<{type: string, text: string, cache_control?: {type: string}}>
  ): Promise<string> {
    const apiKey = await getCachedApiKey(this.userId, this.aiService)

    if (!apiKey) {
      throw new Error(`No ${this.aiService} API key found for user`)
    }

    // Create tool execution callback that uses the orchestrator's internal state
    const executeToolCallback: ToolExecutionCallback = async (toolName, input) => {
      return this.executeTool(toolName, input)
    }

    // Call the unified provider interface
    const response = await callProvider({
      service: this.aiService,
      apiKey,
      prompt,
      maxTokens,
      jsonOnly,
      userId: this.userId,
      logger: (level, msg, meta) => this.log(level, msg, meta),
      hasRepository: !!this._repositoryId,
      executeToolCallback,
      systemBlocksOverride,
    })

    return response.content
  }

  /**
   * Execute a tool call (MCP operation)
   * Delegates to extracted MCP tool executor
   */
  private async executeTool(toolName: string, input: any): Promise<any> {
    const { GitHubClient } = await import('./github-client')
    const githubClient = await GitHubClient.forUser(this.userId)

    const deps: MCPToolDependencies = {
      repositoryId: this._repositoryId!,
      githubClient,
      logger: (level, msg, meta) => this.log(level, msg, meta),
      cacheExploredFile: (path, content, timestamp) => {
        this.exploredFiles.set(path, { content, timestamp })
      }
    }

    return executeMCPTool(toolName, input, deps)
  }

  /**
   * Build progressive system blocks with caching
   * Delegates to extracted system-blocks-builder service
   */
  private buildSystemBlocks(
    mode: 'planning' | 'implementation',
    planningContext?: PlanningContextData | PlanningContextFiles | null
  ): Array<{type: string, text: string, cache_control?: {type: string}}> {
    return buildSystemBlocksUtil(mode, this.astridMdContent, planningContext as PlanningContextData)
  }

  /**
   * Build prompt for implementation planning
   * Uses extracted template from lib/ai/prompts.ts
   */
  private async buildPlanningPrompt(request: CodeGenerationRequest): Promise<string> {
    return buildMinimalPlanningPrompt({
      taskTitle: request.taskTitle,
      taskDescription: request.taskDescription,
      targetFramework: request.targetFramework,
    })
  }

  /**
   * Build prompt for code generation
   * Delegates to extracted buildCodeGenerationPrompt utility
   */
  private getCodeGenerationPrompt(
    request: CodeGenerationRequest,
    plan: ImplementationPlan
  ): string {
    return buildCodeGenerationPrompt({
      taskTitle: request.taskTitle,
      taskDescription: request.taskDescription,
      plan: {
        summary: plan.summary,
        approach: plan.approach,
        files: plan.files,
        estimatedComplexity: plan.estimatedComplexity,
        considerations: plan.considerations,
      },
      exploredFiles: plan.exploredFiles,
    })
  }

  /**
   * Parse AI response into implementation plan
   */
  private parseImplementationPlan(response: string): ImplementationPlan {
    // Extract files using utility and map to known paths
    const filePaths = extractFilePaths(response)
    const exploredPaths = Array.from(this.exploredFiles.keys())
    const files = filePaths.map(path => {
      const mappedPath = mapToKnownPath(path, exploredPaths)
      if (mappedPath !== path) {
        this.log('info', 'Mapped AI hallucinated path to actual explored file', {
          aiPath: path,
          actualPath: mappedPath
        })
      }
      return {
        path: mappedPath,
        purpose: 'Component file',
        changes: 'Create/modify component'
      }
    })

    return {
      summary: extractSection(response, 'summary') || 'Implementation plan generated',
      approach: extractSection(response, 'approach') || response.substring(0, 200),
      files,
      estimatedComplexity: assessComplexity(response),
      considerations: extractConsiderations(response)
    }
  }

  /**
   * Parse AI response into generated code
   * Delegates to extracted parseGeneratedCode utility
   */
  private parseGeneratedCode(response: string): GeneratedCode {
    return parseGeneratedCodeUtil(response, (level, msg, meta) => this.log(level, msg, meta))
  }

  /**
   * Workflow management methods
   */
  private async updateWorkflowStatus(workflowId: string, status: string): Promise<void> {
    await prisma.codingTaskWorkflow.update({
      where: { id: workflowId },
      data: { status: status as any }
    })
  }

  private async handleWorkflowError(workflowId: string, step: string, error: any): Promise<void> {
    await prisma.codingTaskWorkflow.update({
      where: { id: workflowId },
      data: {
        status: 'FAILED',
        metadata: {
          error: error.message,
          step,
          timestamp: new Date().toISOString()
        }
      }
    })
  }

  /**
   * Comment posting methods using the proper AI agent service
   */
  private async postStatusComment(taskId: string, title: string, message: string): Promise<void> {
    const result = await createAIAgentComment(taskId, `${title}\n\n${message}`)
    if (!result.success) {
      this.log('error', 'Failed to post status comment', { taskId, error: result.error })
    }
  }

  private async postPlanComment(taskId: string, plan: ImplementationPlan): Promise<void> {
    const planComment = formatPlanComment(plan)
    const result = await createAIAgentComment(taskId, planComment)
    if (!result.success) {
      this.log('error', 'Failed to post plan comment', { taskId, error: result.error })
    }

    // Store plan in workflow metadata
    await prisma.codingTaskWorkflow.updateMany({
      where: { taskId },
      data: { metadata: { plan: plan as any } }
    })

    // Post plan to Astrid MCP task
    try { await this.postToAstridTask(taskId, formatPlanSummary(plan)) } catch { /* MCP optional */ }
  }

  private async postImplementationComment(taskId: string, details: ImplementationDetails): Promise<void> {
    const result = await createAIAgentComment(taskId, formatImplementationComment(details))
    if (!result.success) {
      this.log('error', 'Failed to post implementation comment', { taskId, error: result.error })
    }

    // Post completion to Astrid MCP task (optional)
    try { await this.postToAstridTask(taskId, formatCompletionSummary(details)) } catch { /* MCP optional */ }
  }

  /**
   * Post update to Astrid MCP task following Claude.md best practices
   */
  private async postToAstridTask(_taskId: string, _content: string): Promise<void> {
    // Placeholder for MCP integration - would use npx tsx scripts/add-task-comment.ts
  }

  /**
   * Handle change requests from user feedback
   */
  async handleChangeRequest(workflowId: string, taskId: string, feedback: string): Promise<void> {
    this.log('info', 'Handling change request', { workflowId, taskId, feedback: feedback.substring(0, 100) })

    try {
      // Get the current workflow
      const workflow = await prisma.codingTaskWorkflow.findUnique({
        where: { id: workflowId },
        include: {
          task: true
        }
      })

      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found`)
      }

      // Get the current plan and implementation details
      const currentPlan = workflow.metadata && typeof workflow.metadata === 'object' && 'plan' in workflow.metadata
        ? (workflow.metadata.plan as unknown) as ImplementationPlan
        : null

      // Create a revision prompt incorporating the feedback
      const revisionPrompt = `I need to revise my implementation based on user feedback.

ORIGINAL TASK: ${workflow.task.title}
${workflow.task.description ? `DESCRIPTION: ${workflow.task.description}` : ''}

CURRENT IMPLEMENTATION PLAN:
${currentPlan ? JSON.stringify(currentPlan, null, 2) : 'No plan available'}

USER FEEDBACK:
${feedback}

Please create a revised implementation plan that addresses the user's feedback. Focus on:
1. Understanding what the user wants changed
2. Modifying the existing approach to meet their requirements
3. Ensuring the solution remains technically sound

Generate a complete revised implementation including updated code.`

      // Generate revised implementation
      const revisedImplementation = await this.callAIService(revisionPrompt)

      // Extract and parse the revised code
      const revisedCode = this.parseGeneratedCode(revisedImplementation)

      // Initialize GitHub client
      const { GitHubClient } = await import('./github-client')
      const githubClient = await GitHubClient.forUser(this.userId)

      // Update the existing branch with new changes
      const repository = workflow.repositoryId!
      const branchName = workflow.workingBranch!

      await githubClient.commitChanges(
        repository,
        branchName,
        revisedCode.files.map((file: { path: string; content: string; action: 'create' | 'modify' | 'delete' }) => ({
          path: file.path,
          content: file.content,
          mode: file.action === 'create' ? 'create' : 'update'
        })),
        `${revisedCode.commitMessage}\n\nAddresses feedback: ${feedback.substring(0, 100)}...`
      )

      // Update Vercel deployment if available
      let vercelDeployment = null
      if (workflow.deploymentUrl) {
        try {
          const { VercelClient } = await import('./vercel-client')
        const vercelClient = new VercelClient()
          const deploymentResult = await vercelClient.deployPRBranch(
            repository,
            branchName
          )

          if (deploymentResult) {
            vercelDeployment = deploymentResult.deployment
          }
        } catch {
          // Continue without Vercel redeployment
        }
      }

      // Update workflow metadata
      await prisma.codingTaskWorkflow.update({
        where: { id: workflowId },
        data: {
          status: 'TESTING',
          deploymentUrl: vercelDeployment?.url || workflow.deploymentUrl,
          metadata: {
            ...workflow.metadata as any,
            revisedPlan: revisedCode,
            revisionFeedback: feedback,
            lastRevisionAt: new Date().toISOString(),
            deploymentId: vercelDeployment?.id || (workflow.metadata as any)?.deploymentId
          }
        }
      })

      // Post update comment as the AI agent
      await createAIAgentComment(
        taskId,
        `🔄 **Changes applied**

> ${feedback}

Updated PR #${workflow.pullRequestNumber}${vercelDeployment ? ` · [Preview](${vercelDeployment.url})` : workflow.deploymentUrl ? ` · [Preview](${workflow.deploymentUrl})` : ''}

Ready for review.`
      )

      this.log('info', 'Change request handled successfully', { workflowId })

    } catch (error) {
      this.log('error', 'Change request handling failed', { workflowId, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  /**
   * Handle retry with user feedback after a failed workflow
   * Re-runs planning phase with additional context from user
   */
  async handleRetryWithFeedback(
    workflowId: string,
    taskId: string,
    userFeedback: string,
    previousError: string
  ): Promise<void> {
    this.log('info', 'Handling retry with feedback', {
      workflowId,
      taskId,
      feedback: userFeedback.substring(0, 100),
      previousError: previousError.substring(0, 100)
    })

    try {
      // Get the current workflow and task
      const workflow = await prisma.codingTaskWorkflow.findUnique({
        where: { id: workflowId },
        include: { task: true }
      })

      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found`)
      }

      // Update workflow status to indicate retry in progress
      await prisma.codingTaskWorkflow.update({
        where: { id: workflowId },
        data: { status: 'PLANNING' }
      })

      // Create enhanced task description incorporating user feedback
      const enhancedDescription = `${workflow.task.description || ''}

## User Clarification (after previous attempt failed)

The previous attempt failed with: "${previousError}"

User provided this clarification:
> ${userFeedback}

Please use this additional context to better understand what needs to be done.`

      // Create a new planning request with enhanced context
      const planRequest: CodeGenerationRequest = {
        taskTitle: workflow.task.title,
        taskDescription: enhancedDescription,
        targetFramework: 'react-typescript'
      }

      // Re-run the planning phase
      const plan = await this.generateImplementationPlan(planRequest)

      // Check if we got a valid plan this time
      if (!plan.files || plan.files.length === 0) {
        // Still no files - include the AI response for the user
        const aiResponse = plan.rawPlanningResponse
          ? `\n\n**AI Response:**\n${plan.rawPlanningResponse.substring(0, 2000)}${plan.rawPlanningResponse.length > 2000 ? '\n...(truncated)' : ''}`
          : ''

        await this.postStatusComment(taskId, '❌ **Planning still unsuccessful**',
          `Even with your clarification, I couldn't identify files to modify.${aiResponse}\n\n**Please provide more specific details about:**\n- Which files or components need changes\n- What specific behavior you want to achieve\n- Any error messages or symptoms you're seeing`)

        // Mark as failed again
        await prisma.codingTaskWorkflow.update({
          where: { id: workflowId },
          data: {
            status: 'FAILED',
            metadata: {
              error: 'Planning still produced no files after retry with feedback',
              step: 'PLANNING_RETRY',
              userFeedback,
              previousError,
              timestamp: new Date().toISOString()
            }
          }
        })

        return
      }

      // Success! Post the plan and continue
      await this.postPlanComment(taskId, plan)

      // Check config for requirePlanApproval
      const config = await this.loadProjectConfig()
      if (config.safety.requirePlanApproval) {
        // Store plan and wait for approval
        await prisma.codingTaskWorkflow.update({
          where: { id: workflowId },
          data: {
            status: 'AWAITING_APPROVAL',
            metadata: {
              plan: JSON.parse(JSON.stringify(plan)),
              awaitingApprovalSince: new Date().toISOString(),
              retriedWithFeedback: true
            }
          }
        })

        await this.postStatusComment(taskId, '⏸️ **Awaiting Approval**',
          `I've created an implementation plan with ${plan.files.length} file${plan.files.length === 1 ? '' : 's'}.\n\n` +
          `**Reply "approve" or "lgtm" to start implementation**, or provide more feedback to revise.`)

        return
      }

      // Auto-approve mode - continue to implementation
      await this.postStatusComment(taskId, '⚙️ **Implementing**',
        `Generating code for ${plan.files.length} file${plan.files.length === 1 ? '' : 's'}...`)

      // Update status
      await prisma.codingTaskWorkflow.update({
        where: { id: workflowId },
        data: { status: 'IMPLEMENTING' }
      })

      // Generate code
      const codeRequest: CodeGenerationRequest = {
        taskTitle: workflow.task.title,
        taskDescription: enhancedDescription,
        targetFramework: 'react-typescript'
      }

      const generatedCode = await this.generateCode(codeRequest, plan)

      if (generatedCode.files.length === 0) {
        throw new Error('Code generation produced no files even after retry')
      }

      // Create GitHub implementation
      await this.createGitHubImplementation(workflow, generatedCode)

      this.log('info', 'Retry with feedback completed successfully', { workflowId })

    } catch (error) {
      this.log('error', 'Retry with feedback failed', {
        workflowId,
        error: error instanceof Error ? error.message : String(error)
      })

      // Mark as failed
      await prisma.codingTaskWorkflow.update({
        where: { id: workflowId },
        data: {
          status: 'FAILED',
          metadata: {
            error: error instanceof Error ? error.message : String(error),
            step: 'RETRY_WITH_FEEDBACK',
            userFeedback,
            previousError,
            timestamp: new Date().toISOString()
          }
        }
      })

      // Post error comment
      await this.postStatusComment(taskId, '❌ **Retry Failed**',
        `Even with your clarification, I encountered an error:\n\n**${error instanceof Error ? error.message : 'Unknown error'}**\n\nPlease try providing more specific details or reassign the task.`)

      throw error
    }
  }

  /**
   * Generate an intelligent comment response using AI API
   * Public method for use in comment handling
   */
  async generateCommentResponse(prompt: string): Promise<string> {
    return await this.callAIService(prompt)
  }
}

export default AIOrchestrator
