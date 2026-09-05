/**
 * Run the assistant workflow for a task: build a prompt from the task and its
 * recent conversation, call the creator's configured model, and post the answer
 * as a comment authored by the agent.
 *
 * Extracted from app/api/assistant-workflow/route.ts so that SERVER CALLERS CAN
 * CALL IT DIRECTLY instead of fetching this app's own HTTP API, and the route
 * could then be deleted (task 12b3478d). Same shape as
 * lib/coding-workflow/start-tools-workflow.ts, which Jon chose for the sibling
 * problem in task 46acd19c.
 *
 * WHY THAT MATTERED HERE. The route had no authentication at all — no session,
 * no scope, no secret — because its only three callers were server-side
 * self-fetches with no credentials to send:
 *
 *     lib/prisma.ts                            (assignee-change middleware)
 *     lib/webhooks/comment-notifier.ts
 *     lib/webhooks/task-assignment-notifier.ts
 *
 * So anyone who could reach the URL could name any task id and read it back
 * through the model's answer, and name any `creatorId` and spend that user's
 * API credits. Where 46acd19c failed loudly-into-a-swallowed-catch, this one
 * silently succeeded, which is why it went unnoticed.
 *
 * Calling the function removes the authentication question rather than
 * answering it: there is no request, so there is no session to fake, no
 * internal secret to leak, and no second way in. Nothing called it over HTTP
 * from app/, components/, hooks/, scripts/ or astrid-ios, so nothing external
 * lost an endpoint.
 *
 * AUTHORIZATION IS THE CALLER'S JOB, deliberately, as in start-tools-workflow.
 * All three callers already know they are reacting to a write on a task whose
 * assignee is an internal agent; they have no user identity to check, and
 * inventing one here would be fiction.
 *
 * ONE TIMING NUANCE, worth knowing rather than fixing blind. vercel.json gives
 * every `app/api/**` function 30s, and the deleted route ALSO declared
 * `maxDuration = 60`. The callers awaited the fetch, so a slow model answer
 * already outlived the calling request — the caller died at its own limit while
 * the child invocation ran on and posted the comment anyway. Now the work
 * shares the caller's budget, so a model answer that takes longer than the
 * caller has is lost rather than late. If assistant replies start going missing
 * on slow models, the fix is the callers' maxDuration, not a new endpoint.
 */

import { BRAND } from '@/lib/brand/config'
import { prisma } from '@/lib/prisma'
import { getAIServiceCredential, getCachedModelPreference } from '@/lib/api-key-cache'
import { callCopilot } from '@/lib/ai/providers/copilot-provider'
import { getAgentConfig, type AIService } from '@/lib/ai/agent-config'
import { fetchWithTimeout, AI_REQUEST_TIMEOUT_MS } from '@/lib/ai/clients/fetch-with-timeout'
import {
  buildAgentContextInstructions,
  serializeUntrustedAgentData,
} from '@/lib/ai/prompt-trust'
import { uploadTextContent } from '@/lib/secure-storage'
import { createLogger } from '@/lib/logger'

const log = createLogger('assistant-workflow')

// Default models when user hasn't configured preferences
const DEFAULT_MODELS = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
  copilot: 'gpt-4.1',
} as const

export interface RunAssistantWorkflowArgs {
  taskId: string
  agentEmail: string
  /**
   * Whose API key pays for the answer. Nullable because `Task.creatorId` is,
   * and two of the three callers pass it straight through.
   *
   * Over HTTP that arrived as JSON `null` and nobody noticed; typing it here is
   * how the compiler surfaced it. Behaviour is unchanged on purpose: a null id
   * matches no user, the credential lookup comes back empty, and the task gets
   * the "please configure an API key" comment. That comment is misleading for a
   * task that simply has no creator, but changing it is a product question, not
   * part of closing the auth hole.
   */
  creatorId: string | null
  isCommentResponse?: boolean
  userComment?: string
}

/**
 * `commented` marks the outcomes where the user still got an explanation on the
 * task even though no answer was produced — a missing API key, an OpenClaw
 * agent, a failed model call.
 *
 * Those three used to come back as HTTP 200 with an `error` field, and every
 * caller checked only `response.ok`, so a workflow that never ran logged as a
 * success. Making them `ok: false` is why the call sites below now log them as
 * failures; it changes log lines only, since nothing branched on the body.
 */
export type RunAssistantWorkflowResult =
  | { ok: true; commentId: string; service: AIService }
  | { ok: false; status: 400 | 404 | 500; error: string; commented?: boolean }

export async function runAssistantWorkflow(
  args: RunAssistantWorkflowArgs,
): Promise<RunAssistantWorkflowResult> {
  const { taskId, agentEmail, creatorId, isCommentResponse, userComment } = args

  try {
    log.info(`🤖 [AssistantWorkflow] Processing task ${taskId} for agent ${agentEmail}`)

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
      return { ok: false, status: 404, error: 'Task not found' }
    }

    // Determine which AI service to use based on agent email
    const service = getServiceFromEmail(agentEmail)
    if (!service) {
      log.error(`❌ [AssistantWorkflow] Unknown agent email: ${agentEmail}`)
      return { ok: false, status: 400, error: 'Unknown AI agent' }
    }

    // OpenClaw tasks now arrive via the channel plugin, not assistant-workflow
    if (service === 'openclaw') {
      await prisma.comment.create({
        data: {
          taskId,
          authorId: task.assigneeId,
          content: `To use OpenClaw with ${BRAND.appName}, install the ${BRAND.appName} channel plugin in your OpenClaw instance. OpenClaw connects outbound to ${BRAND.appName} — no gateway URL needed.\n\nSee: https://github.com/Graceful-Tools/astrid-web/tree/main/packages/openclaw-astrid-channel`
        }
      })
      return { ok: false, status: 400, error: 'OpenClaw uses channel plugin', commented: true }
    }

    // Get the creator's API key for this service
    const apiKey = await getAIServiceCredential(creatorId ?? '', service)
    if (!apiKey) {
      log.info(`⚠️ [AssistantWorkflow] No ${service} API key for user ${creatorId}`)

      // Post a comment explaining the issue
      await prisma.comment.create({
        data: {
          taskId,
          authorId: task.assigneeId,
          content: `I'd love to help with this task, but I need an API key to be configured. Please go to Settings → AI Agents and add your ${service.charAt(0).toUpperCase() + service.slice(1)} API key.`
        }
      })

      return { ok: false, status: 400, error: 'No API key configured', commented: true }
    }

    // Build the prompt
    const prompt = buildPrompt(task, isCommentResponse, userComment)

    // Get user's model preference for this service
    const userModel = await getCachedModelPreference(creatorId ?? '', service)
    const model = userModel || DEFAULT_MODELS[service]
    log.info(`🤖 [AssistantWorkflow] Using model: ${model} (user preference: ${userModel ? 'yes' : 'no'})`)

    // Call the appropriate AI service
    let response: string
    try {
      response = await callAIService(service, apiKey, prompt, model, creatorId ?? '')
    } catch (aiError: any) {
      log.error({ err: aiError }, `❌ [AssistantWorkflow] AI call failed:`)

      // Post error comment
      await prisma.comment.create({
        data: {
          taskId,
          authorId: task.assigneeId,
          content: `I encountered an error while processing this task: ${aiError.message || 'Unknown error'}. Please try again or check your API key settings.`
        }
      })

      return {
        ok: false,
        status: 500,
        error: `AI call failed: ${aiError.message || 'Unknown error'}`,
        commented: true,
      }
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

        log.info(`📎 [AssistantWorkflow] Uploaded file attachment: ${fileName}`)
      } catch (uploadError) {
        log.error({ err: uploadError }, `❌ [AssistantWorkflow] Failed to upload file:`)
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

    log.info(`✅ [AssistantWorkflow] Posted response for task ${taskId}${fileId ? ' with attachment' : ''}`)

    return { ok: true, commentId: comment.id, service }

  } catch (error: any) {
    log.error({ err: error }, `❌ [AssistantWorkflow] Error:`)
    return { ok: false, status: 500, error: error?.message || 'Unknown error' }
  }
}

/**
 * Which AI service backs this agent address, or null if it is not a registered agent.
 *
 * This used to re-implement the registry's routing table with hardcoded addresses,
 * which meant the two could disagree about a newly added agent. It now defers to
 * lib/ai/agent-config.ts — including the {name}.oc@ OpenClaw pattern — so the enabled
 * set and the agent-email domain are configuration in one place. Task 97208a72.
 *
 * Note getAgentService() falls back to 'claude' for unknown addresses; this wrapper
 * must keep returning null so the caller can reject them.
 */
function getServiceFromEmail(email: string): AIService | null {
  return getAgentConfig(email)?.service ?? null
}

export function buildPrompt(task: any, isCommentResponse?: boolean, userComment?: string): string {
  const listDescription = task.lists?.[0]?.description?.trim()
  const listName = task.lists?.[0]?.name || 'My Tasks'

  const instructions = buildAgentContextInstructions(
    listDescription,
    `Complete tasks in ${listName} using the available tools.`,
  )
  const taskContext = serializeUntrustedAgentData({
    title: task.title,
    description: task.description || null,
    priority: ['None', 'Low', 'Medium', 'High'][task.priority] || 'None',
    dueDate: task.dueDateTime
      ? new Date(task.dueDateTime).toLocaleDateString()
      : null,
    list: listName,
  })

  // Include recent conversation history
  const conversationHistory = task.comments
    ?.slice(0, 5)
    .reverse()
    .map((c: any) => {
      const authorName = c.author?.isAIAgent ? 'AI Assistant' : (c.author?.name || 'User')
      return { author: authorName, content: c.content }
    })

  let prompt = `${instructions}

## Task data
<untrusted_task_data format="json">
${taskContext}
</untrusted_task_data>`

  if (conversationHistory?.length) {
    prompt += `\n\n## Conversation data
<untrusted_comment_data format="json">
${serializeUntrustedAgentData(conversationHistory)}
</untrusted_comment_data>`
  }

  if (isCommentResponse && userComment) {
    prompt += `\n\n## New comment data
<untrusted_new_comment format="json">
${serializeUntrustedAgentData(userComment)}
</untrusted_new_comment>

Respond to the new comment. Be concise but thorough.`
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
  service: 'claude' | 'openai' | 'gemini' | 'copilot',
  apiKey: string,
  prompt: string,
  model: string,
  userId: string,
): Promise<string> {
  switch (service) {
    case 'claude': {
      const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
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
      }, AI_REQUEST_TIMEOUT_MS, 'Claude')

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Claude API error: ${error}`)
      }

      const data = await response.json()
      const textBlock = data.content?.find((block: { type: string }) => block.type === 'text')
      return textBlock?.text || 'I apologize, but I was unable to generate a response.'
    }

    case 'openai': {
      const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
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
      }, AI_REQUEST_TIMEOUT_MS, 'OpenAI')

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`OpenAI API error: ${error}`)
      }

      const data = await response.json()
      return data.choices?.[0]?.message?.content || 'I apologize, but I was unable to generate a response.'
    }

    case 'copilot': {
      const response = await callCopilot({ apiKey, prompt, userId, model })
      return response.content
    }

    case 'gemini': {
      // Use v1beta for preview models, v1 for stable models
      const apiVersion = model.includes('preview') ? 'v1beta' : 'v1'
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 1024 }
          })
        },
        AI_REQUEST_TIMEOUT_MS,
        'Gemini',
      )

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
