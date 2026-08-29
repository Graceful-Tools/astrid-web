/**
 * MCP Operations API Route
 *
 * This is the main entry point for MCP (Model Context Protocol) operations.
 * All operation logic has been extracted to handler modules in ./handlers/
 */

import { BRAND } from '@/lib/brand/config'
import { capabilityGate } from '@/lib/brand/capabilities'
import { type NextRequest, NextResponse } from "next/server"
import { RATE_LIMITS, withRateLimit } from "@/lib/rate-limiter"
import { authenticateAPI, getDeprecationWarning, UnauthorizedError } from "@/lib/api-auth-middleware"
import { createLogger } from '@/lib/logger'
import { ListImageClaimError } from '@/lib/images/update-list-image'

const log = createLogger('mcp.operations')

// Import all handlers from the handlers barrel export
import {
  // Shared utilities
  redactArgsForLogging,

  // Task operations
  getListTasks,
  getUserTasks,
  createTask,
  updateTask,
  deleteTask,
  getTaskDetails,
  addTaskAttachment,

  // List operations
  getSharedLists,
  getPublicLists,
  copyPublicList,
  createList,
  updateList,
  deleteList,

  // Member operations
  getListMembers,
  addListMember,
  updateListMember,
  removeListMember,

  // Comment operations
  addComment,
  getTaskComments,
  deleteComment,

  // GitHub operations
  getRepositoryFile,
  listRepositoryFiles,
  createBranch,
  commitChanges,
  createPullRequest,
  mergePullRequest,
  addPullRequestComment,
  getPullRequestComments,
  getRepositoryInfo,

  // Deployment operations
  deployToStaging,
  getDeploymentStatus,
  getDeploymentLogs,
  getDeploymentErrors,
  listDeployments,

  // User operations
  getUserSettings,
  updateUserSettings
} from './handlers'

/**
 * Process an MCP request with authentication and error handling
 */
async function processMCPRequest(request: NextRequest, operation: unknown, incomingArgs: any) {
  if (!operation || typeof operation !== "string") {
    return NextResponse.json({ error: "Missing operation" }, { status: 400 })
  }

  let args = incomingArgs
  if (!args || typeof args !== "object") {
    args = {}
  }

  try {
    // iOS backward compatibility: Extract token from request body if present
    // iOS app sends token as args.accessToken instead of in headers
    const legacyToken = args.accessToken && typeof args.accessToken === 'string'
      ? args.accessToken
      : undefined

    // Use new unified authentication middleware
    // Supports OAuth tokens, session cookies, and legacy MCP tokens (including body tokens)
    const auth = await authenticateAPI(request, legacyToken)

    const result = await executeMCPOperation(operation, args, auth.userId)
    log.info({
      operation,
      authSource: auth.source,
      ok: true
    }, '[MCP API] Operation result:')

    // Add deprecation warning header if using legacy auth
    const deprecationWarning = getDeprecationWarning(auth)
    const headers: Record<string, string> = {}
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
      headers['X-Migration-Guide'] = `https://${BRAND.domain}/docs/api-migration`
    }

    return NextResponse.json(result, { headers })
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: 401,
          headers: {
            "WWW-Authenticate": 'Bearer realm="astrid-api", error="invalid_token"'
          }
        }
      )
    }
    throw error
  }
}

/**
 * POST handler for MCP operations
 */
export async function POST(request: NextRequest) {
  const blocked = capabilityGate('integrationMcp')
  if (blocked) return blocked

  // Apply rate limiting for MCP operations
  const rateLimitCheck = withRateLimit(RATE_LIMITS.MCP_OPERATIONS)(request)

  if (!rateLimitCheck.allowed) {
    log.info('[MCP] Operations rate limited')
    return NextResponse.json(
      rateLimitCheck.error,
      {
        status: 429,
        headers: rateLimitCheck.headers
      }
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { operation, args } = body || {}
    return await processMCPRequest(request, operation, args)
  } catch (error) {
    log.error({ err: error }, "Error executing MCP operation:")
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Internal server error"
    }, { status: error instanceof ListImageClaimError ? 409 : 500 })
  }
}

/**
 * GET handler for MCP operations (query string based)
 */
export async function GET(request: NextRequest) {
  const blocked = capabilityGate('integrationMcp')
  if (blocked) return blocked

  const rateLimitCheck = withRateLimit(RATE_LIMITS.MCP_OPERATIONS)(request)

  if (!rateLimitCheck.allowed) {
    log.info('[MCP] Operations rate limited (GET)')
    return NextResponse.json(
      rateLimitCheck.error,
      {
        status: 429,
        headers: rateLimitCheck.headers
      }
    )
  }

  try {
    const url = new URL(request.url)
    const operation = url.searchParams.get("operation")
    const accessToken = url.searchParams.get("accessToken")
    const argsParam = url.searchParams.get("args")
    let args: Record<string, any> | undefined

    if (argsParam) {
      try {
        args = JSON.parse(argsParam)
      } catch {
        return NextResponse.json({ error: "Invalid args JSON" }, { status: 400 })
      }
    }

    args = args && typeof args === "object" ? { ...args } : {}

    if (accessToken && !args.accessToken) {
      args.accessToken = accessToken
    }

    for (const [key, value] of url.searchParams.entries()) {
      if (["operation", "args", "accessToken"].includes(key)) {
        continue
      }
      if (args[key] === undefined) {
        args[key] = value
      }
    }

    return await processMCPRequest(request, operation, args)
  } catch (error) {
    log.error({ err: error }, "Error executing MCP operation:")
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Internal server error"
    }, { status: 500 })
  }
}

/**
 * Execute an MCP operation by routing to the appropriate handler
 */
async function executeMCPOperation(operation: string, args: any, userId: string) {
  switch (operation) {
    // List operations
    case 'get_shared_lists':
      return await getSharedLists(args.accessToken, userId)

    case 'get_public_lists':
      return await getPublicLists(args.accessToken, args.limit, args.sortBy, userId)

    case 'copy_list':
      return await copyPublicList(args.accessToken, args.listId, args.includeTasks, userId)

    case 'create_list':
      return await createList(args.accessToken, args.list, userId)

    case 'update_list':
      return await updateList(args.accessToken, args.listId, args.listUpdate, userId)

    case 'delete_list':
      return await deleteList(args.accessToken, args.listId, userId)

    // Task operations
    case 'get_list_tasks':
      return await getListTasks(args.accessToken, args.listId, userId, args.includeCompleted)

    case 'get_user_tasks':
      return await getUserTasks(args.accessToken, userId, args.includeCompleted)

    case 'create_task':
      log.info({ args: redactArgsForLogging(args) }, '[MCP API] create_task args')
      // Handle both single listId and lists array formats
      const listIds = args.lists || (args.listId ? [args.listId] : [])
      log.info({ listIds }, '[MCP API] Extracted listIds:')
      // Allow empty listIds - tasks without lists are valid
      return await createTask(args.accessToken, listIds, args.task, userId)

    case 'update_task':
      return await updateTask(args.accessToken, args.taskUpdate.taskId, args.taskUpdate, userId)

    case 'get_task_details':
      return await getTaskDetails(args.accessToken, args.taskId, userId)

    case 'delete_task':
      return await deleteTask(args.accessToken, args.taskId, userId)

    case 'add_task_attachment':
      return await addTaskAttachment(args.accessToken, args.taskId, args.attachment, userId)

    // Member operations
    case 'get_list_members':
      return await getListMembers(args.accessToken, args.listId, userId)

    case 'add_list_member':
      return await addListMember(args.accessToken, args.listId, args.email, args.role, userId)

    case 'update_list_member':
      return await updateListMember(args.accessToken, args.listId, args.memberId, args.role, userId)

    case 'remove_list_member':
      return await removeListMember(args.accessToken, args.listId, args.memberId, args.email, args.isInvitation, userId)

    // Comment operations
    case 'add_comment':
      return await addComment(args.accessToken, args.taskId, args.comment, userId, args.aiAgentId)

    case 'get_task_comments':
      return await getTaskComments(args.accessToken, args.taskId, userId)

    case 'delete_comment':
      return await deleteComment(args.accessToken, args.commentId, userId)

    // GitHub operations
    case 'get_repository_file':
      return await getRepositoryFile(args.accessToken, args.repository, args.path, args.ref, userId)

    case 'list_repository_files':
      return await listRepositoryFiles(args.accessToken, args.repository, args.path, args.ref, userId)

    case 'create_branch':
      return await createBranch(args.accessToken, args.repository, args.baseBranch, args.newBranch, userId)

    case 'commit_changes':
      return await commitChanges(args.accessToken, args.repository, args.branch, args.changes, args.commitMessage, userId)

    case 'create_pull_request':
      return await createPullRequest(args.accessToken, args.repository, args.headBranch, args.baseBranch, args.title, args.body, userId)

    case 'merge_pull_request':
      return await mergePullRequest(args.accessToken, args.repository, args.prNumber, args.mergeMethod, userId)

    case 'add_pull_request_comment':
      return await addPullRequestComment(args.accessToken, args.repository, args.prNumber, args.comment, userId)

    case 'get_pull_request_comments':
      return await getPullRequestComments(args.accessToken, args.repository, args.prNumber, userId)

    case 'get_repository_info':
      return await getRepositoryInfo(args.accessToken, args.repository, userId)

    // Vercel deployment operations
    case 'deploy_to_staging':
      return await deployToStaging(args.accessToken, args.repository, args.branch, args.commitSha, userId)

    case 'get_deployment_status':
      return await getDeploymentStatus(args.accessToken, args.deploymentId, userId)

    case 'get_deployment_logs':
      return await getDeploymentLogs(args.accessToken, args.deploymentId, userId)

    case 'get_deployment_errors':
      return await getDeploymentErrors(args.accessToken, args.deploymentId, userId)

    case 'list_deployments':
      return await listDeployments(args.accessToken, args.repository, args.branch, args.limit, userId)

    // User settings operations
    case 'get_user_settings':
      return await getUserSettings(args.accessToken, userId)

    case 'update_user_settings':
      return await updateUserSettings(args.accessToken, args.settings, userId)

    default:
      throw new Error(`Unknown operation: ${operation}`)
  }
}
