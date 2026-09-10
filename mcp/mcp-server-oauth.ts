#!/usr/bin/env node

/**
 * Astrid MCP Server V3 - OAuth-Enabled
 *
 * This MCP server uses OAuth 2.0 client credentials flow for authentication,
 * eliminating the need for manual token provisioning.
 *
 * Configuration via environment variables:
 * - ASTRID_OAUTH_CLIENT_ID: OAuth client ID
 * - ASTRID_OAUTH_CLIENT_SECRET: OAuth client secret
 * - ASTRID_OAUTH_LIST_ID: Default list ID to operate on
 * - ASTRID_API_BASE_URL: API base URL (default: this brand's own origin)
 * - ASTRID_AGENT_ID: agent user id to sign comments as before the first
 *   get_agent_queue poll. Optional — polling declares the identity by itself.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import crypto from "crypto"
import { BRAND, mcpDefaultBaseUrl, mcpServerName } from "../lib/brand/config"
// Shared with mcp/schemas.ts and the v1 HTTP API — see lib/task-priority.ts
// for why this stopped being a literal in four places (task 17fea642).
import { MIN_TASK_PRIORITY, MAX_TASK_PRIORITY } from "../lib/task-priority"
import { createLogger } from "../lib/logger"

const log = createLogger("mcp.server-oauth")

/**
 * Process-level token cache for the hosted Streamable HTTP path (task 11f578e0).
 *
 * pages/api/mcp/index.ts constructs a new AstridMCPServerOAuth per POST, so
 * the per-instance cache in OAuthAPIClient never hit for Basic-auth
 * sessions: every JSON-RPC request minted a fresh token via
 * client_credentials. Keyed by SHA-256 of baseUrl + clientId + clientSecret
 * (never by the raw credentials), with the same 5-minute early-expiry margin
 * obtainAccessToken already used. Static-access-token sessions bypass this
 * entirely — they never touch the token endpoint.
 */
interface HostedTokenEntry {
  accessToken: string
  expiry: number
}

const hostedTokenCache = new Map<string, HostedTokenEntry>()
/** In-flight fetches, so concurrent POSTs coalesce onto one token request. */
const hostedTokenInflight = new Map<string, Promise<string>>()

function hostedTokenCacheKey(baseUrl: string, clientId: string, clientSecret: string): string {
  return crypto
    .createHash("sha256")
    .update(`${baseUrl}\n${clientId}\n${clientSecret}`, "utf8")
    .digest("hex")
}

// OAuth API Client
interface OAuthTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
}

interface Task {
  id: string
  title: string
  description?: string | null
  priority: number
  completed: boolean
  dueDateTime?: string | null
  createdAt: string
  updatedAt: string
  assignee?: { id: string; name: string; email: string } | null
  creator?: { id: string; name: string; email: string } | null
  comments?: any[]
}

interface TaskList {
  id: string
  name: string
  description?: string | null
  color?: string | null
  privacy: string
  owner?: { id: string; name: string; email: string }
}

interface Comment {
  id: string
  content: string
  type: string
  createdAt: string
  author: { id: string; name: string; email: string }
}

/**
 * Repeat configuration, shared by create and update.
 *
 * The wire shape is settled and cross-platform — `types/repeating.ts` is
 * canonical and iOS mirrors it in RepeatingTaskHandler.swift — so this is
 * plumbing, not a new design. Next-occurrence math stays in the calculator
 * (ASTRID.md rule 4); nothing here computes a date.
 *
 * `repeatFrom` matters more than it looks for scheduled work: the column
 * defaults to COMPLETION_DATE, which drags the slot forward every time a run
 * lands late. A weekly job that must stay on its day needs DUE_DATE.
 */
const RepeatingFields = {
  repeating: z.enum(["never", "daily", "weekly", "monthly", "yearly", "custom"]).optional(),
  /** Only meaningful when `repeating` is "custom"; a CustomRepeatingPattern. */
  repeatingData: z.record(z.any()).nullable().optional(),
  repeatFrom: z.enum(["DUE_DATE", "COMPLETION_DATE"]).optional(),
}

/**
 * Schema definitions for validation.
 *
 * `.strict()` is load-bearing (task ba84653c). Zod strips unknown keys by
 * default, so `statusRole` — which was not declared here — disappeared before
 * the request body was built while the handler still answered `success: true`.
 * A write that reports success and changes nothing is detectable only by
 * re-reading the task and diffing, and because `get_agent_queue` requires
 * `statusRole: "ready"`, that single silent strip made it impossible to put a
 * task into an agent queue through MCP at all.
 *
 * A field must now be DECLARED here to be accepted, which is the point: this
 * is the one gate deciding what the tools honour, and
 * tests/mcp/tool-schemas-match-what-the-server-honours.test.ts goes red if it
 * and OAUTH_MCP_TOOLS ever disagree in either direction.
 *
 * These duplicate mcp/schemas.ts, which serves the shared-list MCP surface.
 * The same test pins the two to each other so they cannot drift further, but
 * the duplication itself is still worth deleting.
 */
export const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.number().int().min(MIN_TASK_PRIORITY).max(MAX_TASK_PRIORITY).default(0),
  assigneeId: z.string().optional(),
  dueDateTime: z.string().datetime().optional(),
  isAllDay: z.boolean().optional(),
  reminderTime: z.string().datetime().optional(),
  reminderType: z.enum(["push", "email", "both"]).optional(),
  isPrivate: z.boolean().default(true),
  statusRole: z.string().nullable().optional(),
  ...RepeatingFields,
}).strict()

export const UpdateTaskSchema = z.object({
  taskId: z.string(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.number().int().min(MIN_TASK_PRIORITY).max(MAX_TASK_PRIORITY).optional(),
  assigneeId: z.string().optional(),
  dueDateTime: z.string().datetime().optional(),
  isAllDay: z.boolean().optional(),
  reminderTime: z.string().datetime().optional(),
  reminderType: z.enum(["push", "email", "both"]).optional(),
  isPrivate: z.boolean().optional(),
  completed: z.boolean().optional(),
  statusRole: z.string().nullable().optional(),
  ...RepeatingFields,
}).strict()

const CreateCommentSchema = z.object({
  taskId: z.string(),
  content: z.string().min(1),
  type: z.enum(["TEXT", "MARKDOWN"]).default("TEXT"),
})

/**
 * OAuth API Client for Astrid.
 *
 * Exported for tests: the hosted /mcp endpoint builds one of these per
 * request, and the process-level token cache (task 11f578e0) is what keeps
 * that from minting a token per JSON-RPC call.
 */
export class OAuthAPIClient {
  private readonly baseUrl: string
  private readonly clientId: string
  private readonly clientSecret: string
  private accessToken: string | null = null
  private tokenExpiry: number = 0
  private staticAccessToken: string | null

  constructor(
    baseUrl: string = mcpDefaultBaseUrl(),
    clientId?: string,
    clientSecret?: string,
    staticAccessToken?: string | null
  ) {
    this.baseUrl = baseUrl
    this.clientId = clientId || process.env.ASTRID_OAUTH_CLIENT_ID || ""
    this.clientSecret = clientSecret || process.env.ASTRID_OAUTH_CLIENT_SECRET || ""
    this.staticAccessToken = staticAccessToken || null

    if (!this.staticAccessToken && (!this.clientId || !this.clientSecret)) {
      log.error("OAuth credentials not configured")
      throw new Error(
        `Provide ASTRID_OAUTH_CLIENT_ID + ASTRID_OAUTH_CLIENT_SECRET or a valid ${BRAND.appName} access token`
      )
    }
  }

  /**
   * Obtain an access token using client credentials flow.
   *
   * The per-instance fields are a fast path; the module-level cache is what
   * makes Basic-auth sessions cheap on the hosted /mcp endpoint, where a new
   * server (and client) is built per POST (task 11f578e0).
   */
  private async obtainAccessToken(): Promise<string> {
    if (this.staticAccessToken) {
      return this.staticAccessToken
    }

    // Check if we have a valid token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken
    }

    const cacheKey = hostedTokenCacheKey(this.baseUrl, this.clientId, this.clientSecret)
    const cached = hostedTokenCache.get(cacheKey)
    if (cached && Date.now() < cached.expiry) {
      this.accessToken = cached.accessToken
      this.tokenExpiry = cached.expiry
      return cached.accessToken
    }

    const inflight = hostedTokenInflight.get(cacheKey)
    if (inflight) {
      return this.adoptInflightToken(cacheKey, inflight)
    }

    const fetchPromise = this.fetchAccessToken(cacheKey)
    hostedTokenInflight.set(cacheKey, fetchPromise)
    try {
      return await fetchPromise
    } finally {
      hostedTokenInflight.delete(cacheKey)
    }
  }

  /**
   * Share a token another request is already fetching. The fetcher stores the
   * token in the process cache before its promise resolves, so the expiry is
   * read back from there; if it is somehow missing, treat this instance's
   * copy as already stale so the next call re-fetches.
   */
  private async adoptInflightToken(cacheKey: string, inflight: Promise<string>): Promise<string> {
    const token = await inflight
    const entry = hostedTokenCache.get(cacheKey)
    this.accessToken = token
    this.tokenExpiry = entry && entry.accessToken === token ? entry.expiry : Date.now()
    return token
  }

  private async fetchAccessToken(cacheKey: string): Promise<string> {
    log.debug("Obtaining OAuth access token")

    const response = await fetch(`${this.baseUrl}/api/v1/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`)
    }

    const data: OAuthTokenResponse = await response.json()

    this.accessToken = data.access_token
    // Set expiry to 5 minutes before actual expiry for safety
    this.tokenExpiry = Date.now() + (data.expires_in - 300) * 1000
    hostedTokenCache.set(cacheKey, {
      accessToken: this.accessToken,
      expiry: this.tokenExpiry,
    })

    log.debug("Access token obtained")
    return this.accessToken
  }

  /**
   * Make an authenticated API request
   */
  async makeRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.obtainAccessToken()

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`)
    }

    return response.json()
  }
}

/**
 * The tool schemas this server advertises — now in mcp/tool-definitions.ts.
 *
 * Re-exported rather than moved-and-forgotten: importers and the
 * schema-parity test address this module, and a rename would have been a
 * second, unrelated change riding along with the extraction.
 */
import { McpAgentIdentity } from './agent-identity'
import { OAUTH_MCP_TOOLS } from './tool-definitions'
export { OAUTH_MCP_TOOLS }

/**
 * MCP Server V3 - OAuth-Enabled
 */
export interface AstridMCPServerOptions {
  baseUrl?: string
  clientId?: string
  clientSecret?: string
  accessToken?: string
  defaultListId?: string | null
}

export default class AstridMCPServerOAuth {
  /**
   * The HTTP transport builds a server per request, so without this the
   * "startup" banner is per-request output (task 2e15b42f).
   */
  private static bannerLogged = false

  private server: Server
  private oauthClient: OAuthAPIClient
  private defaultListId: string | null = null
  /** Who this server signs comments as — see mcp/agent-identity.ts (AWTD-878). */
  private readonly agentIdentity = new McpAgentIdentity()

  constructor(options: AstridMCPServerOptions = {}) {
    const baseUrl = options.baseUrl || mcpDefaultBaseUrl()
    this.oauthClient = new OAuthAPIClient(
      baseUrl,
      options.clientId,
      options.clientSecret,
      options.accessToken || null
    )
    this.defaultListId =
      options.defaultListId ??
      process.env.ASTRID_OAUTH_LIST_ID ??
      null

    this.server = new Server(
      {
        name: mcpServerName("oauth"),
        version: "3.0.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    )

    this.setupHandlers()
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: OAUTH_MCP_TOOLS }
    })

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: "lists://all",
            name: "All Task Lists",
            description: "All task lists accessible via OAuth",
            mimeType: "application/json",
          },
        ],
      }
    })

    // Read resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
      const { uri } = request.params

      if (uri === "lists://all") {
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify({
                description: "Task lists accessible via OAuth",
                authentication: "OAuth 2.0 client credentials flow",
                defaultListId: this.defaultListId,
              }),
            },
          ],
        }
      }

      throw new Error(`Unknown resource: ${uri}`)
    })

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      const { name, arguments: args } = request.params

      try {
        switch (name) {
          case "get_lists":
            return await this.getLists()
          case "get_tasks":
            return await this.getTasks(args)
          case "get_agent_queue":
            return await this.getAgentQueue(args)
          case "get_task":
            return await this.getTask(args)
          case "create_task":
            return await this.createTask(args)
          case "update_task":
            return await this.updateTask(args)
          case "add_comment":
            return await this.addComment(args)
          case "get_task_comments":
            return await this.getTaskComments(args)
          default:
            throw new Error(`Unknown tool: ${name}`)
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }
      }
    })
  }

  private async getLists() {
    const data = await this.oauthClient.makeRequest<{ lists: TaskList[] }>("/api/v1/lists")

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              lists: data.lists,
              defaultListId: this.defaultListId,
            },
            null,
            2
          ),
        },
      ],
    }
  }

  /**
   * The polling loop's one call.
   *
   * A thin proxy over GET /api/v1/agent-queue, which owns the queue rules
   * (Ready + assigned to this identity + due). Doing the filtering here instead
   * would put a second, drifting copy of "what may a loop work" in the MCP layer.
   */
  private async getAgentQueue(args: any) {
    if (!args?.agent) {
      throw new Error(
        "agent is required — pass the identity this harness runs as (claude, codex, copilot, openai, gemini)."
      )
    }

    const params = new URLSearchParams({ agent: String(args.agent) })
    const listId = args.listId || this.defaultListId
    if (listId) params.append("listId", String(listId))
    // Only sent when explicitly turned OFF. Passing the default on every call
    // would put a second copy of "what the default is" in the MCP layer, and the
    // two would drift the first time the API's changed.
    if (args.requireReady === false) params.append("requireReady", "false")

    const data = await this.oauthClient.makeRequest<unknown>(
      `/api/v1/agent-queue?${params.toString()}`
    )

    // Polling as an identity IS the claim to be it, so the response is where
    // this server learns whose name to sign its comments with (AWTD-878).
    this.agentIdentity.observe(data)

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    }
  }

  private async getTasks(args: any) {
    const listId = args.listId || this.defaultListId

    if (!listId) {
      throw new Error(
        "No list ID provided and no default list configured. Set ASTRID_OAUTH_LIST_ID or provide listId parameter."
      )
    }

    const params = new URLSearchParams()
    params.append("listId", listId)
    if (args.includeCompleted) {
      params.append("includeCompleted", "true")
    }

    const data = await this.oauthClient.makeRequest<{ tasks: Task[] }>(
      `/api/v1/tasks?${params.toString()}`
    )

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              listId,
              tasks: data.tasks,
            },
            null,
            2
          ),
        },
      ],
    }
  }

  private async getTask(args: any) {
    const { taskId } = args

    if (!taskId) {
      throw new Error("taskId is required")
    }

    const data = await this.oauthClient.makeRequest<{ task: Task }>(
      `/api/v1/tasks/${taskId}`
    )

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(data.task, null, 2),
        },
      ],
    }
  }

  private async createTask(args: any) {
    /**
     * `listIds`, PLURAL, is the only key POST /api/v1/tasks reads.
     *
     * This sent `listId` — which that route never looks at — so the create
     * succeeded with zero list connections. The task was an orphan: `success:
     * true`, a real id, invisible on every board, findable only by id. There
     * was no error for an agent to notice and no board for a human to notice
     * it on, which is the failure mode where an agent reports "filed 6 tasks"
     * and the board shows none (task 86b5fbbf).
     *
     * The singular name stays as the friendlier tool surface; the array is
     * accepted too, and wins when both are sent.
     */
    const requestedListIds: string[] = Array.isArray(args.listIds)
      ? args.listIds.filter((id: unknown) => typeof id === "string" && id)
      : args.listId
        ? [args.listId]
        : this.defaultListId
          ? [this.defaultListId]
          : []

    if (requestedListIds.length === 0) {
      throw new Error(
        "No list ID provided and no default list configured. Set ASTRID_OAUTH_LIST_ID or provide listId parameter."
      )
    }

    /**
     * Hand the whole body to the schema rather than re-listing the fields.
     *
     * This used to name each field it forwarded, so a field the schema
     * accepted but this list forgot was dropped in silence — which is exactly
     * what happened to `assigneeId`, and to `repeatFrom`, which the tool
     * schema advertises (task ba84653c). One gate, in mcp/schemas.ts, is the
     * fix; a second hand-maintained list is the bug.
     *
     * listId/listIds are resolved above because they pick the target list
     * rather than describe the task, so they must not reach the strict schema.
     */
    const { listId: _listId, listIds: _listIds, ...taskArgs } = args ?? {}
    const taskData = CreateTaskSchema.parse(taskArgs)

    const data = await this.oauthClient.makeRequest<{ task: Task }>("/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({
        ...taskData,
        listIds: requestedListIds,
      }),
    })

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              task: data.task,
            },
            null,
            2
          ),
        },
      ],
    }
  }

  private async updateTask(args: any) {
    // Validate update data
    const updateData = UpdateTaskSchema.parse(args)
    const { taskId, ...updates } = updateData

    const data = await this.oauthClient.makeRequest<{ task: Task }>(
      `/api/v1/tasks/${taskId}`,
      {
        method: "PUT",
        body: JSON.stringify(updates),
      }
    )

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              task: data.task,
            },
            null,
            2
          ),
        },
      ],
    }
  }

  private async addComment(args: any) {
    // Validate comment data
    const commentData = CreateCommentSchema.parse(args)

    // Absent rather than null when unknown: the route branches on the key
    // being present, and a null would be read as a caller-chosen author.
    const aiAgentId = this.agentIdentity.authorId()

    const data = await this.oauthClient.makeRequest<{ comment: Comment }>(
      `/api/v1/tasks/${commentData.taskId}/comments`,
      {
        method: "POST",
        body: JSON.stringify({
          content: commentData.content,
          type: commentData.type,
          ...(aiAgentId ? { aiAgentId } : {}),
        }),
      }
    )

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              comment: data.comment,
            },
            null,
            2
          ),
        },
      ],
    }
  }

  private async getTaskComments(args: any) {
    const { taskId } = args

    if (!taskId) {
      throw new Error("taskId is required")
    }

    const data = await this.oauthClient.makeRequest<{ comments: Comment[] }>(
      `/api/v1/tasks/${taskId}/comments`
    )

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              taskId,
              comments: data.comments,
            },
            null,
            2
          ),
        },
      ],
    }
  }

  private logStartup(transportLabel: string) {
    // ONCE per process, at debug.
    //
    // This was three console.error lines, which Vercel classifies as ERROR —
    // and the HTTP transport constructs a new server instance per request, so
    // a startup banner became the project's single most common error line,
    // drowning the real ones (task 2e15b42f). The guard is what matters: at any
    // level, per-request is per-request.
    if (AstridMCPServerOAuth.bannerLogged) return
    AstridMCPServerOAuth.bannerLogged = true

    log.debug(
      {
        transport: transportLabel,
        baseUrl: mcpDefaultBaseUrl(),
        defaultList: this.defaultListId || null,
      },
      `${BRAND.appName} MCP Server (OAuth) ready`
    )
  }

  public async startWithTransport(transport: unknown, transportLabel = "custom") {
    await this.server.connect(transport as any)
    this.logStartup(transportLabel)
  }

  public async run() {
    const transport = new StdioServerTransport()
    await this.startWithTransport(transport, "stdio")
  }
}

// Run the server if this file is executed directly
if (require.main === module) {
  const server = new AstridMCPServerOAuth()
  server.run().catch(console.error)
}
