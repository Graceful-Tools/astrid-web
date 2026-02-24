/**
 * @gracefultools/astrid-sdk Type Definitions
 */

// ============================================================================
// CORE TYPES
// ============================================================================

export interface CodeGenerationRequest {
  taskTitle: string
  taskDescription: string
  repositoryContext?: string
  existingFiles?: string[]
  targetFramework?: string
}

export interface GeneratedCode {
  files: Array<{
    path: string
    content: string
    action: 'create' | 'modify' | 'delete'
  }>
  commitMessage: string
  prTitle: string
  prDescription: string
}

export interface ImplementationPlan {
  summary: string
  approach: string
  files: Array<{
    path: string
    purpose: string
    changes: string
    /** Set during validation if file is too large for complete content */
    requiresPartialContent?: boolean
    /** File size in bytes (set during validation) */
    fileSize?: number
    /** Estimated line count (set during validation) */
    estimatedLines?: number
  }>
  dependencies?: string[]
  estimatedComplexity: 'simple' | 'medium' | 'complex'
  considerations: string[]
  /** Files explored during planning phase */
  exploredFiles?: Array<{
    path: string
    content: string
    relevance: string
  }>
  /** Analysis summary for implementation phase */
  analysisNotes?: string
}

// ============================================================================
// EXECUTOR TYPES
// ============================================================================

export interface ExecutionResult {
  success: boolean
  files: Array<{
    path: string
    content: string
    action: 'create' | 'modify' | 'delete'
  }>
  commitMessage: string
  prTitle: string
  prDescription: string
  error?: string
  usage?: {
    inputTokens: number
    outputTokens: number
    costUSD: number
  }
}

export interface PlanningResult {
  success: boolean
  plan?: ImplementationPlan
  error?: string
  /** The AI model's last text response - useful for showing user what went wrong */
  modelResponse?: string
  usage?: {
    inputTokens: number
    outputTokens: number
    costUSD: number
  }
}

// ============================================================================
// CONFIG TYPES
// ============================================================================

export type AIService = 'claude' | 'openai' | 'gemini' | 'openclaw'

export interface AIAgentConfig {
  /** The AI service provider */
  service: AIService
  /** Default model to use */
  model: string
  /** Display name for UI */
  displayName: string
  /** Agent type stored in database */
  agentType: string
  /** Context file to load from repository */
  contextFile: string
  /** Agent capabilities */
  capabilities: readonly string[]
}

export type LogLevel = 'info' | 'warn' | 'error'

export type Logger = (
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>
) => void

export type ProgressCallback = (message: string) => void

// ============================================================================
// TASK TYPES (for Astrid integration)
// ============================================================================

export interface AstridTask {
  id: string
  title: string
  description: string | null
  priority: number
  completed: boolean
  dueDateTime?: string
  createdAt: string
  updatedAt: string
  assigneeId?: string
  /** Flat format - may be undefined if API returns nested assignee */
  assigneeEmail?: string
  /** Nested format from API v1 - contains full user object */
  assignee?: {
    id: string
    name?: string
    email?: string
    image?: string
    isAIAgent?: boolean
  }
  lists?: Array<{
    id: string
    name: string
    githubRepositoryId?: string
  }>
  comments?: Array<{
    id: string
    content: string
    authorId: string
    authorEmail?: string
    createdAt: string
  }>
}

export interface AstridList {
  id: string
  name: string
  description?: string
  /** GitHub repository in "owner/repo" format - this is what the API actually returns */
  githubRepositoryId?: string
  /** Alias for githubRepositoryId (for compatibility) */
  repository?: string
}

// ============================================================================
// CONTEXT TYPES
// ============================================================================

/** Context from previous attempts on the same task */
export interface PreviousTaskContext {
  hasBeenProcessedBefore: boolean
  previousAttempts: Array<{
    planSummary?: string
    filesModified?: string[]
    prUrl?: string
    outcome?: string
  }>
  userFeedback: Array<{
    content: string
    timestamp: string
  }>
  systemUnderstanding: string
}

/** Repository context cache entry */
export interface RepositoryContextCache {
  context: string
  structure: string
  timestamp: number
}
