#!/usr/bin/env node

/**
 * The SHARED client, not a new one.
 *
 * These modules each constructed their own PrismaClient, which bypassed the
 * `$extends` hook in lib/prisma.ts that watches for an assignee change and
 * dispatches the AI agent. So assigning a task to an agent through the MCP
 * server never started the agent — the single feature MCP exists to serve —
 * and each module also opened its own connection pool (task 390bccc3).
 */
import { prisma } from "../lib/prisma"
import { mcpServerName } from "../lib/brand/config"

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { z } = require("zod");

// Import the new controller architecture

// Helper function to check if user has access to a list — extracted to ./list-access.ts
const { hasListAccess } = require("./list-access");

// GitHub MCP delegation — extracted to ./call-mcp-operation.ts
const { callMCPOperation } = require("./call-mcp-operation");

// Access token validation — extracted to ./access-token-validator.ts
const { validateAccessToken } = require("./access-token-validator");

// Comment handlers — extracted to ./handlers/comments.ts
const {
  addComment: addCommentHandler,
  getTaskComments: getTaskCommentsHandler,
} = require("./handlers/comments");

// List read handlers — extracted to ./handlers/lists.ts
const {
  getSharedLists: getSharedListsHandler,
  getListTasks: getListTasksHandler,
  getListMembers: getListMembersHandler,
} = require("./handlers/lists");

// Task handlers — extracted to ./handlers/tasks.ts
const {
  createTask: createTaskHandler,
  updateTask: updateTaskHandler,
  getTaskDetails: getTaskDetailsHandler,
  addTaskAttachment: addTaskAttachmentHandler,
  deleteTask: deleteTaskHandler,
} = require("./handlers/tasks");

// Tool descriptors — extracted to ./tool-definitions.ts
const { TOOL_DEFINITIONS } = require("./tool-definitions");

// Schema definitions for validation — extracted to ./schemas.ts
const {
  CreateTaskSchema,
  UpdateTaskSchema,
  CreateCommentSchema,
  CreateAttachmentSchema,
} = require("./schemas");

/**
 * MCP Server V2 - Uses New Controller Architecture
 *
 * This version integrates with the new MVC architecture:
 * - Uses database-stored tokens instead of in-memory
 * - Respects list-level MCP access control settings
 * - Ensures MCP agents never have more access than the user
 * - Uses proper permission validation with the new schema
 */
class AstridMCPServerV2 {
  private server;

  constructor() {
    this.server = new Server(
      {
        name: mcpServerName("v2"),
        version: "2.0.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async (request: any) => {
      return {
        resources: [
          {
            uri: "lists://shared",
            name: "Shared Task Lists",
            description: "Task lists that have been shared with AI agents via MCP",
            mimeType: "application/json",
          },
        ],
      };
    });

    // Read resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
      const { uri } = request.params;

      if (uri === "lists://shared") {
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify({
                description: "Shared task lists accessible via MCP v2",
                usage: "Use the get_shared_lists tool with a valid access token to access lists",
                authentication: "Required: Valid MCP access token with appropriate permissions",
                features: [
                  "Database-persisted tokens",
                  "List-level access control (READ/WRITE/BOTH)",
                  "User permission validation",
                  "Secure controller-based operations"
                ]
              }),
            },
          ],
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "get_shared_lists":
            return await this.getSharedLists(args);
          case "get_list_tasks":
            return await this.getListTasks(args);
          case "create_task":
            return await this.createTask(args);
          case "update_task":
            return await this.updateTask(args);
          case "add_comment":
            return await this.addComment(args);
          case "get_task_comments":
            return await this.getTaskComments(args);
          case "get_task_details":
            return await this.getTaskDetails(args);
          case "add_task_attachment":
            return await this.addTaskAttachment(args);
          case "delete_task":
            return await this.deleteTask(args);
          case "get_list_members":
            return await this.getListMembers(args);
          case "get_repository_file":
          case "list_repository_files":
          case "create_branch":
          case "commit_changes":
          case "create_pull_request":
          case "merge_pull_request":
          case "add_pull_request_comment":
          case "get_repository_info":
            // Delegate GitHub operations to the API
            return await this.callMCPOperation(name, args);
          default:
            throw new Error(`Unknown tool: ${name}`);
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
        };
      }
    });
  }

  private validateAccessToken(
    accessToken: string,
    listId: string,
    requiredPermission: "read" | "write" | "admin"
  ): Promise<{ userId: string; permissions: string[]; user: any; list: any }> {
    return validateAccessToken(accessToken, listId, requiredPermission);
  }

  private getSharedLists(args: any) {
    return getSharedListsHandler(args);
  }

  private getListTasks(args: any) {
    return getListTasksHandler(args);
  }

  private createTask(args: any) {
    return createTaskHandler(args);
  }

  private updateTask(args: any) {
    return updateTaskHandler(args);
  }

  private addComment(args: any) {
    return addCommentHandler(args);
  }

  private getTaskComments(args: any) {
    return getTaskCommentsHandler(args);
  }

  private getTaskDetails(args: any) {
    return getTaskDetailsHandler(args);
  }

  private addTaskAttachment(args: any) {
    return addTaskAttachmentHandler(args);
  }

  private deleteTask(args: any) {
    return deleteTaskHandler(args);
  }

  private getListMembers(args: any) {
    return getListMembersHandler(args);
  }

  /**
   * Call MCP operation via the API route
   * This delegates GitHub and other operations to the centralized API handler
   */
  private callMCPOperation(operation: string, args: any) {
    return callMCPOperation(operation, args);
  }

  public async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Astrid MCP Server V2 running on stdio");
  }
}

// Run the server if this file is executed directly
if (require.main === module) {
  const server = new AstridMCPServerV2();
  server.run().catch(console.error);
}

module.exports = AstridMCPServerV2;
