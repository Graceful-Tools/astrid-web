/**
 * Astrid Agent Runtime
 *
 * Processes messages directed at Astrid and generates responses using
 * the user's configured AI model. Responds directly in the chat channel.
 */

import { prisma } from '@/lib/prisma'
import { getCachedApiKey } from '@/lib/api-key-cache'
import { getPreferredAIService } from '@/lib/api-key-cache'
import { broadcastToUsers } from '@/lib/sse-utils'
import { ASTRID_EMAIL } from '@/lib/astrid-agent'

// ─── System prompt ────────────────────────────────────────────────

function buildSystemPrompt(context: {
  userName: string
  listName?: string
  taskContext?: string
}): string {
  return `You are Astrid, a helpful task management assistant. You help ${context.userName} manage their tasks and lists.

## Your capabilities
- Read and respond to messages in list chats and task comments
- Help users plan, organize, and complete tasks
- Answer questions about tasks, due dates, and priorities
- Suggest task breakdowns and next steps
- Help with scheduling and time management

## Current context
${context.listName ? `- List: ${context.listName}` : '- View: My Tasks'}
${context.taskContext ? `\n## Relevant tasks\n${context.taskContext}` : ''}

## Response style
- Be concise and action-oriented
- If asked to do something, acknowledge quickly: "On it!" or "I'll take care of that."
- Use markdown for formatting when helpful
- Keep responses under 2-3 sentences for simple questions
- For complex requests, briefly outline your plan then execute
- If the user assigns you a task, confirm and note the timeline
- For tasks with due dates, mention when you'll start working on them`
}

// ─── AI Provider Calls ────────────────────────────────────────────

async function callClaude(apiKey: string, systemPrompt: string, userMessage: string, model?: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })
  if (!res.ok) throw new Error(`Claude API error: ${res.status}`)
  const data = await res.json()
  return data.content?.[0]?.text || 'I encountered an issue processing your request.'
}

async function callOpenAI(apiKey: string, systemPrompt: string, userMessage: string, model?: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'gpt-4o',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  })
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content || 'I encountered an issue processing your request.'
}

async function callGemini(apiKey: string, systemPrompt: string, userMessage: string, model?: string): Promise<string> {
  const modelId = model || 'gemini-2.0-flash'
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: 1024 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`)
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'I encountered an issue processing your request.'
}

// ─── Context Building ─────────────────────────────────────────────

async function buildTaskContext(listId: string | null, userId: string): Promise<string> {
  try {
    const where: Record<string, unknown> = {
      completed: false,
    }

    if (listId) {
      where.lists = { some: { id: listId } }
    } else {
      // My Tasks — tasks assigned to or created by this user
      where.OR = [
        { assigneeId: userId },
        { creatorId: userId },
      ]
    }

    const tasks = await prisma.task.findMany({
      where,
      select: {
        title: true,
        dueDateTime: true,
        priority: true,
        completed: true,
        assignee: { select: { name: true } },
      },
      orderBy: [{ dueDateTime: 'asc' }, { priority: 'desc' }],
      take: 15,
    })

    if (tasks.length === 0) return ''

    return tasks.map(t => {
      const due = t.dueDateTime ? ` (due: ${t.dueDateTime.toLocaleDateString()})` : ''
      const priority = t.priority ? ` [P${t.priority}]` : ''
      return `- ${t.title}${priority}${due}`
    }).join('\n')
  } catch {
    return ''
  }
}

// ─── Main Entry Point ─────────────────────────────────────────────

interface ProcessMessageParams {
  /** The user's message content (with @mention stripped for clarity) */
  userMessage: string
  /** The user who sent the message */
  userId: string
  userName: string
  /** The chat channel to respond in */
  channelId: string
  /** The list this chat belongs to (null for virtual lists) */
  listId: string | null
}

/**
 * Process a message directed at Astrid and post a response in the chat.
 * Called when Astrid is @mentioned or is the default agent for a chat.
 */
export async function processAstridMessage(params: ProcessMessageParams): Promise<void> {
  const { userMessage, userId, userName, channelId, listId } = params

  try {
    // 1. Determine which AI service and model to use
    const service = await getPreferredAIService(userId)
    const apiKey = await getCachedApiKey(userId, service)
    if (!apiKey) {
      console.error(`[Astrid] No API key for ${service} for user ${userId}`)
      return
    }

    // Get user's model preference
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mcpSettings: true },
    })
    const mcpSettings = user?.mcpSettings ? JSON.parse(user.mcpSettings) : {}
    const model = mcpSettings.modelPreferences?.[service] || undefined

    // 2. Build context
    const listName = listId
      ? (await prisma.taskList.findUnique({ where: { id: listId }, select: { name: true } }))?.name
      : undefined
    const taskContext = await buildTaskContext(listId, userId)

    const systemPrompt = buildSystemPrompt({
      userName,
      listName: listName || undefined,
      taskContext,
    })

    // Strip @mention markup from message for cleaner AI input
    const cleanMessage = userMessage
      .replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
      .replace(/#\[([^\]]+)\]\([^)]+\)/g, '#$1')
      .replace(/!\[([^\]]+)\]\([^)]+\)/g, '!$1')

    // 3. Call the AI model
    let response: string
    switch (service) {
      case 'claude':
        response = await callClaude(apiKey, systemPrompt, cleanMessage, model)
        break
      case 'openai':
        response = await callOpenAI(apiKey, systemPrompt, cleanMessage, model)
        break
      case 'gemini':
        response = await callGemini(apiKey, systemPrompt, cleanMessage, model)
        break
      default:
        console.error(`[Astrid] Unsupported service: ${service}`)
        return
    }

    // 4. Post the response as Astrid in the chat channel
    const astridUser = await prisma.user.findFirst({
      where: { email: ASTRID_EMAIL },
      select: { id: true, name: true, email: true, image: true, isAIAgent: true, aiAgentType: true },
    })
    if (!astridUser) {
      console.error('[Astrid] astrid@astrid.cc user not found')
      return
    }

    const message = await prisma.chatMessage.create({
      data: {
        channelId,
        authorId: astridUser.id,
        content: response,
        type: 'MARKDOWN',
      },
      include: {
        author: {
          select: { id: true, name: true, email: true, image: true, isAIAgent: true, aiAgentType: true },
        },
      },
    })

    const serializedMessage = {
      ...message,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
    }

    // 5. Broadcast the response to all channel members (except Astrid)
    const { getChatChannelRecipients } = await import('@/lib/chat-access')
    const recipients = await getChatChannelRecipients(channelId)
    const otherRecipients = recipients.filter(id => id !== astridUser.id)

    if (otherRecipients.length > 0) {
      await broadcastToUsers(otherRecipients, {
        type: 'chat_message_created',
        timestamp: new Date().toISOString(),
        data: {
          channelId,
          message: serializedMessage,
        },
      })
    }

    console.log(`[Astrid] Responded in channel ${channelId} using ${service}/${model || 'default'}`)
  } catch (error) {
    console.error('[Astrid] Error processing message:', error)
  }
}

// ─── Task Comment Response ────────────────────────────────────────

interface ProcessCommentParams {
  /** The comment content */
  commentContent: string
  /** The user who posted the comment */
  userId: string
  userName: string
  /** The task this comment is on */
  taskId: string
  taskTitle: string
  /** The list this task belongs to */
  listId: string | null
}

/**
 * Process a task comment and post a response from Astrid.
 */
export async function processAstridComment(params: ProcessCommentParams): Promise<void> {
  const { commentContent, userId, userName, taskId, taskTitle, listId } = params

  try {
    const service = await getPreferredAIService(userId)
    const apiKey = await getCachedApiKey(userId, service)
    if (!apiKey) return

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mcpSettings: true },
    })
    const mcpSettings = user?.mcpSettings ? JSON.parse(user.mcpSettings) : {}
    const model = mcpSettings.modelPreferences?.[service] || undefined

    const taskContext = await buildTaskContext(listId, userId)
    const systemPrompt = buildSystemPrompt({
      userName,
      listName: listId
        ? (await prisma.taskList.findUnique({ where: { id: listId }, select: { name: true } }))?.name || undefined
        : undefined,
      taskContext,
    }) + `\n\n## Current task\nTitle: ${taskTitle}\nTask ID: ${taskId}\n\nThe user has commented on this task. Respond helpfully in the context of this specific task.`

    const cleanComment = commentContent
      .replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
      .replace(/#\[([^\]]+)\]\([^)]+\)/g, '#$1')
      .replace(/!\[([^\]]+)\]\([^)]+\)/g, '!$1')

    let response: string
    switch (service) {
      case 'claude':
        response = await callClaude(apiKey, systemPrompt, cleanComment, model)
        break
      case 'openai':
        response = await callOpenAI(apiKey, systemPrompt, cleanComment, model)
        break
      case 'gemini':
        response = await callGemini(apiKey, systemPrompt, cleanComment, model)
        break
      default:
        return
    }

    // Post as a comment from Astrid
    const astridUser = await prisma.user.findFirst({
      where: { email: ASTRID_EMAIL },
      select: { id: true },
    })
    if (!astridUser) return

    const comment = await prisma.comment.create({
      data: {
        content: response,
        type: 'MARKDOWN',
        authorId: astridUser.id,
        taskId,
      },
      include: {
        author: { select: { id: true, name: true, email: true, image: true } },
      },
    })

    // Broadcast to task stakeholders
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        creatorId: true,
        assigneeId: true,
        lists: { select: { ownerId: true, listMembers: { select: { userId: true } } } },
      },
    })

    if (task) {
      const recipientIds = new Set<string>()
      if (task.creatorId) recipientIds.add(task.creatorId)
      if (task.assigneeId) recipientIds.add(task.assigneeId)
      task.lists?.forEach(l => {
        recipientIds.add(l.ownerId)
        l.listMembers?.forEach(m => recipientIds.add(m.userId))
      })
      recipientIds.delete(astridUser.id)

      if (recipientIds.size > 0) {
        await broadcastToUsers([...recipientIds], {
          type: 'comment_created',
          timestamp: new Date().toISOString(),
          data: {
            taskId,
            comment: {
              ...comment,
              createdAt: comment.createdAt.toISOString(),
              updatedAt: comment.updatedAt.toISOString(),
            },
          },
        })
      }
    }

    console.log(`[Astrid] Commented on task "${taskTitle}" using ${service}/${model || 'default'}`)
  } catch (error) {
    console.error('[Astrid] Error processing comment:', error)
  }
}
