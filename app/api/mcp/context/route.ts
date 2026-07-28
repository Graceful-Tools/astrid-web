import { BRAND } from '@/lib/brand/config'
import { capabilityGate } from '@/lib/brand/capabilities'
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
  const blocked = capabilityGate('integrationMcp')
  if (blocked) return blocked

  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')
  const agentType = searchParams.get('agentType')

  // Validate token if provided
  let mcpToken = null
  if (token) {
    mcpToken = await prisma.mCPToken.findFirst({
      where: {
        token,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      include: {
        user: {
          select: { id: true, name: true, aiAgentType: true, isAIAgent: true }
        }
      }
    })
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `https://${BRAND.domain}`

  const context = {
    service: {
      name: `${BRAND.appName} Task Manager MCP API`,
      version: "2.0.0",
      description: "AI agent integration for task management via Model Context Protocol (MCP)",
      baseUrl,
      documentationUrl: `${baseUrl}/api/mcp/context`
    },

    authentication: {
      type: "Bearer Token",
      description: "Include your MCP access token in the payload for each operation",
      tokenLocation: "Request body field: accessToken",
      example: {
        operation: "get_shared_lists",
        args: {
          accessToken: "your-mcp-access-token-here"
        }
      }
    },

    endpoints: {
      operations: `${baseUrl}/api/mcp/operations`,
      webhookInbound: `${baseUrl}/api/webhooks/ai-agents`,
      context: `${baseUrl}/api/mcp/context`
    },

    aiAgentInstructions: {
      overview: `You are an AI assistant integrated with ${BRAND.appName} Task Manager. When you receive a task assignment notification, you should:
1. Read the task details using get_task_details
2. Add progress comments using add_comment
3. Update the task status using update_task
4. Mark the task complete when finished`,

      workflow: [
        {
          step: 1,
          action: "Receive Task Assignment",
          description: "You'll receive a webhook notification when assigned a task",
          payload: "Contains task details, MCP access token, and available operations"
        },
        {
          step: 2,
          action: "Read Task Details",
          operation: "get_task_details",
          description: "Get comprehensive task information including comments and attachments"
        },
        {
          step: 3,
          action: "Work on Task",
          description: "Perform the requested task work based on the task description and requirements"
        },
        {
          step: 4,
          action: "Provide Updates",
          operation: "add_comment",
          description: "Add progress comments to keep users informed of your work"
        },
        {
          step: 5,
          action: "Complete Task",
          operation: "update_task",
          description: "Mark the task as completed when finished"
        }
      ],

      bestPractices: [
        "Always read full task details before starting work",
        "Provide regular progress updates via comments",
        "Ask clarifying questions in comments if task requirements are unclear",
        "Mark tasks complete only when all requirements are met",
        "Include relevant context and explanations in your comments",
        "Respect due dates and prioritize accordingly"
      ]
    },

    operations: [
      {
        name: "get_shared_lists",
        description: "Get all task lists accessible to your AI agent",
        httpMethod: "POST",
        endpoint: "/api/mcp/operations",
        parameters: {
          operation: "get_shared_lists",
          args: {
            accessToken: "string (required) - Your MCP access token"
          }
        },
        response: {
          lists: "Array of accessible task lists with metadata and permissions"
        },
        example: {
          operation: "get_shared_lists",
          args: {
            accessToken: "ai-agent-token-123"
          }
        }
      },
      {
        name: "get_list_tasks",
        description: "Get all tasks from a specific list",
        httpMethod: "POST",
        endpoint: "/api/mcp/operations",
        parameters: {
          operation: "get_list_tasks",
          args: {
            accessToken: "string (required)",
            listId: "string (required) - List ID to get tasks from",
            includeCompleted: "boolean (optional) - Include completed tasks"
          }
        },
        response: {
          tasks: "Array of tasks with assignee, creator, and comment info"
        }
      },
      {
        name: "get_task_details",
        description: "Get comprehensive details for a specific task",
        httpMethod: "POST",
        endpoint: "/api/mcp/operations",
        parameters: {
          operation: "get_task_details",
          args: {
            accessToken: "string (required)",
            taskId: "string (required) - Task ID"
          }
        },
        response: {
          task: "Complete task object with comments, attachments, and full metadata"
        },
        example: {
          operation: "get_task_details",
          args: {
            accessToken: "ai-agent-token-123",
            taskId: "task-456"
          }
        }
      },
      {
        name: "update_task",
        description: "Update task properties including completion status",
        httpMethod: "POST",
        endpoint: "/api/mcp/operations",
        parameters: {
          operation: "update_task",
          args: {
            accessToken: "string (required)",
            taskUpdate: {
              taskId: "string (required)",
              title: "string (optional)",
              description: "string (optional)",
              completed: "boolean (optional)",
              priority: "number (optional) - 0-3 scale"
            }
          }
        },
        example: {
          operation: "update_task",
          args: {
            accessToken: "ai-agent-token-123",
            taskUpdate: {
              taskId: "task-456",
              completed: true
            }
          }
        }
      },
      {
        name: "add_comment",
        description: "Add a comment to a task (for progress updates)",
        httpMethod: "POST",
        endpoint: "/api/mcp/operations",
        parameters: {
          operation: "add_comment",
          args: {
            accessToken: "string (required)",
            taskId: "string (required)",
            comment: {
              content: "string (required) - Comment text",
              type: "string (optional) - TEXT or MARKDOWN"
            }
          }
        },
        example: {
          operation: "add_comment",
          args: {
            accessToken: "ai-agent-token-123",
            taskId: "task-456",
            comment: {
              content: "Working on implementation. About 50% complete.",
              type: "TEXT"
            }
          }
        }
      },
      {
        name: "get_task_comments",
        description: "Get all comments for a task",
        httpMethod: "POST",
        endpoint: "/api/mcp/operations",
        parameters: {
          operation: "get_task_comments",
          args: {
            accessToken: "string (required)",
            taskId: "string (required)"
          }
        }
      }
    ],

    webhookNotifications: {
      description: "Your AI agent will receive webhook notifications when assigned tasks",
      endpoint: `${baseUrl}/api/webhooks/ai-agents`,
      events: [
        {
          event: "task.assigned",
          description: "Called when a task is assigned to your AI agent",
          payload: {
            event: "task.assigned",
            timestamp: "ISO 8601 timestamp",
            aiAgent: "AI agent info (id, name, type)",
            task: "Full task details",
            list: "List information",
            mcp: "MCP access info including token and available operations",
            creator: "Task creator info"
          }
        }
      ],

      responseWebhook: {
        description: `Send updates back to ${BRAND.appName} via webhook`,
        endpoint: `${baseUrl}/api/webhooks/ai-agents`,
        supportedEvents: [
          "task.completed",
          "task.progress",
          "task.comment",
          "task.error"
        ],
        example: {
          event: "task.progress",
          timestamp: new Date().toISOString(),
          aiAgent: { id: "agent-123", type: "claude" },
          task: { id: "task-456", progress: "Implementation 75% complete" },
          accessToken: "ai-agent-token-123"
        }
      }
    },

    ...(agentType && {
      agentSpecificInstructions: getAgentSpecificInstructions(agentType, baseUrl)
    }),

    ...(mcpToken && {
      yourToken: {
        token: mcpToken.token,
        userId: mcpToken.user.id,
        agentName: mcpToken.user.name,
        agentType: mcpToken.user.aiAgentType
      }
    }),

    examples: {
      fullWorkflow: {
        description: "Complete example of handling a task assignment",
        steps: [
          {
            step: "1. Receive Assignment Webhook",
            payload: {
              event: "task.assigned",
              task: { id: "task-123", title: "Fix login bug" },
              mcp: { accessToken: "token-abc" }
            }
          },
          {
            step: "2. Get Task Details",
            request: {
              operation: "get_task_details",
              args: { accessToken: "token-abc", taskId: "task-123" }
            }
          },
          {
            step: "3. Add Progress Comment",
            request: {
              operation: "add_comment",
              args: {
                accessToken: "token-abc",
                taskId: "task-123",
                comment: { content: "Starting investigation of login bug" }
              }
            }
          },
          {
            step: "4. Complete Task",
            request: {
              operation: "update_task",
              args: {
                accessToken: "token-abc",
                taskUpdate: { taskId: "task-123", completed: true }
              }
            }
          }
        ]
      }
    }
  }

  return NextResponse.json(context, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
    }
  })
}

function getAgentSpecificInstructions(agentType: string, baseUrl: string) {
  switch (agentType) {
    case 'claude':
      return {
        platform: "Claude",
        integration: "Claude Code CLI",
        instructions: `When you receive task assignment webhooks, you can interact with the ${BRAND.appName} MCP API using the provided access token.
        Use the standard HTTP requests to the MCP operations endpoint.

        Example workflow:
        1. Receive webhook notification with task details
        2. Use MCP API to read full task context
        3. Perform the requested work
        4. Update task with progress comments
        5. Mark task complete when finished`,

        codeExample: `// Example of calling MCP API from Claude Code
const response = await fetch('${baseUrl}/api/mcp/operations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    operation: 'get_task_details',
    args: {
      accessToken: 'your-token',
      taskId: 'task-id'
    }
  })
})`
      }

    case 'openai':
      return {
        platform: "OpenAI Codex Agent",
        integration: "OpenAI Assistants API",
        instructions: `Configure your OpenAI Assistant to handle webhook notifications and make HTTP requests to the ${BRAND.appName} MCP API.
        Use the function calling capability to structure MCP API calls.`,

        functionSchema: {
          name: "astrid_mcp_operation",
          description: `Execute ${BRAND.appName} MCP operations`,
          parameters: {
            type: "object",
            properties: {
              operation: { type: "string", enum: ["get_task_details", "update_task", "add_comment"] },
              args: { type: "object" }
            },
            required: ["operation", "args"]
          }
        }
      }

    case 'gemini':
      return {
        platform: "Google Gemini",
        integration: "Gemini API",
        instructions: `Use Gemini's function calling to interact with the ${BRAND.appName} MCP API.
        Handle webhook notifications and make structured API calls.`,

        functionDeclaration: {
          name: "astrid_task_operation",
          description: `Manage tasks in ${BRAND.appName} via MCP API`,
          parameters: {
            type: "OBJECT",
            properties: {
              operation: { type: "STRING" },
              accessToken: { type: "STRING" },
              taskId: { type: "STRING" }
            }
          }
        }
      }

    case 'astrid':
      return {
        platform: `${BRAND.appName} (First-Party)`,
        integration: "Built-in AI Assistant",
        instructions: `You are the built-in ${BRAND.appName} AI assistant with full access to task management.
        You can directly interact with the database and don't need webhook notifications.
        Use the MCP API for consistency with external agents.`,

        privileges: [
          "Direct database access",
          "Full task CRUD operations",
          "User management access",
          "List administration"
        ]
      }

    default:
      return {
        platform: "Generic AI Agent",
        instructions: "Follow the standard MCP API workflow for task management."
      }
  }
}