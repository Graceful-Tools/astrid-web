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
import { mcpDefaultBaseUrl, mcpServerName } from "../lib/brand/config"

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

// Schema definitions for validation
const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.number().min(0).max(3).default(0),
  assigneeId: z.string().optional(),
  dueDateTime: z.string().datetime().optional(),
  reminderTime: z.string().datetime().optional(),
  reminderType: z.enum(["push", "email", "both"]).optional(),
  isPrivate: z.boolean().default(true),
})

const UpdateTaskSchema = z.object({
  taskId: z.string(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.number().min(0).max(3).optional(),
  assigneeId: z.string().optional(),
  dueDateTime: z.string().datetime().optional(),
  reminderTime: z.string().datetime().optional(),
  reminderType: z.enum(["push", "email", "both"]).optional(),
  isPrivate: z.boolean().optional(),
  completed: z.boolean().optional(),
})

const CreateCommentSchema = z.object({
  taskId: z.string(),
  content: z.string().min(1),
  type: z.enum(["TEXT", "MARKDOWN"]).default("TEXT"),
})

/**
 * OAuth API Client for Astrid
 */
class OAuthAPIClient {
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
      console.error("❌ OAuth credentials not configured")
      throw new Error(
        "Provide ASTRID_OAUTH_CLIENT_ID + ASTRID_OAUTH_CLIENT_SECRET or a valid Astrid access token"
      )
    }
  }

  /**
   * Obtain an access token using client credentials flow
   */
  private async obtainAccessToken(): Promise<string> {
    if (this.staticAccessToken) {
      return this.staticAccessToken
    }

    // Check if we have a valid token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken
    }

    console.error("🔑 Obtaining OAuth access token...")

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

    console.error("✅ Access token obtained successfully")
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
  private server: Server
  private oauthClient: OAuthAPIClient
  private defaultListId: string | null = null

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
      return {
        tools: [
          {
            name: "get_lists",
            description: "Get all task lists accessible to the authenticated user",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "get_tasks",
            description: "Get all tasks from a specific list (or default list if not specified)",
            inputSchema: {
              type: "object",
              properties: {
                listId: {
                  type: "string",
                  description: "ID of the list to get tasks from (optional, uses default list if not provided)",
                },
                includeCompleted: {
                  type: "boolean",
                  description: "Whether to include completed tasks",
                  default: false,
                },
              },
            },
          },
          {
            name: "get_agent_queue",
            description:
              "Get the tasks queued for an agent identity right now — Ready, assigned to that agent, and past any start date. This is the call a scheduled loop makes: work everything it returns, then stop. Returns empty:true when there is nothing to do.",
            inputSchema: {
              type: "object",
              properties: {
                agent: {
                  type: "string",
                  description:
                    "Which agent identity this harness is — a mailbox (claude, codex, copilot, openai, gemini) or a full agent address. Required: guessing would claim another harness's work.",
                },
                listId: {
                  type: "string",
                  description:
                    "Scope the queue to one list/board (optional). Use it when different boards are worked by different harnesses.",
                },
              },
              required: ["agent"],
            },
          },
          {
            name: "get_task",
            description: "Get detailed information about a specific task",
            inputSchema: {
              type: "object",
              properties: {
                taskId: {
                  type: "string",
                  description: "ID of the task",
                },
              },
              required: ["taskId"],
            },
          },
          {
            name: "create_task",
            description: "Create a new task in a list",
            inputSchema: {
              type: "object",
              properties: {
                listId: {
                  type: "string",
                  description: "ID of the list to create task in (optional, uses default list if not provided)",
                },
                title: {
                  type: "string",
                  description: "Task title",
                },
                description: {
                  type: "string",
                  description: "Task description",
                },
                priority: {
                  type: "number",
                  minimum: 0,
                  maximum: 3,
                  description: "Task priority (0-3)",
                },
                dueDateTime: {
                  type: "string",
                  format: "date-time",
                  description: "Due date and time",
                },
              },
              required: ["title"],
            },
          },
          {
            name: "update_task",
            description: "Update an existing task",
            inputSchema: {
              type: "object",
              properties: {
                taskId: {
                  type: "string",
                  description: "ID of the task to update",
                },
                title: {
                  type: "string",
                  description: "New task title",
                },
                description: {
                  type: "string",
                  description: "New task description",
                },
                priority: {
                  type: "number",
                  minimum: 0,
                  maximum: 3,
                  description: "New priority (0-3)",
                },
                completed: {
                  type: "boolean",
                  description: "Mark as completed/incomplete",
                },
                dueDateTime: {
                  type: "string",
                  format: "date-time",
                  description: "New due date and time",
                },
              },
              required: ["taskId"],
            },
          },
          {
            name: "add_comment",
            description: "Add a comment to a task",
            inputSchema: {
              type: "object",
              properties: {
                taskId: {
                  type: "string",
                  description: "ID of the task",
                },
                content: {
                  type: "string",
                  description: "Comment content",
                },
                type: {
                  type: "string",
                  enum: ["TEXT", "MARKDOWN"],
                  description: "Comment type",
                  default: "TEXT",
                },
              },
              required: ["taskId", "content"],
            },
          },
          {
            name: "get_task_comments",
            description: "Get all comments for a specific task",
            inputSchema: {
              type: "object",
              properties: {
                taskId: {
                  type: "string",
                  description: "ID of the task",
                },
              },
              required: ["taskId"],
            },
          },
        ],
      }
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

    const data = await this.oauthClient.makeRequest<unknown>(
      `/api/v1/agent-queue?${params.toString()}`
    )

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
    const listId = args.listId || this.defaultListId

    if (!listId) {
      throw new Error(
        "No list ID provided and no default list configured. Set ASTRID_OAUTH_LIST_ID or provide listId parameter."
      )
    }

    // Validate task data
    const taskData = CreateTaskSchema.parse({
      title: args.title,
      description: args.description,
      priority: args.priority,
      dueDateTime: args.dueDateTime,
    })

    const data = await this.oauthClient.makeRequest<{ task: Task }>("/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({
        ...taskData,
        listId,
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

    const data = await this.oauthClient.makeRequest<{ comment: Comment }>(
      `/api/v1/tasks/${commentData.taskId}/comments`,
      {
        method: "POST",
        body: JSON.stringify({
          content: commentData.content,
          type: commentData.type,
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
    console.error(`Astrid MCP Server (OAuth) running via ${transportLabel} transport`)
    console.error(`Base URL: ${mcpDefaultBaseUrl()}`)
    console.error(
      `Default List: ${this.defaultListId || "none (must provide listId in each call)"}`
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
