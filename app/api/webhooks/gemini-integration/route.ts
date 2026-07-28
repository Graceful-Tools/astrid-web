import { BRAND } from '@/lib/brand/config'
import { NextRequest, NextResponse } from "next/server"
import { createLogger } from '@/lib/logger'

const log = createLogger('webhooks.gemini-integration')


export async function POST(request: NextRequest) {
  log.info('💎 Gemini integration webhook called')

  return NextResponse.json({
    service: "Gemini Integration Webhook",
    status: "ready",
    message: `${BRAND.appName} is ready to send task notifications to Gemini-based services`,
    instructions: {
      setup: "Configure Gemini Function Calling with these endpoints",
      mcpEndpoint: `https://${BRAND.domain}/api/mcp/operations`,
      contextEndpoint: `https://${BRAND.domain}/api/mcp/context?agentType=gemini`,
      webhookEndpoint: `https://${BRAND.domain}/api/webhooks/ai-agents`,
      documentation: `https://${BRAND.domain}/api/webhooks/ai-agents`
    },
    geminiIntegration: {
      description: `Use Gemini Function Calling to interact with ${BRAND.appName} MCP API`,
      functionDeclarations: [
        {
          name: "astrid_get_task_details",
          description: "Get detailed information about an assigned task",
          parameters: {
            type: "OBJECT",
            properties: {
              accessToken: { type: "STRING", description: "MCP access token" },
              taskId: { type: "STRING", description: "Task ID" }
            },
            required: ["accessToken", "taskId"]
          }
        },
        {
          name: "astrid_update_task",
          description: "Update task status or properties",
          parameters: {
            type: "OBJECT",
            properties: {
              accessToken: { type: "STRING", description: "MCP access token" },
              taskId: { type: "STRING", description: "Task ID" },
              completed: { type: "BOOLEAN", description: "Mark task as completed" },
              progress: { type: "STRING", description: "Progress update" }
            },
            required: ["accessToken", "taskId"]
          }
        },
        {
          name: "astrid_add_comment",
          description: "Add a progress comment to a task",
          parameters: {
            type: "OBJECT",
            properties: {
              accessToken: { type: "STRING", description: "MCP access token" },
              taskId: { type: "STRING", description: "Task ID" },
              content: { type: "STRING", description: "Comment content" }
            },
            required: ["accessToken", "taskId", "content"]
          }
        }
      ]
    }
  })
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    service: "Gemini Integration Webhook",
    description: `Integration point for Google Gemini AI services with ${BRAND.appName} Task Manager`,
    status: "active",
    integration: {
      type: "Function Calling",
      description: "Use Gemini's function calling capability to interact with {BRAND.appName} MCP API",
      endpoint: `https://${BRAND.domain}/api/mcp/operations`
    },
    setup: {
      step1: `Configure Gemini with function declarations for ${BRAND.appName} MCP operations`,
      step2: "Use provided MCP access token for authentication",
      step3: "Call functions to read task details, update status, and add comments"
    }
  })
}