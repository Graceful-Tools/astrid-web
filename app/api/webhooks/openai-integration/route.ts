import { NextRequest, NextResponse } from "next/server"
import { createLogger } from '@/lib/logger'

const log = createLogger('webhooks.openai-integration')


export async function POST(request: NextRequest) {
  log.info('🧠 OpenAI integration webhook called')

  return NextResponse.json({
    service: "OpenAI Integration Webhook",
    status: "ready",
    message: "Astrid is ready to send task notifications to OpenAI Assistant-based services",
    instructions: {
      setup: "Configure OpenAI Assistant with these function tools",
      mcpEndpoint: "https://astrid.cc/api/mcp/operations",
      contextEndpoint: "https://astrid.cc/api/mcp/context?agentType=openai",
      webhookEndpoint: "https://astrid.cc/api/webhooks/ai-agents",
      documentation: "https://astrid.cc/api/webhooks/ai-agents"
    },
    openaiIntegration: {
      description: "Use OpenAI Assistant Function Tools to interact with Astrid MCP API",
      assistantTools: [
        {
          type: "function",
          function: {
            name: "astrid_get_task_details",
            description: "Get detailed information about an assigned task in Astrid",
            parameters: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "MCP access token for Astrid API authentication"
                },
                taskId: {
                  type: "string",
                  description: "The ID of the task to retrieve"
                }
              },
              required: ["accessToken", "taskId"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "astrid_update_task_status",
            description: "Update the completion status or properties of a task",
            parameters: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "MCP access token for authentication"
                },
                taskId: {
                  type: "string",
                  description: "The ID of the task to update"
                },
                completed: {
                  type: "boolean",
                  description: "Whether to mark the task as completed"
                },
                progress: {
                  type: "string",
                  description: "Optional progress update description"
                }
              },
              required: ["accessToken", "taskId"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "astrid_add_task_comment",
            description: "Add a progress comment or update to a task",
            parameters: {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description: "MCP access token for authentication"
                },
                taskId: {
                  type: "string",
                  description: "The ID of the task to comment on"
                },
                content: {
                  type: "string",
                  description: "The comment content or progress update"
                },
                type: {
                  type: "string",
                  enum: ["TEXT", "MARKDOWN"],
                  description: "The format of the comment content"
                }
              },
              required: ["accessToken", "taskId", "content"]
            }
          }
        }
      ]
    }
  })
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    service: "OpenAI Integration Webhook",
    description: "Integration point for OpenAI Assistant services with Astrid Task Manager",
    status: "active",
    integration: {
      type: "Assistant Function Tools",
      description: "Configure OpenAI Assistant with function tools to interact with Astrid MCP API",
      endpoint: "https://astrid.cc/api/mcp/operations"
    },
    setup: {
      step1: "Create OpenAI Assistant with provided function tool definitions",
      step2: "Configure assistant to use Astrid MCP operations",
      step3: "Use MCP access token for API authentication",
      step4: "Assistant can read task details, update status, and add progress comments"
    },
    webhookUrl: "https://astrid.cc/api/webhooks/openai-integration",
    responseEndpoint: "https://astrid.cc/api/webhooks/ai-agents"
  })
}