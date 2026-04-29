/**
 * Static tool registry for the MCP server.
 *
 * The MCP SDK ListToolsRequestSchema handler returns a list of tool
 * descriptors — each is a (name, description, JSON schema for inputs)
 * tuple. These do not change at runtime, so they live here as a plain
 * data export instead of being inlined in mcp-server-v2.ts where they
 * dwarfed the actual class.
 *
 * If you add a new tool: append the descriptor here AND add the case +
 * handler in mcp-server-v2.ts CallToolRequestSchema dispatch (or in
 * the appropriate mcp/handlers/*.ts).
 */

const TOOL_DEFINITIONS = [
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
]

module.exports = { TOOL_DEFINITIONS }
export {}
