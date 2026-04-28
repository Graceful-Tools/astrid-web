import { NextRequest, NextResponse } from "next/server"
import { aiAgentWebhookService } from "@/lib/ai-agent-webhook-service"
import { createLogger } from '@/lib/logger'

const log = createLogger('webhooks.claude-integration')


export async function POST(request: NextRequest) {
  log.info('🔵 Claude integration webhook called')

  // This endpoint is for external Claude services to receive task notifications
  // Currently returns setup instructions since Claude doesn't have built-in webhook support

  return NextResponse.json({
    service: "Claude Integration Webhook",
    status: "ready",
    message: "Astrid is ready to send task notifications to Claude-based services",
    instructions: {
      setup: "This webhook URL can be used by Claude-based automation tools",
      mcpEndpoint: "https://astrid.cc/api/mcp/operations",
      contextEndpoint: "https://astrid.cc/api/mcp/context?agentType=claude",
      webhookEndpoint: "https://astrid.cc/api/webhooks/ai-agents",
      documentation: "https://astrid.cc/api/webhooks/ai-agents"
    },
    samplePayload: {
      event: "task.assigned",
      timestamp: new Date().toISOString(),
      aiAgent: {
        id: "claude-agent-id",
        name: "Claude AI Assistant",
        type: "claude"
      },
      task: {
        id: "task-id",
        title: "Task title",
        description: "Task description",
        url: "https://astrid.cc/tasks/task-id"
      },
      mcp: {
        baseUrl: "https://astrid.cc",
        accessToken: "your-mcp-token",
        availableOperations: ["get_task_details", "update_task", "add_comment"]
      }
    }
  })
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    service: "Claude Integration Webhook",
    description: "Receives task assignment notifications for Claude-based AI services",
    status: "active",
    endpoints: {
      webhook: "https://astrid.cc/api/webhooks/claude-integration",
      mcp: "https://astrid.cc/api/mcp/operations",
      context: "https://astrid.cc/api/mcp/context?agentType=claude"
    },
    usage: {
      description: "This endpoint is called when tasks are assigned to Claude AI Assistant",
      method: "POST",
      authentication: "Webhook signature verification (if configured)",
      payload: "Task assignment details with MCP access token"
    }
  })
}