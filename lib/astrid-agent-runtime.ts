/**
 * Astrid Agent Runtime
 *
 * Processes messages directed at Astrid and generates responses using
 * the user's configured AI model with tool calling for real task actions.
 */

import { prisma } from '@/lib/prisma'
import { getCachedApiKey, getPreferredAIService } from '@/lib/api-key-cache'
import { broadcastToUsers } from '@/lib/sse-utils'
import { ASTRID_EMAIL } from '@/lib/astrid-agent'
import { astridCreateTask, astridCompleteTask, astridListTasks } from '@/lib/astrid-api-client'

// ─── Tool Definitions ─────────────────────────────────────────────

const TOOLS_CLAUDE = [
  {
    name: 'create_task',
    description: 'Create a new task in a list. The task will be visible to the user immediately.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Task title' },
        assignee_email: { type: 'string', description: 'Email of the person to assign the task to. Use the current user\'s email if they say "assign to me".' },
        list_id: { type: 'string', description: 'List ID to add the task to. Use the current list ID if available.' },
        priority: { type: 'number', description: 'Priority 0-3 (0=none, 1=low, 2=medium, 3=high)', enum: [0, 1, 2, 3] },
        due_date: { type: 'string', description: 'Due date in ISO 8601 format (e.g. 2026-03-30T17:00:00Z). Optional.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as complete.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'The task ID to complete' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks in the current context. Returns incomplete tasks by default.',
    input_schema: {
      type: 'object' as const,
      properties: {
        include_completed: { type: 'boolean', description: 'Include completed tasks' },
        limit: { type: 'number', description: 'Max tasks to return (default 10)' },
      },
      required: [],
    },
  },
]

const TOOLS_OPENAI = TOOLS_CLAUDE.map(t => ({
  type: 'function' as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}))

// ─── Tool Execution ───────────────────────────────────────────────

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  context: { userId: string; userEmail: string; listId: string | null }
): Promise<string> {
  try {
    switch (toolName) {
      case 'create_task': {
        const title = input.title as string
        const assigneeEmail = input.assignee_email as string | undefined
        const listId = (input.list_id as string) || context.listId
        const priority = (input.priority as number) || 0
        const dueDate = input.due_date ? new Date(input.due_date as string) : null

        // Resolve assignee by email
        let assigneeId: string | null = null
        if (assigneeEmail) {
          if (assigneeEmail === context.userEmail) {
            assigneeId = context.userId
          } else {
            const assignee = await prisma.user.findFirst({
              where: { email: assigneeEmail },
              select: { id: true },
            })
            assigneeId = assignee?.id || null
          }
        }

        const result = await astridCreateTask({
          title,
          assigneeId,
          creatorId: context.userId,
          listIds: listId ? [listId] : [],
          priority,
          dueDateTime: dueDate,
        })

        return JSON.stringify({ success: true, taskId: result.id, title: result.title })
      }

      case 'complete_task': {
        const taskId = input.task_id as string
        const result = await astridCompleteTask({ taskId, userId: context.userId })
        return JSON.stringify({ success: true, taskId: result.id, title: result.title })
      }

      case 'list_tasks': {
        const tasks = await astridListTasks({
          userId: context.userId,
          listId: context.listId,
          includeCompleted: input.include_completed as boolean || false,
          limit: (input.limit as number) || 10,
        })
        return JSON.stringify({ tasks })
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` })
    }
  } catch (error) {
    console.error(`[Astrid] Tool ${toolName} failed:`, error)
    return JSON.stringify({ error: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}` })
  }
}

// ─── System Prompt ────────────────────────────────────────────────

function buildSystemPrompt(context: {
  userName: string
  userEmail: string
  listName?: string
  listId?: string | null
  taskContext?: string
}): string {
  return `You are Astrid, a helpful task management assistant. You help ${context.userName} (${context.userEmail}) manage their tasks and lists.

## Tools
You have real tools to create tasks, complete tasks, and list tasks. USE THEM when the user asks you to take action. Do not just say you did something — actually call the tool.

## Current context
${context.listName ? `- List: ${context.listName} (ID: ${context.listId})` : '- View: My Tasks'}
- User email: ${context.userEmail}
${context.taskContext ? `\n## Current tasks\n${context.taskContext}` : ''}

## Response style
- Be concise and action-oriented
- When creating/completing tasks, call the tool FIRST, then confirm briefly
- Keep responses under 2-3 sentences
- Use markdown sparingly`
}

// ─── AI Provider Calls with Tools ─────────────────────────────────

async function callClaudeWithTools(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  context: { userId: string; userEmail: string; listId: string | null },
  model?: string
): Promise<string> {
  let messages: Array<{ role: string; content: unknown }> = [
    { role: 'user', content: userMessage },
  ]

  // Allow up to 3 tool-use rounds
  for (let i = 0; i < 3; i++) {
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
        tools: TOOLS_CLAUDE,
        messages,
      }),
    })
    if (!res.ok) throw new Error(`Claude API error: ${res.status}`)
    const data = await res.json()

    // Check for tool use
    const toolUseBlocks = (data.content || []).filter((b: { type: string }) => b.type === 'tool_use')
    const textBlocks = (data.content || []).filter((b: { type: string }) => b.type === 'text')

    if (toolUseBlocks.length === 0) {
      // No tool calls — return text
      return textBlocks.map((b: { text: string }) => b.text).join('\n') || 'Done!'
    }

    // Execute tools and continue conversation
    messages.push({ role: 'assistant', content: data.content })

    const toolResults = []
    for (const toolBlock of toolUseBlocks) {
      const result = await executeTool(toolBlock.name, toolBlock.input, context)
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: result,
      })
    }
    messages.push({ role: 'user', content: toolResults })

    // If stop_reason is 'end_turn', we're done after getting final text
    if (data.stop_reason === 'end_turn') {
      return textBlocks.map((b: { text: string }) => b.text).join('\n') || 'Done!'
    }
  }

  return 'I completed the actions requested.'
}

async function callOpenAIWithTools(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  context: { userId: string; userEmail: string; listId: string | null },
  model?: string
): Promise<string> {
  let messages: Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  for (let i = 0; i < 3; i++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        max_tokens: 1024,
        tools: TOOLS_OPENAI,
        messages,
      }),
    })
    if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`)
    const data = await res.json()

    const choice = data.choices?.[0]
    const msg = choice?.message

    if (!msg?.tool_calls?.length) {
      return msg?.content || 'Done!'
    }

    // Execute tool calls
    messages.push({ role: 'assistant', content: msg.content, tool_calls: msg.tool_calls })

    for (const tc of msg.tool_calls) {
      const args = JSON.parse(tc.function.arguments)
      const result = await executeTool(tc.function.name, args, context)
      messages.push({ role: 'tool', content: result, tool_call_id: tc.id })
    }
  }

  return 'I completed the actions requested.'
}

async function callGemini(apiKey: string, systemPrompt: string, userMessage: string, model?: string): Promise<string> {
  // Gemini tool calling is more complex — use simple completion for now
  const modelId = model || 'gemini-2.0-flash'
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt + '\n\nIMPORTANT: You do not have tools available in this mode. Only answer questions and provide suggestions. Do NOT claim to have created or modified tasks.' }] },
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
    const where: Record<string, unknown> = { completed: false }
    if (listId) {
      where.lists = { some: { id: listId } }
    } else {
      where.OR = [{ assigneeId: userId }, { creatorId: userId }]
    }

    const tasks = await prisma.task.findMany({
      where,
      select: { id: true, title: true, dueDateTime: true, priority: true, assignee: { select: { name: true } } },
      orderBy: [{ dueDateTime: 'asc' }, { priority: 'desc' }],
      take: 15,
    })

    if (tasks.length === 0) return ''
    return tasks.map(t => {
      const due = t.dueDateTime ? ` (due: ${t.dueDateTime.toLocaleDateString()})` : ''
      const priority = t.priority ? ` [P${t.priority}]` : ''
      return `- [${t.id}] ${t.title}${priority}${due}`
    }).join('\n')
  } catch {
    return ''
  }
}

// ─── Main Entry Points ───────────────────────────────────────────

interface ProcessMessageParams {
  userMessage: string
  userId: string
  userName: string
  channelId: string
  listId: string | null
}

export async function processAstridMessage(params: ProcessMessageParams): Promise<void> {
  const { userMessage, userId, userName, channelId, listId } = params

  try {
    const service = await getPreferredAIService(userId)
    const apiKey = await getCachedApiKey(userId, service)
    if (!apiKey) return

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mcpSettings: true, email: true },
    })
    const mcpSettings = user?.mcpSettings ? JSON.parse(user.mcpSettings) : {}
    const model = mcpSettings.modelPreferences?.[service] || undefined
    const userEmail = user?.email || ''

    const listName = listId
      ? (await prisma.taskList.findUnique({ where: { id: listId }, select: { name: true } }))?.name
      : undefined
    const taskContext = await buildTaskContext(listId, userId)

    const systemPrompt = buildSystemPrompt({
      userName,
      userEmail,
      listName: listName || undefined,
      listId,
      taskContext,
    })

    const cleanMessage = userMessage
      .replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
      .replace(/#\[([^\]]+)\]\([^)]+\)/g, '#$1')
      .replace(/!\[([^\]]+)\]\([^)]+\)/g, '!$1')

    const toolContext = { userId, userEmail, listId }

    let response: string
    switch (service) {
      case 'claude':
        response = await callClaudeWithTools(apiKey, systemPrompt, cleanMessage, toolContext, model)
        break
      case 'openai':
        response = await callOpenAIWithTools(apiKey, systemPrompt, cleanMessage, toolContext, model)
        break
      case 'gemini':
        response = await callGemini(apiKey, systemPrompt, cleanMessage, model)
        break
      default:
        return
    }

    // Post response as Astrid
    const astridUser = await prisma.user.findFirst({
      where: { email: ASTRID_EMAIL },
      select: { id: true, name: true, email: true, image: true, isAIAgent: true, aiAgentType: true },
    })
    if (!astridUser) return

    const message = await prisma.chatMessage.create({
      data: { channelId, authorId: astridUser.id, content: response, type: 'MARKDOWN' },
      include: {
        author: { select: { id: true, name: true, email: true, image: true, isAIAgent: true, aiAgentType: true } },
      },
    })

    const serialized = { ...message, createdAt: message.createdAt.toISOString(), updatedAt: message.updatedAt.toISOString() }

    const { getChatChannelRecipients } = await import('@/lib/chat-access')
    const recipients = (await getChatChannelRecipients(channelId)).filter(id => id !== astridUser.id)
    if (recipients.length > 0) {
      await broadcastToUsers(recipients, {
        type: 'chat_message_created',
        timestamp: new Date().toISOString(),
        data: { channelId, message: serialized },
      })
    }

    console.log(`[Astrid] Responded in channel ${channelId} using ${service}/${model || 'default'}`)
  } catch (error) {
    console.error('[Astrid] Error processing message:', error)
  }
}

// ─── Task Comment Response ────────────────────────────────────────

interface ProcessCommentParams {
  commentContent: string
  userId: string
  userName: string
  taskId: string
  taskTitle: string
  listId: string | null
}

export async function processAstridComment(params: ProcessCommentParams): Promise<void> {
  const { commentContent, userId, userName, taskId, taskTitle, listId } = params

  try {
    const service = await getPreferredAIService(userId)
    const apiKey = await getCachedApiKey(userId, service)
    if (!apiKey) return

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mcpSettings: true, email: true },
    })
    const mcpSettings = user?.mcpSettings ? JSON.parse(user.mcpSettings) : {}
    const model = mcpSettings.modelPreferences?.[service] || undefined
    const userEmail = user?.email || ''

    const taskContext = await buildTaskContext(listId, userId)
    const systemPrompt = buildSystemPrompt({
      userName,
      userEmail,
      listName: listId ? (await prisma.taskList.findUnique({ where: { id: listId }, select: { name: true } }))?.name || undefined : undefined,
      listId,
      taskContext,
    }) + `\n\n## Current task\nTitle: ${taskTitle}\nTask ID: ${taskId}\n\nThe user commented on this task. Respond helpfully.`

    const cleanComment = commentContent
      .replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
      .replace(/#\[([^\]]+)\]\([^)]+\)/g, '#$1')
      .replace(/!\[([^\]]+)\]\([^)]+\)/g, '!$1')

    const toolContext = { userId, userEmail, listId }

    let response: string
    switch (service) {
      case 'claude':
        response = await callClaudeWithTools(apiKey, systemPrompt, cleanComment, toolContext, model)
        break
      case 'openai':
        response = await callOpenAIWithTools(apiKey, systemPrompt, cleanComment, toolContext, model)
        break
      case 'gemini':
        response = await callGemini(apiKey, systemPrompt, cleanComment, model)
        break
      default:
        return
    }

    const astridUser = await prisma.user.findFirst({ where: { email: ASTRID_EMAIL }, select: { id: true } })
    if (!astridUser) return

    const comment = await prisma.comment.create({
      data: { content: response, type: 'MARKDOWN', authorId: astridUser.id, taskId },
      include: { author: { select: { id: true, name: true, email: true, image: true } } },
    })

    // Broadcast to task stakeholders
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { creatorId: true, assigneeId: true, lists: { select: { ownerId: true, listMembers: { select: { userId: true } } } } },
    })
    if (task) {
      const recipientIds = new Set<string>()
      if (task.creatorId) recipientIds.add(task.creatorId)
      if (task.assigneeId) recipientIds.add(task.assigneeId)
      task.lists?.forEach(l => { recipientIds.add(l.ownerId); l.listMembers?.forEach(m => recipientIds.add(m.userId)) })
      recipientIds.delete(astridUser.id)

      if (recipientIds.size > 0) {
        await broadcastToUsers([...recipientIds], {
          type: 'comment_created',
          timestamp: new Date().toISOString(),
          data: { taskId, comment: { ...comment, createdAt: comment.createdAt.toISOString(), updatedAt: comment.updatedAt.toISOString() } },
        })
      }
    }

    console.log(`[Astrid] Commented on task "${taskTitle}" using ${service}/${model || 'default'}`)
  } catch (error) {
    console.error('[Astrid] Error processing comment:', error)
  }
}
