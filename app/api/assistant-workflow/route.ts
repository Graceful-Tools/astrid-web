import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCachedApiKey, getCachedModelPreference } from '@/lib/api-key-cache'
import { uploadTextContent } from '@/lib/secure-storage'

export const runtime = 'nodejs'
export const maxDuration = 60

// Default models when user hasn't configured preferences
const DEFAULT_MODELS = {
  claude: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
} as const

interface AssistantWorkflowRequest {
  taskId: string
  agentEmail: string
  creatorId: string
  isCommentResponse?: boolean
  userComment?: string
}

/**
 * Assistant Workflow - Real-time AI agent processing for non-coding tasks
 *
 * This handles tasks assigned to AI agents that don't require coding/GitHub.
 * Unlike the polling-based coding worker, this runs immediately when triggered.
 */
export async function POST(request: NextRequest) {
  try {
    const body: AssistantWorkflowRequest = await request.json()
    const { taskId, agentEmail, creatorId, isCommentResponse, userComment } = body

    console.log(`🤖 [AssistantWorkflow] Processing task ${taskId} for agent ${agentEmail}`)

    // Get task details
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignee: true,
        creator: { select: { id: true, name: true, email: true } },
        lists: { select: { id: true, name: true, description: true, githubRepositoryId: true } },
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            author: { select: { id: true, name: true, email: true, isAIAgent: true } }
          }
        }
      }
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Determine which AI service to use based on agent email
    const service = getServiceFromEmail(agentEmail)
    if (!service) {
      console.error(`❌ [AssistantWorkflow] Unknown agent email: ${agentEmail}`)
      return NextResponse.json({ error: 'Unknown AI agent' }, { status: 400 })
    }

    // OpenClaw tasks now arrive via the channel plugin, not assistant-workflow
    if (service === 'openclaw') {
      await prisma.comment.create({
        data: {
          taskId,
          authorId: task.assigneeId,
          content: `To use OpenClaw with Astrid, install the Astrid channel plugin in your OpenClaw instance. OpenClaw connects outbound to Astrid — no gateway URL needed.\n\nSee: https://github.com/Graceful-Tools/astrid-web/tree/main/packages/openclaw-astrid-channel`
        }
      })
      return NextResponse.json({ error: 'OpenClaw uses channel plugin', commented: true })
    }

    // Get the creator's API key for this service
    const apiKey = await getCachedApiKey(creatorId, service)
    if (!apiKey) {
      console.log(`⚠️ [AssistantWorkflow] No ${service} API key for user ${creatorId}`)

      // Post a comment explaining the issue
      await prisma.comment.create({
        data: {
          taskId,
          authorId: task.assigneeId,
          content: `I'd love to help with this task, but I need an API key to be configured. Please go to Settings → AI Agents and add your ${service.charAt(0).toUpperCase() + service.slice(1)} API key.`
        }
      })

      return NextResponse.json({ error: 'No API key configured', commented: true })
    }

    // Build the prompt
    const prompt = buildPrompt(task, isCommentResponse, userComment)

    // Get user's model preference for this service
    const userModel = await getCachedModelPreference(creatorId, service)
    const model = userModel || DEFAULT_MODELS[service]
    console.log(`🤖 [AssistantWorkflow] Using model: ${model} (user preference: ${userModel ? 'yes' : 'no'})`)

    // Call the appropriate AI service
    let response: string
    try {
      response = await callAIService(service, apiKey, prompt, model)
    } catch (aiError: any) {
      console.error(`❌ [AssistantWorkflow] AI call failed:`, aiError)

      // Post error comment
      await prisma.comment.create({
        data: {
          taskId,
          authorId: task.assigneeId,
          content: `I encountered an error while processing this task: ${aiError.message || 'Unknown error'}. Please try again or check your API key settings.`
        }
      })

      return NextResponse.json({ error: 'AI call failed', message: aiError.message })
    }

    // Check if response contains a file attachment
    // Format: <<<FILE:filename.ext>>>content<<<END_FILE>>>
    const fileMatch = response.match(/<<<FILE:([^>]+)>>>([\s\S]*?)<<<END_FILE>>>/i)
    let fileId: string | null = null
    let commentContent = response

    if (fileMatch && task.assigneeId) {
      const fileName = fileMatch[1].trim()
      const fileContent = fileMatch[2].trim()

      // Determine MIME type from extension
      const ext = fileName.split('.').pop()?.toLowerCase()
      let mimeType: 'text/plain' | 'text/markdown' | 'application/json' = 'text/plain'
      if (ext === 'md' || ext === 'markdown') mimeType = 'text/markdown'
      else if (ext === 'json') mimeType = 'application/json'

      try {
        // Upload the file
        const uploadResult = await uploadTextContent(
          fileContent,
          fileName,
          mimeType,
          task.assigneeId, // AI agent uploads the file
          taskId
        )

        // Create SecureFile record
        const secureFile = await prisma.secureFile.create({
          data: {
            id: uploadResult.fileId,
            blobUrl: uploadResult.blobUrl,
            originalName: fileName,
            mimeType,
            fileSize: Buffer.byteLength(fileContent, 'utf-8'),
            uploadedBy: task.assigneeId,
            taskId,
          }
        })
        fileId = secureFile.id

        // Remove file markers from comment content
        commentContent = response
          .replace(/<<<FILE:[^>]+>>>[\s\S]*?<<<END_FILE>>>/gi, '')
          .trim()

        // If no comment content left, add a note
        if (!commentContent) {
          commentContent = `📎 I've attached the deliverable as a file: **${fileName}**`
        } else {
          commentContent += `\n\n📎 **Attached:** ${fileName}`
        }

        console.log(`📎 [AssistantWorkflow] Uploaded file attachment: ${fileName}`)
      } catch (uploadError) {
        console.error(`❌ [AssistantWorkflow] Failed to upload file:`, uploadError)
        // Keep the file content in the response if upload fails
      }
    }

    // Post the AI response as a comment
    const comment = await prisma.comment.create({
      data: {
        taskId,
        authorId: task.assigneeId,
        content: commentContent
      }
    })

    // Link the file to the comment if uploaded
    if (fileId) {
      await prisma.secureFile.update({
        where: { id: fileId },
        data: { commentId: comment.id }
      })
    }

    console.log(`✅ [AssistantWorkflow] Posted response for task ${taskId}${fileId ? ' with attachment' : ''}`)

    return NextResponse.json({
      success: true,
      commentId: comment.id,
      service
    })

  } catch (error: any) {
    console.error(`❌ [AssistantWorkflow] Error:`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

function getServiceFromEmail(email: string): 'claude' | 'openai' | 'gemini' | 'openclaw' | null {
  if (email === 'claude@astrid.cc') return 'claude'
  if (email === 'openai@astrid.cc') return 'openai'
  if (email === 'gemini@astrid.cc') return 'gemini'
  if (email === 'openclaw@astrid.cc') return 'openclaw'
  // Match {name}.oc@astrid.cc pattern for OpenClaw agents
  if (email.match(/\.oc@astrid\.cc$/i)) return 'openclaw'
  return null
}

function buildPrompt(task: any, isCommentResponse?: boolean, userComment?: string): string {
  // List description serves as agent instructions (like claude.md for a project)
  const listDescription = task.lists?.[0]?.description?.trim()
  const listName = task.lists?.[0]?.name || 'My Tasks'

  const defaultInstructions = `You are an AI assistant working on tasks in Astrid. Read the task details and help complete it. Post progress updates as comments.`

  const instructions = listDescription || defaultInstructions

  const taskContext = `**${task.title}**
${task.description ? `\n${task.description}` : ''}
Priority: ${['None', 'Low', 'Medium', 'High'][task.priority] || 'None'}
${task.dueDateTime ? `Due: ${new Date(task.dueDateTime).toLocaleDateString()}` : ''}
List: ${listName}`

  // Include recent conversation history
  const conversationHistory = task.comments
    ?.slice(0, 5)
    .reverse()
    .map((c: any) => {
      const authorName = c.author?.isAIAgent ? 'AI Assistant' : (c.author?.name || 'User')
      return `${authorName}: ${c.content}`
    })
    .join('\n\n')

  let prompt = `## Instructions\n${instructions}\n\n## Task\n${taskContext}`

  if (conversationHistory) {
    prompt += `\n\n## Conversation\n${conversationHistory}`
  }

  if (isCommentResponse && userComment) {
    prompt += `\n\n## New Comment\nThe user just commented: "${userComment}"\n\nRespond to their comment. Be concise but thorough.`
  }

  prompt += `\n\n## File Attachments\nTo deliver a file, use: <<<FILE:filename.ext>>>content<<<END_FILE>>>`

  return prompt
}

/**
 * LEGACY/FALLBACK: Direct AI API calls for basic mode.
 * This is the fallback for users without an external agent runtime (OpenClaw, Claude Code Remote).
 * For coding tasks, Astrid now dispatches to external runtimes via webhooks/SSE.
 */
async function callAIService(
  service: 'claude' | 'openai' | 'gemini',
  apiKey: string,
  prompt: string,
  model: string
): Promise<string> {
  switch (service) {
    case 'claude': {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }]
        })
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Claude API error: ${error}`)
      }

      const data = await response.json()
      const textBlock = data.content?.find((block: { type: string }) => block.type === 'text')
      return textBlock?.text || 'I apologize, but I was unable to generate a response.'
    }

    case 'openai': {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }]
        })
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`OpenAI API error: ${error}`)
      }

      const data = await response.json()
      return data.choices?.[0]?.message?.content || 'I apologize, but I was unable to generate a response.'
    }

    case 'gemini': {
      // Use v1beta for preview models, v1 for stable models
      const apiVersion = model.includes('preview') ? 'v1beta' : 'v1'
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1024 }
        })
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Gemini API error: ${error}`)
      }

      const data = await response.json()
      return data.candidates?.[0]?.content?.parts?.[0]?.text || 'I apologize, but I was unable to generate a response.'
    }

    default:
      throw new Error(`Unknown service: ${service}`)
  }
}
