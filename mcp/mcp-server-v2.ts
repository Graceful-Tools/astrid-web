#!/usr/bin/env node

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
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

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
        name: "astrid-task-manager-v2",
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
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "get_shared_lists",
            description: "Get all task lists that have been shared with the AI agent",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for list access",
                },
              },
              required: ["accessToken"],
            },
          },
          {
            name: "get_list_tasks",
            description: "Get all tasks from a specific shared list",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for list access",
                },
                listId: {
                  type: "string",
                  description: "ID of the list to get tasks from",
                },
                includeCompleted: {
                  type: "boolean",
                  description: "Whether to include completed tasks",
                  default: false,
                },
              },
              required: ["accessToken", "listId"],
            },
          },
          {
            name: "create_task",
            description: "Create a new task in a shared list",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for list access",
                },
                listId: {
                  type: "string",
                  description: "ID of the list to create task in",
                },
                task: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    priority: { type: "number", minimum: 0, maximum: 3 },
                    assigneeId: { type: "string" },
                    dueDateTime: { type: "string", format: "date-time" },
                    reminderTime: { type: "string", format: "date-time" },
                    reminderType: { type: "string", enum: ["push", "email", "both"] },
                    isPrivate: { type: "boolean" },
                  },
                  required: ["title"],
                },
              },
              required: ["accessToken", "listId", "task"],
            },
          },
          {
            name: "update_task",
            description: "Update an existing task in a shared list",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for list access",
                },
                listId: {
                  type: "string",
                  description: "ID of the list containing the task",
                },
                taskUpdate: {
                  type: "object",
                  properties: {
                    taskId: { type: "string" },
                    title: { type: "string" },
                    description: { type: "string" },
                    priority: { type: "number", minimum: 0, maximum: 3 },
                    assigneeId: { type: "string" },
                    dueDateTime: { type: "string", format: "date-time" },
                    reminderTime: { type: "string", format: "date-time" },
                    reminderType: { type: "string", enum: ["push", "email", "both"] },
                    isPrivate: { type: "boolean" },
                    completed: { type: "boolean" },
                  },
                  required: ["taskId"],
                },
              },
              required: ["accessToken", "listId", "taskUpdate"],
            },
          },
          {
            name: "add_comment",
            description: "Add a comment to a task in a shared list",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for list access",
                },
                listId: {
                  type: "string",
                  description: "ID of the list containing the task",
                },
                comment: {
                  type: "object",
                  properties: {
                    taskId: { type: "string" },
                    content: { type: "string" },
                    type: { type: "string", enum: ["TEXT", "MARKDOWN"] },
                  },
                  required: ["taskId", "content"],
                },
              },
              required: ["accessToken", "listId", "comment"],
            },
          },
          {
            name: "get_task_comments",
            description: "Get all comments for a specific task",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for list access",
                },
                listId: {
                  type: "string",
                  description: "ID of the list containing the task",
                },
                taskId: {
                  type: "string",
                  description: "ID of the task to get comments for",
                },
              },
              required: ["accessToken", "listId", "taskId"],
            },
          },
          {
            name: "get_task_details",
            description: "Get comprehensive details for a specific task including all fields",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for list access",
                },
                listId: {
                  type: "string",
                  description: "ID of the list containing the task",
                },
                taskId: {
                  type: "string",
                  description: "ID of the task",
                },
                includeComments: {
                  type: "boolean",
                  description: "Include task comments in response",
                  default: true,
                },
                includeAttachments: {
                  type: "boolean",
                  description: "Include task attachments in response",
                  default: true,
                },
              },
              required: ["accessToken", "listId", "taskId"],
            },
          },
          {
            name: "add_task_attachment",
            description: "Add an attachment to a task",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for list access",
                },
                listId: {
                  type: "string",
                  description: "ID of the list containing the task",
                },
                taskId: {
                  type: "string",
                  description: "ID of the task",
                },
                attachment: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Original filename" },
                    url: { type: "string", description: "URL where file is stored" },
                    type: { type: "string", description: "MIME type" },
                    size: { type: "number", description: "File size in bytes" },
                  },
                  required: ["name", "url", "type", "size"],
                },
              },
              required: ["accessToken", "listId", "taskId", "attachment"],
            },
          },
          {
            name: "delete_task",
            description: "Delete a task from a shared list",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for list access",
                },
                listId: {
                  type: "string",
                  description: "ID of the list containing the task",
                },
                taskId: {
                  type: "string",
                  description: "ID of the task to delete",
                },
              },
              required: ["accessToken", "listId", "taskId"],
            },
          },
          {
            name: "get_list_members",
            description: "Get all members and their roles for a shared list",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for list access",
                },
                listId: {
                  type: "string",
                  description: "ID of the list",
                },
              },
              required: ["accessToken", "listId"],
            },
          },
          {
            name: "get_repository_file",
            description: "Read the contents of a file from a GitHub repository",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for MCP operations",
                },
                repository: {
                  type: "string",
                  description: "Repository in 'owner/repo' format (e.g., 'octocat/Hello-World')",
                },
                path: {
                  type: "string",
                  description: "File path in the repository (e.g., 'README.md', 'src/index.ts')",
                },
                ref: {
                  type: "string",
                  description: "Optional branch or commit ref (defaults to default branch)",
                },
              },
              required: ["accessToken", "repository", "path"],
            },
          },
          {
            name: "list_repository_files",
            description: "List all files and directories in a specific directory of a GitHub repository",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for MCP operations",
                },
                repository: {
                  type: "string",
                  description: "Repository in 'owner/repo' format",
                },
                path: {
                  type: "string",
                  description: "Directory path to list (empty string or '/' for root)",
                },
                ref: {
                  type: "string",
                  description: "Optional branch or commit ref (defaults to default branch)",
                },
              },
              required: ["accessToken", "repository"],
            },
          },
          {
            name: "create_branch",
            description: "Create a new branch in a GitHub repository from a base branch",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for MCP operations",
                },
                repository: {
                  type: "string",
                  description: "Repository in 'owner/repo' format",
                },
                baseBranch: {
                  type: "string",
                  description: "Base branch to create from (e.g., 'main', 'develop')",
                },
                newBranch: {
                  type: "string",
                  description: "Name of the new branch to create",
                },
              },
              required: ["accessToken", "repository", "baseBranch", "newBranch"],
            },
          },
          {
            name: "commit_changes",
            description: "Commit one or more file changes to a branch in a GitHub repository",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for MCP operations",
                },
                repository: {
                  type: "string",
                  description: "Repository in 'owner/repo' format",
                },
                branch: {
                  type: "string",
                  description: "Branch to commit to",
                },
                changes: {
                  type: "array",
                  description: "Array of file changes to commit",
                  items: {
                    type: "object",
                    properties: {
                      path: { type: "string", description: "File path" },
                      content: { type: "string", description: "File content" },
                      mode: { type: "string", enum: ["create", "update", "delete"], description: "Change type" },
                    },
                    required: ["path", "content"],
                  },
                },
                commitMessage: {
                  type: "string",
                  description: "Commit message",
                },
              },
              required: ["accessToken", "repository", "branch", "changes", "commitMessage"],
            },
          },
          {
            name: "create_pull_request",
            description: "Create a pull request in a GitHub repository",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for MCP operations",
                },
                repository: {
                  type: "string",
                  description: "Repository in 'owner/repo' format",
                },
                headBranch: {
                  type: "string",
                  description: "Branch containing the changes",
                },
                baseBranch: {
                  type: "string",
                  description: "Base branch to merge into (e.g., 'main')",
                },
                title: {
                  type: "string",
                  description: "Pull request title",
                },
                body: {
                  type: "string",
                  description: "Pull request description/body",
                },
              },
              required: ["accessToken", "repository", "headBranch", "baseBranch", "title", "body"],
            },
          },
          {
            name: "merge_pull_request",
            description: "Merge a pull request in a GitHub repository",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for MCP operations",
                },
                repository: {
                  type: "string",
                  description: "Repository in 'owner/repo' format",
                },
                prNumber: {
                  type: "number",
                  description: "Pull request number",
                },
                mergeMethod: {
                  type: "string",
                  enum: ["merge", "squash", "rebase"],
                  description: "Merge method (default: squash)",
                },
              },
              required: ["accessToken", "repository", "prNumber"],
            },
          },
          {
            name: "add_pull_request_comment",
            description: "Add a comment to a pull request in a GitHub repository",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for MCP operations",
                },
                repository: {
                  type: "string",
                  description: "Repository in 'owner/repo' format",
                },
                prNumber: {
                  type: "number",
                  description: "Pull request number",
                },
                comment: {
                  type: "string",
                  description: "Comment text (markdown supported)",
                },
              },
              required: ["accessToken", "repository", "prNumber", "comment"],
            },
          },
          {
            name: "get_repository_info",
            description: "Get information about a GitHub repository including default branch, visibility, etc.",
            inputSchema: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "Access token for MCP operations",
                },
                repository: {
                  type: "string",
                  description: "Repository in 'owner/repo' format",
                },
              },
              required: ["accessToken", "repository"],
            },
          },
        ],
      };
    });

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