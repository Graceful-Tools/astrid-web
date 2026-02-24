/**
 * @gracefultools/astrid-sdk
 *
 * AI agent SDK for automated coding tasks with Claude, OpenAI, and Gemini
 */

// Types
export type {
  CodeGenerationRequest,
  GeneratedCode,
  ImplementationPlan,
  ExecutionResult,
  PlanningResult,
  AIService,
  AIAgentConfig,
  LogLevel,
  Logger,
  ProgressCallback,
  AstridTask,
  AstridList,
  PreviousTaskContext,
  RepositoryContextCache,
} from './types/index.js'

// Configuration
export {
  loadAstridConfig,
  clearConfigCache,
  detectPlatform,
  generateStructurePrompt,
  generatePlatformHints,
  getInitialGlobPattern,
  isBlockedCommand,
  isProtectedPath,
  CONFIG_DEFAULTS,
  type AstridConfig,
  type ResolvedAstridConfig,
  type ProjectStructure,
  type PlatformDetection,
  type AgentConfig,
  type ValidationConfig,
  type SafetyConfig,
  type RetryConfig,
} from './config/index.js'

// Agent Configuration
export {
  AI_AGENT_CONFIG,
  SUGGESTED_MODELS,
  DEFAULT_MODELS,
  getAgentConfig,
  getAgentService,
  getAgentModel,
  getAgentContextFile,
  isRegisteredAgent,
  getRegisteredAgentEmails,
  getAllAgentConfigs,
} from './utils/agent-config.js'

// NOTE: Built-in AI executors (Claude, OpenAI, Gemini) have been removed.
// Astrid now dispatches to external agent runtimes (OpenClaw, Claude Code Remote)
// via webhooks and SSE instead of calling AI APIs directly.

// Astrid OAuth Client
export {
  AstridOAuthClient,
  type AstridOAuthConfig,
  type APIResponse,
  type Comment,
  type CreateTaskData,
  type UpdateTaskData,
} from './adapters/astrid-oauth.js'

// Agent Workflow Configuration
export {
  getAgentWorkflowConfig,
  generateBranchName,
  generatePreviewSubdomain,
  generatePreviewUrl,
  buildWorkflowInstructions,
  validateWorkflowConfig,
  logWorkflowConfig,
  type AgentWorkflowConfig,
} from './config/agent-workflow.js'

// Vercel Deployment
export {
  deployToVercel,
  isVercelConfigured,
  type VercelDeployResult,
} from './deploy/vercel.js'

// NOTE: Terminal executors have been removed as part of the architecture simplification.
// External agent runtimes handle execution directly.

// Channel Plugin (OpenClaw integration)
export {
  AstridChannel,
  SSEClient,
  OAuthClient as ChannelOAuthClient,
  RestClient as ChannelRestClient,
  SessionMapper,
  taskToMessage,
  commentToMessage,
  responseToComment,
  type AstridChannelConfig,
  type AgentTask as ChannelAgentTask,
  type AgentComment as ChannelAgentComment,
  type AgentSSEEvent,
  type InboundMessage,
  type OutboundMessage,
} from './channel/index.js'
