/**
 * The tool schemas the OAuth MCP server advertises (AWTD-871 extraction).
 *
 * Module-level rather than inline in the ListTools handler so the contract is
 * assertable without standing up a transport. A field the handlers forward but
 * the schema hides is a field no agent will ever send, so the schema is the
 * thing worth pinning (tasks 86b5fbbf, ee44bc35).
 *
 * In its OWN file because mcp-server-oauth.ts is on the oversized-files ratchet
 * and this is the piece with the clearest seam: 280 lines of pure declaration
 * next to the transport, the OAuth client and fifteen handlers. It is also the
 * half that gets edited most — every new tool parameter lands here — so keeping
 * it here means the next parameter costs nothing against the budget.
 *
 * `mcp-server-oauth.ts` re-exports OAUTH_MCP_TOOLS, so importers and the
 * schema-parity test do not need to know it moved.
 */

import { MIN_TASK_PRIORITY, MAX_TASK_PRIORITY } from "../lib/task-priority"

export const OAUTH_MCP_TOOLS = [
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
          "Get the tasks queued for an agent identity right now — Ready, assigned to that agent, and past any start date. This is the call a scheduled loop makes: work everything it returns, then stop. Returns empty:true when there is nothing to do, with a `hint` naming the condition that is unmet — most often tasks assigned to the agent that nobody set to Ready. Surface that hint instead of reporting a bare empty queue. If you do not use the board columns at all, pass requireReady: false so unstatused tasks queue too.",
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
            requireReady: {
              type: "boolean",
              description:
                "Must a task be in Ready to queue? Default true. Pass false if you do not use the board: a task with NO status queues as well, so assignment alone is enough. It relaxes only that — Waiting, Doing and a project's custom states are still never queued, so parking a blocked task in Waiting keeps stopping the loop from re-reading it.",
              default: true,
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
              description:
                "ID of the list to create the task in. Optional only when a default list is configured; a task that resolves to no list is rejected rather than created invisible.",
            },
            listIds: {
              type: "array",
              items: { type: "string" },
              description:
                "IDs of the lists to create the task in, for callers that want more than one. Takes precedence over listId.",
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
              description: `Task priority (${MIN_TASK_PRIORITY}-${MAX_TASK_PRIORITY})`,
            },
            dueDateTime: {
              type: "string",
              format: "date-time",
              description: "Due date and time",
            },
            repeating: {
              type: "string",
              enum: ["never", "daily", "weekly", "monthly", "yearly", "custom"],
              description:
                "How the task repeats. Use this instead of scheduling a cron for recurring work.",
            },
            repeatingData: {
              type: "object",
              description:
                'Custom repeat pattern, required when repeating is "custom" and ignored otherwise. Shape is CustomRepeatingPattern from types/repeating.ts, e.g. { type: "custom", unit: "weeks", interval: 1, endCondition: "never", weekdays: ["monday"] }.',
            },
            repeatFrom: {
              type: "string",
              enum: ["DUE_DATE", "COMPLETION_DATE"],
              description:
                "Whether the next occurrence is measured from the due date or the completion date. Defaults to COMPLETION_DATE, which pushes the slot later every time a run is late; scheduled work usually wants DUE_DATE.",
            },
            assigneeId: {
              type: "string",
              description:
                "Who owns the task. Takes a user id, or an agent identity such as \"ai-agent-claude\". Assigning to an agent mailbox ACTIVATES the hosted agent runtime, which will comment on the task — it is a trigger, not a passive queue.",
            },
            statusRole: {
              type: ["string", "null"],
              description:
                "Board column. \"ready\" is the one get_agent_queue requires: a task is queued for an agent only when it is BOTH assigned to that agent and ready. null means Inbox.",
            },
            isAllDay: {
              type: "boolean",
              description: "Treat dueDateTime as a day rather than a moment.",
            },
            reminderTime: {
              type: "string",
              format: "date-time",
              description: "When to remind.",
            },
            reminderType: {
              type: "string",
              enum: ["push", "email", "both"],
              description: "How to remind.",
            },
            isPrivate: {
              type: "boolean",
              description: "Private to you rather than visible to the list. Defaults to true.",
            },
          },
          required: ["title"],
          // Anything not listed here is an error rather than a silent strip
          // (task ba84653c). See mcp/schemas.ts for why.
          additionalProperties: false,
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
              description: `New priority (${MIN_TASK_PRIORITY}-${MAX_TASK_PRIORITY})`,
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
            repeating: {
              type: "string",
              enum: ["never", "daily", "weekly", "monthly", "yearly", "custom"],
              description:
                "How the task repeats. Use this instead of scheduling a cron for recurring work.",
            },
            repeatingData: {
              type: "object",
              description:
                'Custom repeat pattern, required when repeating is "custom" and ignored otherwise. Shape is CustomRepeatingPattern from types/repeating.ts, e.g. { type: "custom", unit: "weeks", interval: 1, endCondition: "never", weekdays: ["monday"] }.',
            },
            repeatFrom: {
              type: "string",
              enum: ["DUE_DATE", "COMPLETION_DATE"],
              description:
                "Whether the next occurrence is measured from the due date or the completion date. Defaults to COMPLETION_DATE, which pushes the slot later every time a run is late; scheduled work usually wants DUE_DATE.",
            },
            assigneeId: {
              type: "string",
              description:
                "Who owns the task. Takes a user id, or an agent identity such as \"ai-agent-claude\". Assigning to an agent mailbox ACTIVATES the hosted agent runtime, which will comment on the task — it is a trigger, not a passive queue.",
            },
            statusRole: {
              type: ["string", "null"],
              description:
                "Board column. \"ready\" is the one get_agent_queue requires: a task is queued for an agent only when it is BOTH assigned to that agent and ready. null moves it back to Inbox.",
            },
            isAllDay: {
              type: "boolean",
              description: "Treat dueDateTime as a day rather than a moment.",
            },
            reminderTime: {
              type: "string",
              format: "date-time",
              description: "When to remind.",
            },
            reminderType: {
              type: "string",
              enum: ["push", "email", "both"],
              description: "How to remind.",
            },
            isPrivate: {
              type: "boolean",
              description: "Private to you rather than visible to the list.",
            },
          },
          required: ["taskId"],
          // Anything not listed here is an error rather than a silent strip
          // (task ba84653c). See mcp/schemas.ts for why.
          additionalProperties: false,
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
] as const
