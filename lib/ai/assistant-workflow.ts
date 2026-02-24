/**
 * AI Assistant Workflow
 *
 * Simple assistant workflow for tasks on lists without a GitHub repository.
 * Instead of coding, the AI analyzes the task and provides helpful information.
 */

import { prisma } from '@/lib/prisma'
import { getCachedApiKey, getCachedModelPreference } from '@/lib/api-key-cache'
import type { AIService } from './agent-config'
import { getAgentService } from './agent-config'

// Hardcoded default models - these are reliable fallbacks
const FALLBACK_MODELS: Record<AIService, string> = {
  claude: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',  // Use gpt-4o as reliable default
  gemini: 'gemini-2.0-flash',
  openclaw: 'anthropic/claude-opus-4-5',
}

interface AssistantResult {
  success: boolean
  response: string
  error?: string
  usage?: {
    inputTokens: number
    outputTokens: number
    costUSD: number
  }
}

/**
 * Call AI as a simple assistant (no coding tools) for lists without git repos.
 * Returns a helpful response that gets added to the task description.
 */
async function callAssistant(
  service: AIService,
  taskTitle: string,
  taskDescription: string | null,
  apiKey: string,
  model?: string
): Promise<AssistantResult> {
  const prompt = `You are a helpful AI assistant. The user has created a task that needs your help.

**Task Title:** ${taskTitle}
${taskDescription ? `\n**Task Description:**\n${taskDescription}` : ''}

Please provide a helpful, comprehensive response to this task. You can:
- Answer questions
- Provide recommendations
- Create plans or outlines
- Offer analysis or insights
- Suggest next steps

Format your response in clear markdown. Be thorough but concise.`

  try {
    switch (service) {
      case 'gemini': {
        const geminiModel = model || FALLBACK_MODELS.gemini
        // Use v1beta for preview models, v1 for stable models
        const apiVersion = geminiModel.includes('preview') ? 'v1beta' : 'v1'
        const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${geminiModel}:generateContent?key=${apiKey}`

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 4096,
              temperature: 0.7
            }
          })
        })

        if (!response.ok) {
          const error = await response.text()
          return { success: false, response: '', error: `Gemini API error: ${error}` }
        }

        const data = await response.json()
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
        const inputTokens = data.usageMetadata?.promptTokenCount || 0
        const outputTokens = data.usageMetadata?.candidatesTokenCount || 0

        return {
          success: true,
          response: text,
          usage: {
            inputTokens,
            outputTokens,
            costUSD: (inputTokens * 0.00125 + outputTokens * 0.005) / 1000
          }
        }
      }

      case 'openai': {
        const openaiModel = model || FALLBACK_MODELS.openai
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: openaiModel,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 4096,
            temperature: 0.7
          })
        })

        if (!response.ok) {
          const error = await response.text()
          return { success: false, response: '', error: `OpenAI API error: ${error}` }
        }

        const data = await response.json()
        const text = data.choices?.[0]?.message?.content || ''
        const inputTokens = data.usage?.prompt_tokens || 0
        const outputTokens = data.usage?.completion_tokens || 0

        return {
          success: true,
          response: text,
          usage: {
            inputTokens,
            outputTokens,
            costUSD: (inputTokens * 0.0025 + outputTokens * 0.01) / 1000
          }
        }
      }

      case 'claude': {
        const claudeModel = model || FALLBACK_MODELS.claude
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: claudeModel,
            max_tokens: 4096,
            messages: [{ role: 'user', content: prompt }]
          })
        })

        if (!response.ok) {
          const error = await response.text()
          return { success: false, response: '', error: `Claude API error: ${error}` }
        }

        const data = await response.json()
        const text = data.content?.[0]?.text || ''
        const inputTokens = data.usage?.input_tokens || 0
        const outputTokens = data.usage?.output_tokens || 0

        return {
          success: true,
          response: text,
          usage: {
            inputTokens,
            outputTokens,
            costUSD: (inputTokens * 0.003 + outputTokens * 0.015) / 1000
          }
        }
      }

      case 'openclaw':
      default:
        return {
          success: false,
          response: '',
          error: `Unsupported AI service: ${service}. OpenClaw uses a different execution path.`
        }
    }
  } catch (error) {
    return {
      success: false,
      response: '',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}


/**
 * Execute assistant workflow for a task without a git repository.
 * This is called from the API routes when a task is assigned to an AI agent
 * on a list that doesn't have a GitHub repository configured.
 */
export async function executeAssistantWorkflow(
  taskId: string,
  agentId: string,
  agentEmail: string,
  configuredByUserId: string
): Promise<void> {
  console.log(`🤖 [ASSISTANT] Starting assistant workflow for task ${taskId}`)

  // Get task details
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      assignee: {
        select: { name: true, email: true }
      }
    }
  })

  if (!task) {
    console.error(`❌ [ASSISTANT] Task ${taskId} not found`)
    return
  }

  const agentDisplayName = task.assignee?.name || 'AI Agent'
  const service = getAgentService(agentEmail)

  // Post starting message
  try {
    await prisma.comment.create({
      data: {
        taskId,
        authorId: agentId,
        content: `🤖 **${agentDisplayName} Starting**

**Task:** ${task.title}

⏳ Analyzing your request...`,
        type: 'MARKDOWN'
      }
    })
  } catch (error) {
    console.error(`❌ [ASSISTANT] Failed to post starting comment:`, error)
  }

  // Get API key from the user who configured the AI agent
  const apiKey = await getCachedApiKey(configuredByUserId, service)

  if (!apiKey) {
    console.error(`❌ [ASSISTANT] No ${service} API key configured for user ${configuredByUserId}`)
    await prisma.comment.create({
      data: {
        taskId,
        authorId: agentId,
        content: `❌ **Configuration Error**

No ${service.toUpperCase()} API key configured. Please add your API key in Settings → AI Agents.`,
        type: 'MARKDOWN'
      }
    })
    return
  }

  // Get user's preferred model for this service
  const userModel = await getCachedModelPreference(configuredByUserId, service)
  console.log(`🤖 [ASSISTANT] Using model: ${userModel || FALLBACK_MODELS[service]} (user preference: ${userModel ? 'yes' : 'no'})`)

  // Call the AI assistant with user's model preference
  const result = await callAssistant(
    service,
    task.title,
    task.description,
    apiKey,
    userModel || undefined  // Pass user's model or let callAssistant use fallback
  )

  if (!result.success) {
    console.error(`❌ [ASSISTANT] AI call failed:`, result.error)
    await prisma.comment.create({
      data: {
        taskId,
        authorId: agentId,
        content: `❌ **Assistant Error**

${result.error || 'Unknown error occurred'}

Please try again or provide more details.`,
        type: 'MARKDOWN'
      }
    })
    return
  }

  // Update task description with the AI's response
  try {
    const currentDescription = task.description || ''

    // Remove old AI response if present
    let newDescription = currentDescription
    const existingResponseIndex = newDescription.indexOf('\n\n---\n## AI Assistant Response')
    if (existingResponseIndex >= 0) {
      newDescription = newDescription.substring(0, existingResponseIndex).trim()
    }

    // Add new AI response
    newDescription = `${newDescription}\n\n---\n## AI Assistant Response\n\n${result.response}\n\n---\n*Generated by ${agentDisplayName}${result.usage ? ` • Cost: $${result.usage.costUSD.toFixed(4)}` : ''}*`

    await prisma.task.update({
      where: { id: taskId },
      data: { description: newDescription }
    })

    console.log(`📝 [ASSISTANT] Updated task description with AI response`)
  } catch (error) {
    console.error(`❌ [ASSISTANT] Failed to update task description:`, error)
  }

  // Post completion message
  try {
    await prisma.comment.create({
      data: {
        taskId,
        authorId: agentId,
        content: `✅ **Assistant Complete**

I've added my response to the task description above.${result.usage ? `\n\n*Cost: $${result.usage.costUSD.toFixed(4)}*` : ''}`,
        type: 'MARKDOWN'
      }
    })
    console.log(`✅ [ASSISTANT] Workflow complete for task ${taskId}`)
  } catch (error) {
    console.error(`❌ [ASSISTANT] Failed to post completion comment:`, error)
  }
}
