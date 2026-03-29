/**
 * Astrid Agent Runtime
 *
 * Processes messages directed at Astrid and generates responses using
 * the user's configured AI model. Astrid has access to the full Astrid
 * v1 API via a single `api_request` tool — the same API that mobile
 * apps and external agents use.
 */

import { prisma } from '@/lib/prisma'
import { getCachedApiKey, getPreferredAIService } from '@/lib/api-key-cache'
import { broadcastToUsers } from '@/lib/sse-utils'
import { ASTRID_EMAIL } from '@/lib/astrid-agent'
import { getTokenForUser, getBaseUrl } from '@/lib/astrid-api-client'

// ─── Single Tool: API Request ─────────────────────────────────────

const TOOLS_CLAUDE = [
  {
    name: 'api_request',
    description: 'Make an authenticated HTTP request to the Astrid API. Use this for ALL actions: creating tasks, updating tasks, listing tasks, creating lists, adding comments, etc. See the API documentation in your system prompt for available endpoints.',
    input_schema: {
      type: 'object' as const,
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'HTTP method' },
        path: { type: 'string', description: 'API path starting with /api/v1/ (e.g. /api/v1/tasks, /api/v1/lists)' },
        body: { type: 'object', description: 'Request body for POST/PUT requests. Omit for GET/DELETE.' },
        query: { type: 'object', description: 'Query parameters as key-value pairs for GET requests.' },
      },
      required: ['method', 'path'],
    },
  },
]

const TOOLS_OPENAI = TOOLS_CLAUDE.map(t => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}))

// ─── Tool Execution ───────────────────────────────────────────────

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  context: { userId: string }
): Promise<string> {
  if (toolName !== 'api_request') {
    return JSON.stringify({ error: `Unknown tool: ${toolName}` })
  }

  try {
    const method = input.method as string
    const path = input.path as string
    const body = input.body as Record<string, unknown> | undefined
    const query = input.query as Record<string, string> | undefined

    // Security: only allow /api/v1/ paths
    if (!path.startsWith('/api/v1/')) {
      return JSON.stringify({ error: 'Only /api/v1/ endpoints are allowed' })
    }

    const token = await getTokenForUser(context.userId)
    const baseUrl = getBaseUrl()
    let url = `${baseUrl}${path}`

    if (query && Object.keys(query).length > 0) {
      const params = new URLSearchParams(query)
      url += `?${params}`
    }

    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body && ['POST', 'PUT', 'PATCH'].includes(method) ? { body: JSON.stringify(body) } : {}),
    })

    const responseBody = await res.json().catch(() => ({}))

    // After mutations, broadcast to user so their UI updates
    if (['POST', 'PUT', 'DELETE'].includes(method) && res.ok) {
      if (path.match(/\/api\/v1\/tasks/) && responseBody.task) {
        const eventType = path.includes('/comments') ? 'comment_created'
          : method === 'POST' ? 'task_created'
          : method === 'DELETE' ? 'task_deleted'
          : responseBody.task.completed ? 'task_completed'
          : 'task_updated'
        broadcastToUsers([context.userId], {
          type: eventType,
          timestamp: new Date().toISOString(),
          data: { taskId: responseBody.task.id, task: responseBody.task },
        }).catch(() => {})
      }
      if (path.match(/\/api\/v1\/lists/) && responseBody.list && method === 'POST') {
        broadcastToUsers([context.userId], {
          type: 'list_created',
          timestamp: new Date().toISOString(),
          data: { list: responseBody.list },
        }).catch(() => {})
      }
    }

    if (!res.ok) {
      return JSON.stringify({ error: responseBody.error || `HTTP ${res.status}`, status: res.status })
    }

    return JSON.stringify(responseBody)
  } catch (error) {
    console.error('[Astrid] api_request failed:', error)
    return JSON.stringify({ error: error instanceof Error ? error.message : 'Request failed' })
  }
}

// ─── System Prompt with API Docs ──────────────────────────────────

function buildSystemPrompt(context: {
  userName: string
  userEmail: string
  userId: string
  listName?: string
  listId?: string | null
  taskContext?: string
}): string {
  return `You are Astrid, a helpful task management assistant. You help ${context.userName} (${context.userEmail}) manage their tasks and lists.

## API Access
You have a tool called \`api_request\` that makes authenticated HTTP requests to the Astrid API. Use it for ALL actions.

### API Endpoints

**Tasks:**
- \`GET /api/v1/tasks\` — List tasks. Query params: \`listId\`, \`completed\` (true/false), \`limit\`, \`offset\`, \`priority\`, \`assigneeId\`
- \`POST /api/v1/tasks\` — Create task. Body: \`{ title, description?, listIds?: [id], assigneeId?, priority?: 0-3, dueDateTime?: ISO8601 }\`
- \`GET /api/v1/tasks/:id\` — Get task details
- \`PUT /api/v1/tasks/:id\` — Update task. Body: any subset of \`{ title, description, priority, dueDateTime, assigneeId, completed }\`
- \`DELETE /api/v1/tasks/:id\` — Delete task

**Task Comments:**
- \`GET /api/v1/tasks/:id/comments\` — List comments
- \`POST /api/v1/tasks/:id/comments\` — Add comment. Body: \`{ content, type?: "TEXT"|"MARKDOWN" }\`

**Lists:**
- \`GET /api/v1/lists\` — List all accessible lists
- \`POST /api/v1/lists\` — Create list. Body: \`{ name, description? }\`
- \`GET /api/v1/lists/:id\` — Get list details
- \`PUT /api/v1/lists/:id\` — Update list. Body: \`{ name?, description? }\`

**Key fields:**
- Priority: 0=none, 1=low, 2=medium, 3=high
- dueDateTime: ISO 8601 format (e.g. "2026-03-30T17:00:00Z")
- assigneeId: User ID string. When the user says "assign to me", use their ID: "${context.userId}"

## Current context
${context.listName ? `- List: ${context.listName} (ID: ${context.listId})` : '- View: My Tasks'}
- User: ${context.userName} (${context.userEmail}, ID: ${context.userId})
${context.taskContext ? `\n## Current tasks\n${context.taskContext}` : ''}

## Response style
- Be concise and action-oriented
- When asked to do something, USE the api_request tool — don't just say you did it
- Keep responses under 2-3 sentences
- Use markdown sparingly
- After taking an action, briefly confirm what you did`
}

// ─── AI Provider Calls ────────────────────────────────────────────

async function callClaudeWithTools(
  apiKey: string, systemPrompt: string, userMessage: string,
  context: { userId: string }, model?: string
): Promise<string> {
  let messages: Array<{ role: string; content: unknown }> = [
    { role: 'user', content: userMessage },
  ]

  for (let i = 0; i < 5; i++) {
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

    const toolUseBlocks = (data.content || []).filter((b: { type: string }) => b.type === 'tool_use')
    const textBlocks = (data.content || []).filter((b: { type: string }) => b.type === 'text')

    if (toolUseBlocks.length === 0) {
      return textBlocks.map((b: { text: string }) => b.text).join('\n') || 'Done!'
    }

    messages.push({ role: 'assistant', content: data.content })

    const toolResults = []
    for (const toolBlock of toolUseBlocks) {
      const result = await executeTool(toolBlock.name, toolBlock.input, context)
      toolResults.push({ type: 'tool_result', tool_use_id: toolBlock.id, content: result })
    }
    messages.push({ role: 'user', content: toolResults })

    if (data.stop_reason === 'end_turn') {
      return textBlocks.map((b: { text: string }) => b.text).join('\n') || 'Done!'
    }
  }

  return 'I completed the actions requested.'
}

async function callOpenAIWithTools(
  apiKey: string, systemPrompt: string, userMessage: string,
  context: { userId: string }, model?: string
): Promise<string> {
  let messages: Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  for (let i = 0; i < 5; i++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || 'gpt-4o', max_tokens: 1024, tools: TOOLS_OPENAI, messages }),
    })
    if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`)
    const data = await res.json()

    const msg = data.choices?.[0]?.message
    if (!msg?.tool_calls?.length) {
      return msg?.content || 'Done!'
    }

    messages.push({ role: 'assistant', content: msg.content, tool_calls: msg.tool_calls })
    for (const tc of msg.tool_calls) {
      const args = JSON.parse(tc.function.arguments)
      const result = await executeTool(tc.function.name, args, context)
      messages.push({ role: 'tool', content: result, tool_call_id: tc.id })
    }
  }

  return 'I completed the actions requested.'
}

async function callGeminiWithTools(
  apiKey: string, systemPrompt: string, userMessage: string,
  context: { userId: string }, model?: string
): Promise<string> {
  const modelId = model || 'gemini-2.0-flash'

  // Gemini function declaration format
  const tools = [{
    functionDeclarations: [{
      name: 'api_request',
      description: 'Make an authenticated HTTP request to the Astrid API. Use this for ALL actions.',
      parameters: {
        type: 'OBJECT',
        properties: {
          method: { type: 'STRING', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'HTTP method' },
          path: { type: 'STRING', description: 'API path starting with /api/v1/' },
          body: { type: 'OBJECT', description: 'Request body for POST/PUT', properties: {} },
          query: { type: 'OBJECT', description: 'Query parameters for GET', properties: {} },
        },
        required: ['method', 'path'],
      },
    }],
  }]

  let contents: Array<{ role: string; parts: unknown[] }> = [
    { role: 'user', parts: [{ text: userMessage }] },
  ]

  for (let i = 0; i < 5; i++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools,
        generationConfig: { maxOutputTokens: 1024 },
      }),
    })
    if (!res.ok) throw new Error(`Gemini API error: ${res.status}`)
    const data = await res.json()

    const candidate = data.candidates?.[0]
    const parts = candidate?.content?.parts || []

    // Check for function calls
    const functionCalls = parts.filter((p: { functionCall?: unknown }) => p.functionCall)
    const textParts = parts.filter((p: { text?: string }) => p.text)

    if (functionCalls.length === 0) {
      return textParts.map((p: { text: string }) => p.text).join('\n') || 'Done!'
    }

    // Add assistant response to conversation
    contents.push({ role: 'model', parts })

    // Execute function calls and add results
    const functionResponses = []
    for (const part of functionCalls) {
      const fc = part.functionCall
      const result = await executeTool(fc.name, fc.args || {}, context)
      functionResponses.push({
        functionResponse: {
          name: fc.name,
          response: JSON.parse(result),
        },
      })
    }
    contents.push({ role: 'user', parts: functionResponses })
  }

  return 'I completed the actions requested.'
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
      select: { id: true, title: true, dueDateTime: true, priority: true, assignee: { select: { name: true, email: true } } },
      orderBy: [{ dueDateTime: 'asc' }, { priority: 'desc' }],
      take: 15,
    })

    if (tasks.length === 0) return ''
    return tasks.map(t => {
      const due = t.dueDateTime ? ` (due: ${t.dueDateTime.toLocaleDateString()})` : ''
      const priority = t.priority ? ` [P${t.priority}]` : ''
      const assignee = t.assignee ? ` → ${t.assignee.name || t.assignee.email}` : ''
      return `- [${t.id}] ${t.title}${priority}${due}${assignee}`
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
      userName, userEmail, userId,
      listName: listName || undefined, listId,
      taskContext,
    })

    const cleanMessage = userMessage
      .replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
      .replace(/#\[([^\]]+)\]\([^)]+\)/g, '#$1')
      .replace(/!\[([^\]]+)\]\([^)]+\)/g, '!$1')

    const toolContext = { userId }

    let response: string
    switch (service) {
      case 'claude':
        response = await callClaudeWithTools(apiKey, systemPrompt, cleanMessage, toolContext, model)
        break
      case 'openai':
        response = await callOpenAIWithTools(apiKey, systemPrompt, cleanMessage, toolContext, model)
        break
      case 'gemini':
        response = await callGeminiWithTools(apiKey, systemPrompt, cleanMessage, toolContext, model)
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
      userName, userEmail, userId,
      listName: listId ? (await prisma.taskList.findUnique({ where: { id: listId }, select: { name: true } }))?.name || undefined : undefined,
      listId,
      taskContext,
    }) + `\n\n## Current task\nTitle: ${taskTitle}\nTask ID: ${taskId}\n\nThe user commented on this task. Respond helpfully. If you need to take action, use the api_request tool.`

    const cleanComment = commentContent
      .replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
      .replace(/#\[([^\]]+)\]\([^)]+\)/g, '#$1')
      .replace(/!\[([^\]]+)\]\([^)]+\)/g, '!$1')

    const toolContext = { userId }

    let response: string
    switch (service) {
      case 'claude':
        response = await callClaudeWithTools(apiKey, systemPrompt, cleanComment, toolContext, model)
        break
      case 'openai':
        response = await callOpenAIWithTools(apiKey, systemPrompt, cleanComment, toolContext, model)
        break
      case 'gemini':
        response = await callGeminiWithTools(apiKey, systemPrompt, cleanComment, toolContext, model)
        break
      default:
        return
    }

    // Post as a comment from Astrid using the API
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
