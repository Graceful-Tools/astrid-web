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

  private async validateAccessToken(
    accessToken: string,
    listId: string,
    requiredPermission: "read" | "write" | "admin"
  ): Promise<{ userId: string; permissions: string[]; user: any; list: any }> {
    // Get token from database instead of memory
    const mcpToken = await prisma.mcpToken.findFirst({
      where: {
        token: accessToken,
        listId,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, mcpEnabled: true }
        },
        list: {
          include: {
            owner: { select: { id: true, name: true, email: true } },
            admins: { select: { id: true, name: true, email: true } },
            listMembers: {
              select: { userId: true, role: true, user: { select: { id: true, name: true, email: true } } }
            }
          }
        }
      }
    });

    if (!mcpToken) {
      throw new Error("Invalid or expired access token");
    }

    // Check if user has MCP enabled globally
    if (!mcpToken.user.mcpEnabled) {
      throw new Error("MCP access is disabled for this user");
    }

    // Check token permissions
    const hasPermission = mcpToken.permissions.includes(requiredPermission) ||
                         mcpToken.permissions.includes('admin');

    if (!hasPermission) {
      throw new Error(`Insufficient permissions. Required: ${requiredPermission}`);
    }

    // Verify user still has access to the list
    const userHasListAccess =
      mcpToken.list.ownerId === mcpToken.user.id ||
      mcpToken.list.admins.some((admin: any) => admin.id === mcpToken.user.id) ||
      mcpToken.list.listMembers.some((member: any) =>
        member.userId === mcpToken.user.id &&
        ['admin', 'member'].includes(member.role)
      );

    if (!userHasListAccess) {
      throw new Error("User no longer has access to this list");
    }

    return {
      userId: mcpToken.user.id,
      permissions: mcpToken.permissions,
      user: mcpToken.user,
      list: mcpToken.list
    };
  }

  private async getSharedLists(args: any) {
    const { accessToken } = args;

    if (!accessToken) {
      throw new Error("Access token required");
    }

    // Find all tokens for this access token (currently one-to-one with lists)
    const mcpToken = await prisma.mcpToken.findFirst({
      where: {
        token: accessToken,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      include: {
        list: {
          include: {
            owner: { select: { id: true, name: true, email: true } },
            _count: { select: { tasks: true } }
          }
        }
      }
    });

    if (!mcpToken) {
      throw new Error("No accessible lists found");
    }

    const lists = [{
      id: mcpToken.list.id,
      name: mcpToken.list.name,
      description: mcpToken.list.description,
      color: mcpToken.list.color,
      privacy: mcpToken.list.privacy,
      owner: mcpToken.list.owner,
      taskCount: mcpToken.list._count.tasks,
      permissions: mcpToken.permissions,
      mcpAccessLevel: mcpToken.permissions.includes('admin') ? 'BOTH' :
                     mcpToken.permissions.includes('write') ? 'BOTH' : 'READ'
    }];

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ lists }),
        },
      ],
    };
  }

  private async getListTasks(args: any) {
    const { accessToken, listId, includeCompleted = false } = args;

    await this.validateAccessToken(accessToken, listId, "read");

    // Get tasks using proper relations
    const tasks = await prisma.task.findMany({
      where: {
        lists: {
          some: { id: listId },
        },
        ...(includeCompleted ? {} : { completed: false }),
      },
      include: {
        assignee: {
          select: { id: true, name: true, email: true },
        },
        creator: {
          select: { id: true, name: true, email: true },
        },
        comments: {
          include: {
            author: {
              select: { id: true, name: true, email: true },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 3 // Only recent comments for performance
        },
        _count: {
          select: { comments: true },
        },
      },
      orderBy: [
        { completed: "asc" },
        { priority: "desc" },
        { dueDateTime: "asc" },
        { createdAt: "desc" },
      ],
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            listId,
            tasks: tasks.map((task: any) => ({
              id: task.id,
              title: task.title,
              description: task.description,
              priority: task.priority,
              completed: task.completed,
              dueDateTime: task.dueDateTime,
              reminderTime: task.reminderTime,
              reminderType: task.reminderType,
              isPrivate: task.isPrivate,
              createdAt: task.createdAt,
              updatedAt: task.updatedAt,
              assignee: task.assignee,
              creator: task.creator,
              commentCount: task._count.comments,
              recentComments: task.comments
            })),
          }),
        },
      ],
    };
  }

  private async createTask(args: any) {
    const { accessToken, listId, task } = args;

    const { userId, user, list } = await this.validateAccessToken(accessToken, listId, "write");

    // Validate task data
    const validatedTask = CreateTaskSchema.parse(task);

    // Check if user can still create tasks in this list (MCP never has more access than user)
    const userCanCreateTasks = hasListAccess(list, user.id);

    if (!userCanCreateTasks) {
      throw new Error("User no longer has permission to create tasks in this list");
    }

    // Create the task using the same API approach as the controller
    const newTask = await prisma.task.create({
      data: {
        ...validatedTask,
        creatorId: userId,
        dueDateTime: validatedTask.dueDateTime ? new Date(validatedTask.dueDateTime) : null,
        reminderTime: validatedTask.reminderTime ? new Date(validatedTask.reminderTime) : null,
        lists: {
          connect: { id: listId },
        },
      },
      include: {
        assignee: {
          select: { id: true, name: true, email: true },
        },
        creator: {
          select: { id: true, name: true, email: true },
        },
        lists: {
          select: { id: true, name: true },
        },
      },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            task: {
              id: newTask.id,
              title: newTask.title,
              description: newTask.description,
              priority: newTask.priority,
              completed: newTask.completed,
              dueDateTime: newTask.dueDateTime,
              reminderTime: newTask.reminderTime,
              reminderType: newTask.reminderType,
              isPrivate: newTask.isPrivate,
              createdAt: newTask.createdAt,
              assignee: newTask.assignee,
              creator: newTask.creator,
              lists: newTask.lists,
            },
          }),
        },
      ],
    };
  }

  private async updateTask(args: any) {
    const { accessToken, listId, taskUpdate } = args;

    const { userId, user, list } = await this.validateAccessToken(accessToken, listId, "write");

    // Validate task update data
    const validatedUpdate = UpdateTaskSchema.parse(taskUpdate);
    const { taskId, ...updateData } = validatedUpdate;

    // Verify task exists and is in the list
    const existingTask = await prisma.task.findFirst({
      where: {
        id: taskId,
        lists: {
          some: { id: listId },
        },
      },
    });

    if (!existingTask) {
      throw new Error("Task not found in the specified list");
    }

    // Check if user can still edit this task (MCP never has more access than user)
    const userCanEditTask =
      existingTask.creatorId === user.id ||
      existingTask.assigneeId === user.id ||
      list.ownerId === user.id ||
      list.admins.some((admin: any) => admin.id === user.id);

    if (!userCanEditTask) {
      throw new Error("User no longer has permission to edit this task");
    }

    // Update the task
    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
        ...updateData,
        dueDateTime: updateData.dueDateTime ? new Date(updateData.dueDateTime) : undefined,
        reminderTime: updateData.reminderTime ? new Date(updateData.reminderTime) : undefined,
      },
      include: {
        assignee: {
          select: { id: true, name: true, email: true },
        },
        creator: {
          select: { id: true, name: true, email: true },
        },
        lists: {
          select: { id: true, name: true },
        },
      },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            task: {
              id: updatedTask.id,
              title: updatedTask.title,
              description: updatedTask.description,
              priority: updatedTask.priority,
              completed: updatedTask.completed,
              dueDateTime: updatedTask.dueDateTime,
              reminderTime: updatedTask.reminderTime,
              reminderType: updatedTask.reminderType,
              isPrivate: updatedTask.isPrivate,
              updatedAt: updatedTask.updatedAt,
              assignee: updatedTask.assignee,
              creator: updatedTask.creator,
              lists: updatedTask.lists,
            },
          }),
        },
      ],
    };
  }

  private async addComment(args: any) {
    const { accessToken, listId, comment } = args;

    const { userId, user } = await this.validateAccessToken(accessToken, listId, "write");

    // Validate comment data
    const validatedComment = CreateCommentSchema.parse(comment);

    // Verify task exists and is in the list
    const existingTask = await prisma.task.findFirst({
      where: {
        id: validatedComment.taskId,
        lists: {
          some: { id: listId },
        },
      },
    });

    if (!existingTask) {
      throw new Error("Task not found in the specified list");
    }

    // Create the comment
    const newComment = await prisma.comment.create({
      data: {
        content: validatedComment.content,
        type: validatedComment.type,
        authorId: userId,
        taskId: validatedComment.taskId,
      },
      include: {
        author: {
          select: { id: true, name: true, email: true },
        },
        task: {
          select: { id: true, title: true },
        },
      },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            comment: {
              id: newComment.id,
              content: newComment.content,
              type: newComment.type,
              createdAt: newComment.createdAt,
              author: newComment.author,
              task: newComment.task,
            },
          }),
        },
      ],
    };
  }

  private async getTaskComments(args: any) {
    const { accessToken, listId, taskId } = args;

    await this.validateAccessToken(accessToken, listId, "read");

    // Verify task exists and is in the list
    const existingTask = await prisma.task.findFirst({
      where: {
        id: taskId,
        lists: {
          some: { id: listId },
        },
      },
    });

    if (!existingTask) {
      throw new Error("Task not found in the specified list");
    }

    // Get all comments for the task
    const comments = await prisma.comment.findMany({
      where: { taskId },
      include: {
        author: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            taskId,
            comments: comments.map((comment: any) => ({
              id: comment.id,
              content: comment.content,
              type: comment.type,
              createdAt: comment.createdAt,
              author: comment.author,
            })),
          }),
        },
      ],
    };
  }

  private async getTaskDetails(args: any) {
    const { accessToken, listId, taskId, includeComments = true, includeAttachments = true } = args;

    await this.validateAccessToken(accessToken, listId, "read");

    // Get comprehensive task details
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        lists: {
          some: { id: listId },
        },
      },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        creator: { select: { id: true, name: true, email: true } },
        lists: { select: { id: true, name: true } },
        comments: includeComments ? {
          include: {
            author: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "asc" }
        } : false,
        attachments: includeAttachments,
        _count: { select: { comments: true, attachments: true } }
      },
    });

    if (!task) {
      throw new Error("Task not found in the specified list");
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          task: {
            id: task.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            completed: task.completed,
            dueDateTime: task.dueDateTime,
            isAllDay: task.isAllDay,
            reminderTime: task.reminderTime,
            reminderType: task.reminderType,
            repeating: task.repeating,
            repeatingData: task.repeatingData,
            isPrivate: task.isPrivate,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            assignee: task.assignee,
            creator: task.creator,
            lists: task.lists,
            comments: includeComments ? task.comments : undefined,
            attachments: includeAttachments ? task.attachments : undefined,
            commentCount: task._count.comments,
            attachmentCount: task._count.attachments
          }
        })
      }]
    };
  }

  private async addTaskAttachment(args: any) {
    const { accessToken, listId, taskId, attachment } = args;

    const { user } = await this.validateAccessToken(accessToken, listId, "write");

    // Validate attachment data
    const validatedAttachment = CreateAttachmentSchema.parse(attachment);

    // Verify task exists and is in the list
    const existingTask = await prisma.task.findFirst({
      where: {
        id: taskId,
        lists: {
          some: { id: listId },
        },
      },
    });

    if (!existingTask) {
      throw new Error("Task not found in the specified list");
    }

    // Create the attachment
    const newAttachment = await prisma.attachment.create({
      data: {
        name: validatedAttachment.name,
        url: validatedAttachment.url,
        type: validatedAttachment.type,
        size: validatedAttachment.size,
        taskId: taskId,
      },
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          attachment: {
            id: newAttachment.id,
            name: newAttachment.name,
            url: newAttachment.url,
            type: newAttachment.type,
            size: newAttachment.size,
            createdAt: newAttachment.createdAt,
            taskId: newAttachment.taskId
          }
        })
      }]
    };
  }

  private async deleteTask(args: any) {
    const { accessToken, listId, taskId } = args;

    const { user, list } = await this.validateAccessToken(accessToken, listId, "write");

    // Verify task exists and is in the list
    const existingTask = await prisma.task.findFirst({
      where: {
        id: taskId,
        lists: {
          some: { id: listId },
        },
      },
    });

    if (!existingTask) {
      throw new Error("Task not found in the specified list");
    }

    // Check if user can delete this task (same logic as update)
    const userCanDeleteTask =
      existingTask.creatorId === user.id ||
      existingTask.assigneeId === user.id ||
      list.ownerId === user.id ||
      list.admins.some((admin) => admin.id === user.id);

    if (!userCanDeleteTask) {
      throw new Error("User no longer has permission to delete this task");
    }

    // Delete the task
    await prisma.task.delete({
      where: { id: taskId }
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          message: "Task deleted successfully",
          taskId: taskId
        })
      }]
    };
  }

  private async getListMembers(args: any) {
    const { accessToken, listId } = args;

    await this.validateAccessToken(accessToken, listId, "read");

    // Get list with all member information
    const list = await prisma.taskList.findFirst({
      where: { id: listId },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        admins: { select: { id: true, name: true, email: true } },
        members: { select: { id: true, name: true, email: true } },
        listMembers: {
          include: {
            user: { select: { id: true, name: true, email: true } }
          }
        }
      }
    });

    if (!list) {
      throw new Error("List not found");
    }

    // Combine all members with roles
    const members = [];

    // Add owner
    members.push({
      ...list.owner,
      role: "owner"
    });

    // Add admins (legacy)
    list.admins.forEach(admin => {
      if (admin.id !== list.ownerId) {
        members.push({
          ...admin,
          role: "admin"
        });
      }
    });

    // Add members (legacy)
    list.members.forEach(member => {
      if (member.id !== list.ownerId && !list.admins.some(admin => admin.id === member.id)) {
        members.push({
          ...member,
          role: "member"
        });
      }
    });

    // Add new list members system
    list.listMembers.forEach(listMember => {
      // Avoid duplicates from legacy system
      if (!members.some(m => m.id === listMember.user.id)) {
        members.push({
          ...listMember.user,
          role: listMember.role
        });
      }
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          listId: listId,
          listName: list.name,
          members: members,
          totalMembers: members.length
        })
      }]
    };
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