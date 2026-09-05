import { TRUSTED_AGENT_POLICY, serializeUntrustedAgentData } from '@/lib/ai/prompt-trust'
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
import {
  postStatusComment as postStatusCommentImpl,
  postPlanComment as postPlanCommentImpl,
  postImplementationComment as postImplementationCommentImpl,
  postToAstridTask as postToAstridTaskImpl,
} from './ai/orchestrator/comment-poster'
import {
  checkWorkflowStatus as checkWorkflowStatusImpl,
  updateWorkflowStatus as updateWorkflowStatusImpl,
  handleWorkflowError as handleWorkflowErrorImpl,
} from './ai/orchestrator/workflow-status'
import {
  storePlanningContext as storePlanningContextImpl,
  loadPlanningContext as loadPlanningContextImpl,
} from './ai/orchestrator/planning-context'
import {
  createForTask as createForTaskImpl,
  createForTaskWithService as createForTaskWithServiceImpl,
} from './ai/orchestrator/factory'
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
  countBraceBalance,
  parseGeneratedCode as parseGeneratedCodeUtil,
  parseImplementationPlan as parseImplementationPlanUtil,
} from './ai/response-parser'
import { CONFIG_DEFAULTS } from './ai/config/defaults'
import type { ResolvedAstridConfig } from './ai/config/schema'
import {
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
   * Bind this orchestrator to a specific task. Used by the factory module
   * during construction; kept as a method (rather than mutating the field
   * externally) so currentTaskId can stay private.
   */
  setCurrentTaskId(taskId: string): void {
    this.currentTaskId = taskId
  }

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
   * Persist planning context for implementation phase pickup.
   * Delegates to lib/ai/orchestrator/planning-context.ts.
   */
  private async storePlanningContext(plan: ImplementationPlan): Promise<void> {
    if (!this.currentTaskId) {
      this.log('warn', 'No task ID set, cannot store planning context')
      return
    }
    await storePlanningContextImpl({
      taskId: this.currentTaskId,
      plan,
      exploredFiles: this.exploredFiles,
      astridMdContent: this.astridMdContent,
    })
  }

  /**
   * Load planning context from the most recent workflow row for this task.
   * Side-effect: rehydrates `this.astridMdContent` if it was cached and the
   * orchestrator hasn't loaded it yet (matches pre-extraction behavior).
   */
   
  private async loadPlanningContext(): Promise<any | null> {
    if (!this.currentTaskId) {
      this.log('warn', 'No task ID set, cannot load planning context')
      return null
    }
    const planningContext = await loadPlanningContextImpl({ taskId: this.currentTaskId })
    if (planningContext?.astridMdContent && !this.astridMdContent) {
      this.astridMdContent = planningContext.astridMdContent
      this.log('info', 'Restored ASTRID.md from planning context')
    }
    return planningContext
  }

  /**
   * Load ASTRID.md for progressive context caching.
   * Public so the factory module can invoke it during construction.
   * Delegates to the extracted repository-context-loader service.
   */
  async loadAstridMd(): Promise<void> {
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

  /** Create an AIOrchestrator for a specific AI agent service. */
  static createForTaskWithService(
    taskId: string,
    userId: string,
    aiService: AIService,
  ): Promise<AIOrchestrator> {
    return createForTaskWithServiceImpl(AIOrchestrator, taskId, userId, aiService)
  }

  /** Create an AIOrchestrator with optimal configuration based on the task's
   *  assigned agent. See lib/ai/orchestrator/factory.ts for provider priority. */
  static createForTask(taskId: string, userId: string): Promise<AIOrchestrator> {
    return createForTaskImpl(AIOrchestrator, taskId, userId)
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
  /**
   * Generate code from an approved plan. Saga pipeline of named in-class
   * sub-steps following the pattern from PRs #97/#98/#105:
   *
   *   validateGenerationPlan       — run plan / file-size validators (throws)
   *   loadGenerationContext        — load planning context, with safety net
   *   buildSystemBlocks/getPrompt  — existing helpers
   *   callAndParseGeneration       — call AI + parse, with format-retry fallback
   *   finalizeGeneration           — filter generated files to plan + log result
   */
  async generateCode(
    request: CodeGenerationRequest,
    approvedPlan: ImplementationPlan,
  ): Promise<GeneratedCode> {
    this.log('info', 'Generating code with progressive context from planning phase')

    await this.validateGenerationPlan(approvedPlan)
    const planningContext = await this.loadGenerationContext(approvedPlan)

    const systemBlocks = this.buildSystemBlocks('implementation', planningContext)
    const prompt = this.getCodeGenerationPrompt(request, approvedPlan)

    const generatedCode = await this.callAndParseGeneration({
      prompt,
      systemBlocks,
      approvedPlan,
      planningContext,
    })

    return this.finalizeGeneration({ generatedCode, approvedPlan, systemBlocks, planningContext })
  }

  /** Validate plan structure (de-dupe files) and individual file sizes. Throws on failure. */
  private async validateGenerationPlan(approvedPlan: ImplementationPlan): Promise<void> {
    const validationResult = validateAndDeduplicatePlan(
      approvedPlan,
      (level, msg, meta) => this.log(level, msg, meta),
    )
    if (!validationResult.success) {
      throw new Error(validationResult.error)
    }

    await validateFileSizes(
      approvedPlan,
      {
        repositoryId: this._repositoryId!,
        userId: this.userId,
        logger: (level, msg, meta) => this.log(level, msg, meta),
      },
      async (userId) => {
        const { GitHubClient } = await import('./github-client')
        return GitHubClient.forUser(userId) as Promise<FileValidatorGitHubClient>
      },
    )
  }

  /** Load planning context from prior phase, or fall back to direct file load
   *  if it's missing or empty (safety net for restarts). */
  private async loadGenerationContext(
    approvedPlan: ImplementationPlan,
  ): Promise<PlanningContextFiles | null> {
    let planningContext: PlanningContextFiles | null = await this.loadPlanningContext()

    if (!planningContext) {
      this.log('warn', 'No planning context found, implementation will use minimal context')
    }

    if (!planningContext || !planningContext.exploredFiles || planningContext.exploredFiles.length === 0) {
      planningContext = await loadFilesDirectly(
        approvedPlan,
        planningContext,
        {
          repositoryId: this._repositoryId!,
          userId: this.userId,
          logger: (level, msg, meta) => this.log(level, msg, meta),
        },
        async (userId) => {
          const { GitHubClient } = await import('./github-client')
          return GitHubClient.forUser(userId) as Promise<FileValidatorGitHubClient>
        },
      )
    }

    return planningContext
  }

  /** Initial AI call + parse. If the parser raises RETRY_WITH_FORMAT_ENFORCEMENT,
   *  re-prompt the model with explicit format instructions and try again. */
  private async callAndParseGeneration(args: {
    prompt: string
    systemBlocks: ClaudeSystemBlock[]
    approvedPlan: ImplementationPlan
    planningContext: PlanningContextFiles | null
  }): Promise<GeneratedCode> {
    const { prompt, systemBlocks, approvedPlan, planningContext } = args

    const response = await this.callAIService(prompt, 8192, true, systemBlocks)

    try {
      return this.parseGeneratedCode(response)
    } catch (error) {
      if (error instanceof Error && error.message === 'RETRY_WITH_FORMAT_ENFORCEMENT') {
        return this.retryGenerationWithFormatEnforcement({
          originalPrompt: prompt,
          systemBlocks,
          approvedPlan,
          planningContext,
        })
      }
      throw error
    }
  }

  /** Re-prompt the model with explicit JSON-only format instructions, then
   *  parse again. On second-attempt failure, throws a diagnostics-rich error. */
  private async retryGenerationWithFormatEnforcement(args: {
    originalPrompt: string
    systemBlocks: ClaudeSystemBlock[]
    approvedPlan: ImplementationPlan
    planningContext: PlanningContextFiles | null
  }): Promise<GeneratedCode> {
    const { originalPrompt, systemBlocks, approvedPlan, planningContext } = args

    this.log('warn', 'AI response was not in expected format, retrying with format enforcement')

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
${originalPrompt}

Respond with ONLY the JSON object as specified above.`

    const response = await this.callAIService(formatEnforcementPrompt, 8192, true, systemBlocks)

    try {
      const generatedCode = this.parseGeneratedCode(response)
      this.log('info', 'Successfully parsed response after format enforcement retry')
      return generatedCode
    } catch (retryError) {
      throw this.buildGenerationFailureError({
        response,
        retryError,
        approvedPlan,
        planningContext,
      })
    }
  }

  /** Build a diagnostics-rich Error after format-enforcement retry has failed.
   *  Logs the full diagnostics object and returns a user-facing Error with the
   *  most actionable subset embedded in the message. */
  private buildGenerationFailureError(args: {
    response: string
    retryError: unknown
    approvedPlan: ImplementationPlan
    planningContext: PlanningContextFiles | null
  }): Error {
    const { response, retryError, approvedPlan, planningContext } = args

    const diagnostics = {
      responseLength: response.length,
      responsePreview: response.substring(0, 1000),
      responseTail: response.length > 1000 ? response.substring(response.length - 500) : '',
      responseMiddle: response.length > 2000
        ? response.substring(Math.floor(response.length / 2) - 250, Math.floor(response.length / 2) + 250)
        : '',
      error: retryError instanceof Error ? retryError.message : String(retryError),
      attemptedPatterns: [
        'Pure JSON parse',
        'Markdown code block extraction',
        'Balanced brace matching',
        'Regex JSON object search',
        'First-to-last brace extraction',
        'Markdown file header patterns',
      ],
      hasJsonCodeBlock: response.includes('```json'),
      hasCodeBlock: response.includes('```'),
      hasFilesKey: response.includes('"files"'),
      hasBraces: response.includes('{') && response.includes('}'),
      braceBalance: countBraceBalance(response),
      firstBraceIndex: response.indexOf('{'),
      lastBraceIndex: response.lastIndexOf('}'),
      attemptedFiles: approvedPlan.files.map(f => ({
        path: f.path,
        estimatedSize:
          planningContext?.exploredFiles?.find((ef: any) => ef.path === f.path)?.content?.length ||
          'unknown',
      })),
      largestFile:
        planningContext?.exploredFiles?.reduce(
          (largest: any, file: any) =>
            (file.content?.length || 0) > (largest?.content?.length || 0) ? file : largest,
          null,
        )?.path || 'unknown',
      totalContextSize:
        planningContext?.exploredFiles?.reduce(
          (sum: number, file: any) => sum + (file.content?.length || 0),
          0,
        ) || 0,
    }

    this.log('error', 'Failed to parse AI response even after format enforcement', diagnostics)

    const errorPreview = response.length > 1000
      ? response.substring(0, 1000) + '\n\n... (truncated, full response logged)'
      : response
    const actualError = retryError instanceof Error ? retryError.message : String(retryError)

    let errorMessage = 'AI did not return code in the expected format after retry.\n\n'
    errorMessage += `Parsing error: ${actualError}\n\n`

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

    if (diagnostics.totalContextSize > 50000) {
      errorMessage += `\n⚠️ Large files detected in context (${Math.round(diagnostics.totalContextSize / 1024)}KB total).\n`
      errorMessage += `   Largest file: ${diagnostics.largestFile}\n`
      errorMessage += '   Large files often cause JSON parsing failures.\n'
    }

    errorMessage += `\nResponse preview (first 1000 chars):\n${errorPreview}\n\n`
    errorMessage += 'The AI may need more specific instructions or the response may be too large. '
    errorMessage += 'Try simplifying the task or breaking it into smaller steps.'

    return new Error(errorMessage)
  }

  /** Filter the generated files to those in the approved plan and log the result. */
  private finalizeGeneration(args: {
    generatedCode: GeneratedCode
    approvedPlan: ImplementationPlan
    systemBlocks: ClaudeSystemBlock[]
    planningContext: PlanningContextFiles | null
  }): GeneratedCode {
    const { generatedCode, approvedPlan, systemBlocks, planningContext } = args

    const plannedPaths = new Set(approvedPlan.files.map(f => f.path))
    generatedCode.files = filterGeneratedCode(
      generatedCode.files,
      plannedPaths,
      (level, msg, meta) => this.log(level, msg, meta),
    )

    this.log('info', 'Code generation completed with progressive context', {
      filesGenerated: generatedCode.files.length,
      paths: generatedCode.files.map(f => f.path),
      systemBlocksCount: systemBlocks.length,
      cachedLayers: systemBlocks.filter(b => b.cache_control).length,
      hadPlanningContext: !!planningContext,
    })

    return generatedCode
  }

    // NOTE: generateCodeWithSDK and generateCodeSmart removed — built-in executors stripped.
  // Code generation now dispatches to external agent runtimes via webhooks/SSE.
  // Use generateCode() for basic/fallback mode.

  /**
   * ✅ Check if workflow or task has been cancelled/completed
   */
  private checkWorkflowStatus(workflowId: string, _taskId: string): Promise<void> {
    return checkWorkflowStatusImpl(workflowId)
  }

  /**
   * Complete workflow: plan → code → GitHub → PR
   */
  /**
   * The main workflow saga: load → plan → (optional approval gate) →
   * implement → ship to GitHub. Each phase is its own named sub-step
   * below so the top-level reads as a pipeline rather than a 230-line
   * try/catch.
   */
  async executeCompleteWorkflow(workflowId: string, taskId: string): Promise<void> {
    try {
      const ctx = await this.startWorkflow(workflowId, taskId)
      const plan = await this.runPlanningPhase(ctx)

      if (await this.shouldPauseForApproval(plan, ctx)) {
        // Workflow paused — resumes via handlePlanApproval when user replies.
        return
      }

      await this.runImplementationPhase(plan, ctx)
    } catch (error) {
      await this.failWorkflow(workflowId, taskId, error)
      throw error
    }
  }

  /** Phase 1: load workflow + task, store trace ID, post the kick-off comment. */
  private async startWorkflow(workflowId: string, taskId: string): Promise<{
    workflowId: string
    taskId: string
    workflow: any
    task: any
  }> {
    this.currentPhase = 'STARTING'
    this.log('info', 'Starting complete workflow execution', { workflowId, taskId, traceId: this.traceId })

    await this.checkWorkflowStatus(workflowId, taskId)

    const workflow = await prisma.codingTaskWorkflow.findUnique({
      where: { id: workflowId },
      include: {
        task: { include: { creator: true, lists: true } },
      },
    })

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`)
    }

    // Store trace ID in workflow metadata for debugging across phases.
    await prisma.codingTaskWorkflow.update({
      where: { id: workflowId },
      data: {
        metadata: {
          ...(workflow.metadata as any || {}),
          traceId: this.traceId,
          startedAt: new Date().toISOString(),
        },
      },
    })

    // ASTRID.md is loaded best-effort — workflow steps from it would feed
    // the comment templates. Today the result is logged but not yet wired
    // into the rest of the saga; keeping the read here so the warm cache
    // benefits later phases that re-invoke loadAstridMd().
    await this.loadWorkflowSteps(workflow.task)

    this.log('info', 'Workflow metadata updated with trace ID', { workflowId, taskTitle: workflow.task.title })

    await this.postStatusComment(
      taskId,
      '🤖 **Starting work**',
      `Working on: **"${workflow.task.title}"**\n\nAnalyzing codebase...`,
    )

    return { workflowId, taskId, workflow, task: workflow.task }
  }

  /** Try to load workflow steps from ASTRID.md; fall back to defaults. */
  private async loadWorkflowSteps(task: any): Promise<string[]> {
    try {
      const repository = await resolveTargetRepo({ lists: task.lists, creator: task.creator })
      const { GitHubClient } = await import('./github-client')
      const githubClient = await GitHubClient.forUser(this.userId)

      try {
        const astridMdContent = await githubClient.getFile(repository, 'ASTRID.md')
        const steps = parseWorkflowStepsUtil(astridMdContent, (level, msg, meta) => this.log(level, msg, meta))
        this.log('info', 'Loaded ASTRID.md from repository', { repository, stepsFound: steps.length })
        return steps
      } catch (_fileError) {
        this.log('warn', 'ASTRID.md not found in repository, using default workflow', { repository })
        return DEFAULT_WORKFLOW_STEPS
      }
    } catch (repoError) {
      this.log('warn', 'Could not load repository workflow', {
        error: repoError instanceof Error ? repoError.message : 'Unknown error',
      })
      return MINIMAL_WORKFLOW_STEPS
    }
  }

  /**
   * Phase 2: dedicated-context planning.
   *
   * Spawns a fresh AIOrchestrator just for the planning AI call so the
   * model's context window isn't polluted by everything we'll later
   * stuff into it for implementation. Returns the validated plan.
   */
  private async runPlanningPhase(ctx: { workflowId: string; taskId: string; task: any }): Promise<ImplementationPlan> {
    const { workflowId, taskId, task } = ctx

    this.currentPhase = 'PLANNING'
    await this.updateWorkflowStatus(workflowId, 'PLANNING')
    this.log('info', 'Phase 2: Creating dedicated planning context', { taskTitle: task.title })
    await this.checkWorkflowStatus(workflowId, taskId)

    // 5min progress nudge so the user knows we're alive on long planning.
    const planningTimeout = setTimeout(async () => {
      await this.postStatusComment(taskId, '🕒 **Still analyzing**', 'Taking longer than expected, still working...')
    }, 5 * 60 * 1000)

    try {
      const planningOrchestrator = await AIOrchestrator.createForTaskWithService(taskId, this.userId, this.aiService)

      const plan = await planningOrchestrator.generateImplementationPlan({
        taskTitle: task.title,
        taskDescription: task.description,
        targetFramework: 'react-typescript',
      })

      clearTimeout(planningTimeout)
      await this.checkWorkflowStatus(workflowId, taskId)

      this.log('info', 'Planning phase complete (dedicated context)', {
        filesIdentified: plan.files.length,
        complexity: plan.estimatedComplexity,
        planningTraceId: planningOrchestrator.traceId,
      })

      if (!plan.files || plan.files.length === 0) {
        const aiResponse = plan.rawPlanningResponse
          ? `\n\n**AI Response:**\n${plan.rawPlanningResponse.substring(0, 2000)}${plan.rawPlanningResponse.length > 2000 ? '\n...(truncated)' : ''}`
          : ''
        throw new Error(`Planning produced no files to modify.${aiResponse}\n\n**Please provide more specific task details or reply with clarification.**`)
      }

      await this.postPlanComment(taskId, plan)
      return plan
    } catch (error) {
      clearTimeout(planningTimeout)
      throw error
    }
  }

  /**
   * If the project config requires plan approval, persist the plan into
   * workflow metadata, post the awaiting-approval message, and return
   * true so the saga exits. handlePlanApproval picks up where this left
   * off when the user replies "approve"/"lgtm".
   */
  private async shouldPauseForApproval(plan: ImplementationPlan, ctx: { workflowId: string; taskId: string }): Promise<boolean> {
    const { workflowId, taskId } = ctx
    const config = await this.loadProjectConfig()

    if (!config.safety.requirePlanApproval) return false

    await prisma.codingTaskWorkflow.update({
      where: { id: workflowId },
      data: {
        status: 'AWAITING_APPROVAL',
        metadata: {
          plan: JSON.parse(JSON.stringify(plan)),
          awaitingApprovalSince: new Date().toISOString(),
        },
      },
    })

    await this.postStatusComment(
      taskId,
      '⏸️ **Awaiting Approval**',
      `I've created an implementation plan with ${plan.files.length} file${plan.files.length === 1 ? '' : 's'}.\n\n` +
        `**Reply "approve" or "lgtm" to start implementation**, or provide feedback to revise the plan.`,
    )

    this.log('info', 'Plan requires approval, workflow paused', { workflowId, filesInPlan: plan.files.length })
    return true
  }

  /**
   * Phase 3: fresh-context implementation.
   *
   * Spawns yet another fresh AIOrchestrator so the planning context
   * doesn't leak into code generation — that separation is the whole
   * reason executeCompleteWorkflow is two phases instead of one big
   * AI call.
   */
  private async runImplementationPhase(plan: ImplementationPlan, ctx: { workflowId: string; taskId: string; workflow: any; task: any }): Promise<void> {
    const { workflowId, taskId, workflow, task } = ctx

    this.currentPhase = 'IMPLEMENTING'
    await this.updateWorkflowStatus(workflowId, 'IMPLEMENTING')
    this.log('info', 'Phase 2: Creating fresh implementation context (no planning context carryover)')
    await this.checkWorkflowStatus(workflowId, taskId)

    await this.postStatusComment(
      taskId,
      '⚙️ **Implementing**',
      `Generating code for ${plan.files.length} file${plan.files.length === 1 ? '' : 's'}...`,
    )

    const implementationOrchestrator = await AIOrchestrator.createForTaskWithService(taskId, this.userId, this.aiService)

    const generatedCode = await implementationOrchestrator.generateCode(
      {
        taskTitle: task.title,
        taskDescription: task.description,
        targetFramework: 'react-typescript',
      },
      plan,
    )

    await this.checkWorkflowStatus(workflowId, taskId)

    this.log('info', 'Implementation phase complete (fresh context)', {
      filesGenerated: generatedCode.files.length,
      implementationTraceId: implementationOrchestrator.traceId,
    })

    if (generatedCode.files.length === 0) {
      throw new Error('Code generation produced no files. The AI may not have understood the task or hit iteration limits. Please try simplifying the task description or breaking it into smaller tasks.')
    }

    this.currentPhase = 'GITHUB_OPERATIONS'
    this.log('info', 'Creating GitHub branch and PR')
    await this.createGitHubImplementation(workflow, generatedCode)

    this.currentPhase = 'COMPLETED'
    this.log('info', 'Workflow completed successfully', {
      workflowId,
      taskId,
      totalDuration: Date.now() - parseInt(this.traceId.split('-')[1]),
    })
  }

  /** Saga-failure handler: log, mark workflow FAILED, post user-facing error. */
  private async failWorkflow(workflowId: string, taskId: string, error: unknown): Promise<void> {
    this.log('error', 'Workflow execution failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      phase: this.currentPhase,
    })

    await this.handleWorkflowError(workflowId, this.currentPhase || 'unknown', error)

    await this.postStatusComment(
      taskId,
      '❌ **Error**',
      `Issue during ${this.currentPhase || 'execution'}:\n\n**${error instanceof Error ? error.message : 'Unknown error'}**\n\nTrace ID: \`${this.traceId}\``,
    )
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

  /** Delegates to the extracted parseImplementationPlan utility. */
  private parseImplementationPlan(response: string): ImplementationPlan {
    return parseImplementationPlanUtil(
      response,
      Array.from(this.exploredFiles.keys()),
      (level, msg, meta) => this.log(level, msg, meta),
    )
  }

  /**
   * Parse AI response into generated code
   * Delegates to extracted parseGeneratedCode utility
   */
  private parseGeneratedCode(response: string): GeneratedCode {
    return parseGeneratedCodeUtil(response, (level, msg, meta) => this.log(level, msg, meta))
  }

  /**
   * Workflow management methods (delegating to lib/ai/orchestrator/workflow-status.ts)
   */
  private updateWorkflowStatus(workflowId: string, status: string): Promise<void> {
    return updateWorkflowStatusImpl(workflowId, status)
  }

  private handleWorkflowError(workflowId: string, step: string, error: unknown): Promise<void> {
    return handleWorkflowErrorImpl(workflowId, step, error)
  }

  /**
   * Comment posting methods using the proper AI agent service
   */
  private postStatusComment(taskId: string, title: string, message: string): Promise<void> {
    return postStatusCommentImpl(taskId, title, message, this.traceId)
  }

  private postPlanComment(taskId: string, plan: ImplementationPlan): Promise<void> {
    return postPlanCommentImpl(taskId, plan, this.traceId)
  }

  private postImplementationComment(taskId: string, details: ImplementationDetails): Promise<void> {
    return postImplementationCommentImpl(taskId, details, this.traceId)
  }

  private postToAstridTask(taskId: string, content: string): Promise<void> {
    return postToAstridTaskImpl(taskId, content)
  }

  /**
   * Handle change requests from user feedback
   */
  /**
   * Apply user feedback to an already-implemented workflow: regenerate
   * code from the feedback, push to the existing PR branch, redeploy the
   * preview if there is one, and post an "✅ changes applied" comment.
   *
   * Saga pipeline of named in-class sub-steps; mirrors the structure of
   * executeCompleteWorkflow / handleRetryWithFeedback.
   */
  async handleChangeRequest(workflowId: string, taskId: string, feedback: string): Promise<void> {
    this.log('info', 'Handling change request', { workflowId, taskId, feedback: feedback.substring(0, 100) })

    try {
      const workflow = await this.loadChangeRequestWorkflow(workflowId)
      const revisedCode = await this.generateRevisedImplementation(workflow, feedback)
      await this.applyRevisedCodeToBranch(workflow, revisedCode, feedback)
      const vercelDeployment = await this.redeployPreviewIfNeeded(workflow)
      await this.persistRevisionAndNotify({ workflow, taskId, revisedCode, feedback, vercelDeployment })

      this.log('info', 'Change request handled successfully', { workflowId })
    } catch (error) {
      this.log('error', 'Change request handling failed', { workflowId, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  /** Fetch the workflow + its task. Throws if the workflow is missing. */
  private async loadChangeRequestWorkflow(workflowId: string) {
    const workflow = await prisma.codingTaskWorkflow.findUnique({
      where: { id: workflowId },
      include: { task: true },
    })
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`)
    }
    return workflow
  }

  /** Build a revision prompt from the existing plan + user feedback,
   *  call the AI service, and parse the response into GeneratedCode. */
  private async generateRevisedImplementation(
    workflow: { task: { title: string; description: string | null }; metadata: unknown },
    feedback: string,
  ): Promise<GeneratedCode> {
    const currentPlan = workflow.metadata && typeof workflow.metadata === 'object' && 'plan' in workflow.metadata
      ? ((workflow.metadata as { plan: unknown }).plan as ImplementationPlan)
      : null

    // Task text and user feedback are user-authored data, not instructions
    // (task 0672b69b). Same envelope the assistant workflow already uses.
    const revisionPrompt = `${TRUSTED_AGENT_POLICY}

I need to revise my implementation based on user feedback.

ORIGINAL TASK:
<untrusted_task_data format="json">
${serializeUntrustedAgentData({
  title: workflow.task.title,
  description: workflow.task.description || null,
})}
</untrusted_task_data>

CURRENT IMPLEMENTATION PLAN:
${currentPlan ? JSON.stringify(currentPlan, null, 2) : 'No plan available'}

USER FEEDBACK:
<untrusted_user_feedback format="json">
${serializeUntrustedAgentData(feedback)}
</untrusted_user_feedback>

Please create a revised implementation plan that addresses the user's feedback. Focus on:
1. Understanding what the user wants changed
2. Modifying the existing approach to meet their requirements
3. Ensuring the solution remains technically sound

Generate a complete revised implementation including updated code.`

    const revisedImplementation = await this.callAIService(revisionPrompt)
    return this.parseGeneratedCode(revisedImplementation)
  }

  /** Push the revised file set to the workflow's existing PR branch. */
  private async applyRevisedCodeToBranch(
    workflow: { repositoryId: string | null; workingBranch: string | null },
    revisedCode: GeneratedCode,
    feedback: string,
  ): Promise<void> {
    const { GitHubClient } = await import('./github-client')
    const githubClient = await GitHubClient.forUser(this.userId)

    const repository = workflow.repositoryId!
    const branchName = workflow.workingBranch!

    await githubClient.commitChanges(
      repository,
      branchName,
      revisedCode.files.map(file => ({
        path: file.path,
        content: file.content,
        mode: file.action === 'create' ? 'create' : 'update',
      })),
      `${revisedCode.commitMessage}\n\nAddresses feedback: ${feedback.substring(0, 100)}...`,
    )
  }

  /** Best-effort Vercel redeploy of the workflow's preview, if one exists.
   *  Returns the new deployment or null on no-op / failure. */
  private async redeployPreviewIfNeeded(workflow: {
    repositoryId: string | null
    workingBranch: string | null
    deploymentUrl: string | null
  }): Promise<{ url: string; id?: string } | null> {
    if (!workflow.deploymentUrl) return null

    try {
      const { VercelClient } = await import('./vercel-client')
      const vercelClient = new VercelClient()
      const deploymentResult = await vercelClient.deployPRBranch(
        workflow.repositoryId!,
        workflow.workingBranch!,
      )
      return deploymentResult?.deployment ?? null
    } catch {
      return null
    }
  }

  /** Persist the revision into workflow metadata and post the
   *  "🔄 Changes applied" comment to the task. */
  private async persistRevisionAndNotify(args: {
    workflow: {
      id: string
      pullRequestNumber: number | null
      deploymentUrl: string | null
      metadata: unknown
    }
    taskId: string
    revisedCode: GeneratedCode
    feedback: string
    vercelDeployment: { url: string; id?: string } | null
  }): Promise<void> {
    const { workflow, taskId, revisedCode, feedback, vercelDeployment } = args

    await prisma.codingTaskWorkflow.update({
      where: { id: workflow.id },
      data: {
        status: 'TESTING',
        deploymentUrl: vercelDeployment?.url || workflow.deploymentUrl,
        metadata: {
          ...(workflow.metadata as any),
          revisedPlan: revisedCode,
          revisionFeedback: feedback,
          lastRevisionAt: new Date().toISOString(),
          deploymentId: vercelDeployment?.id || (workflow.metadata as any)?.deploymentId,
        },
      },
    })

    const previewUrl = vercelDeployment?.url || workflow.deploymentUrl
    await createAIAgentComment(
      taskId,
      `🔄 **Changes applied**

> ${feedback}

Updated PR #${workflow.pullRequestNumber}${previewUrl ? ` · [Preview](${previewUrl})` : ''}

Ready for review.`,
    )
  }

  /**
   * Handle retry with user feedback after a failed workflow
   * Re-runs planning phase with additional context from user
   */
  /**
   * Re-run the saga after a previous attempt failed, using the user's
   * clarification comment as additional planning context. Same pipeline
   * shape as executeCompleteWorkflow — load → plan → (approval gate) →
   * implement — but the planning prompt gets an "User Clarification"
   * appendix that includes the previous error.
   */
  async handleRetryWithFeedback(
    workflowId: string,
    taskId: string,
    userFeedback: string,
    previousError: string,
  ): Promise<void> {
    this.log('info', 'Handling retry with feedback', {
      workflowId,
      taskId,
      feedback: userFeedback.substring(0, 100),
      previousError: previousError.substring(0, 100),
    })

    try {
      const { workflow, enhancedDescription } = await this.loadRetryContext(workflowId, userFeedback, previousError)
      const plan = await this.runRetryPlanning(workflow, enhancedDescription)

      if (!plan.files || plan.files.length === 0) {
        await this.failRetryAtPlanning(workflowId, taskId, plan, userFeedback, previousError)
        return
      }

      if (await this.maybePauseRetryForApproval(workflowId, taskId, plan)) {
        return
      }

      await this.runRetryImplementation(workflow, plan, enhancedDescription)
      this.log('info', 'Retry with feedback completed successfully', { workflowId })
    } catch (error) {
      await this.failRetry(workflowId, taskId, userFeedback, previousError, error)
      throw error
    }
  }

  /** Load the retry workflow + build the user-clarification-appended description. */
  private async loadRetryContext(workflowId: string, userFeedback: string, previousError: string): Promise<{
    workflow: any
    enhancedDescription: string
  }> {
    const workflow = await prisma.codingTaskWorkflow.findUnique({
      where: { id: workflowId },
      include: { task: true },
    })
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`)
    }

    await prisma.codingTaskWorkflow.update({
      where: { id: workflowId },
      data: { status: 'PLANNING' },
    })

    // This string becomes taskDescription on the retry, and
    // buildMinimalPlanningPrompt wraps that in an untrusted envelope, so the
    // clarification is enveloped with it rather than separately.
    const enhancedDescription = `${workflow.task.description || ''}

## User Clarification (after previous attempt failed)

The previous attempt failed with: "${previousError}"

User provided this clarification:
> ${userFeedback}

Please use this additional context to better understand what needs to be done.`

    return { workflow, enhancedDescription }
  }

  /** Run the planning AI call with the enhanced (clarification-appended) description. */
  private runRetryPlanning(workflow: any, enhancedDescription: string): Promise<ImplementationPlan> {
    return this.generateImplementationPlan({
      taskTitle: workflow.task.title,
      taskDescription: enhancedDescription,
      targetFramework: 'react-typescript',
    })
  }

  /**
   * Even with the user's clarification the AI couldn't pick files. Post the
   * AI's response back to the user and persist a planning-failure record so
   * the next "ship it"/retry doesn't loop on the same dead end.
   */
  private async failRetryAtPlanning(
    workflowId: string,
    taskId: string,
    plan: ImplementationPlan,
    userFeedback: string,
    previousError: string,
  ): Promise<void> {
    const aiResponse = plan.rawPlanningResponse
      ? `\n\n**AI Response:**\n${plan.rawPlanningResponse.substring(0, 2000)}${plan.rawPlanningResponse.length > 2000 ? '\n...(truncated)' : ''}`
      : ''

    await this.postStatusComment(
      taskId,
      '❌ **Planning still unsuccessful**',
      `Even with your clarification, I couldn't identify files to modify.${aiResponse}\n\n**Please provide more specific details about:**\n- Which files or components need changes\n- What specific behavior you want to achieve\n- Any error messages or symptoms you're seeing`,
    )

    await prisma.codingTaskWorkflow.update({
      where: { id: workflowId },
      data: {
        status: 'FAILED',
        metadata: {
          error: 'Planning still produced no files after retry with feedback',
          step: 'PLANNING_RETRY',
          userFeedback,
          previousError,
          timestamp: new Date().toISOString(),
        },
      },
    })
  }

  /**
   * Mirror of shouldPauseForApproval but for the retry path — same
   * persisted shape plus a `retriedWithFeedback` marker so the audit log
   * can distinguish retries from initial approvals. Returns true if the
   * saga should pause.
   */
  private async maybePauseRetryForApproval(workflowId: string, taskId: string, plan: ImplementationPlan): Promise<boolean> {
    await this.postPlanComment(taskId, plan)

    const config = await this.loadProjectConfig()
    if (!config.safety.requirePlanApproval) return false

    await prisma.codingTaskWorkflow.update({
      where: { id: workflowId },
      data: {
        status: 'AWAITING_APPROVAL',
        metadata: {
          plan: JSON.parse(JSON.stringify(plan)),
          awaitingApprovalSince: new Date().toISOString(),
          retriedWithFeedback: true,
        },
      },
    })

    await this.postStatusComment(
      taskId,
      '⏸️ **Awaiting Approval**',
      `I've created an implementation plan with ${plan.files.length} file${plan.files.length === 1 ? '' : 's'}.\n\n` +
        `**Reply "approve" or "lgtm" to start implementation**, or provide more feedback to revise.`,
    )

    return true
  }

  /** Auto-approve path: generate code with the enhanced description and ship the PR. */
  private async runRetryImplementation(workflow: any, plan: ImplementationPlan, enhancedDescription: string): Promise<void> {
    await this.postStatusComment(
      workflow.task.id,
      '⚙️ **Implementing**',
      `Generating code for ${plan.files.length} file${plan.files.length === 1 ? '' : 's'}...`,
    )

    await prisma.codingTaskWorkflow.update({
      where: { id: workflow.id },
      data: { status: 'IMPLEMENTING' },
    })

    const generatedCode = await this.generateCode(
      {
        taskTitle: workflow.task.title,
        taskDescription: enhancedDescription,
        targetFramework: 'react-typescript',
      },
      plan,
    )

    if (generatedCode.files.length === 0) {
      throw new Error('Code generation produced no files even after retry')
    }

    await this.createGitHubImplementation(workflow, generatedCode)
  }

  /** Saga-level failure handler for the retry path. */
  private async failRetry(workflowId: string, taskId: string, userFeedback: string, previousError: string, error: unknown): Promise<void> {
    this.log('error', 'Retry with feedback failed', {
      workflowId,
      error: error instanceof Error ? error.message : String(error),
    })

    await prisma.codingTaskWorkflow.update({
      where: { id: workflowId },
      data: {
        status: 'FAILED',
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          step: 'RETRY_WITH_FEEDBACK',
          userFeedback,
          previousError,
          timestamp: new Date().toISOString(),
        },
      },
    })

    await this.postStatusComment(
      taskId,
      '❌ **Retry Failed**',
      `Even with your clarification, I encountered an error:\n\n**${error instanceof Error ? error.message : 'Unknown error'}**\n\nPlease try providing more specific details or reassign the task.`,
    )
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
