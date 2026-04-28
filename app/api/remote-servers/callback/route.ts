/**
 * Callback endpoint for Claude Code Remote servers
 *
 * Receives status updates from user's self-hosted Claude Code Remote servers.
 * These callbacks are signed with HMAC-SHA256 using the user's webhook secret.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifyWebhookSignature, extractWebhookHeaders } from '@/lib/webhook-signature'
import { decryptField } from '@/lib/field-encryption'
import { createAIAgentComment } from '@/lib/ai-agent-comment-service'
import { createLogger } from '@/lib/logger'

const log = createLogger('remote-servers.callback')


// Callback payload schema
const CallbackPayloadSchema = z.object({
  event: z.enum([
    'session.started',
    'session.completed',
    'session.waiting_input',
    'session.error',
    'session.progress'
  ]),
  timestamp: z.string(),
  sessionId: z.string(),
  taskId: z.string(),
  data: z.object({
    message: z.string().optional(),
    summary: z.string().optional(),
    files: z.array(z.string()).optional(),
    prUrl: z.string().optional(),
    error: z.string().optional(),
    question: z.string().optional(),
    options: z.array(z.string()).optional(),
    changes: z.array(z.string()).optional(),
    diff: z.string().optional() // Git diff of changes
  }).optional()
})

type CallbackPayload = z.infer<typeof CallbackPayloadSchema>

/**
 * POST /api/remote-servers/callback
 *
 * Receives callbacks from Claude Code Remote servers
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Extract signature headers
    const webhookHeaders = extractWebhookHeaders(request.headers)

    if (!webhookHeaders) {
      return NextResponse.json(
        { error: 'Missing signature headers (X-Astrid-Signature, X-Astrid-Timestamp)' },
        { status: 401 }
      )
    }

    const { signature, timestamp, event: headerEvent } = webhookHeaders

    // 2. Get raw body for signature verification
    const rawBody = await request.text()

    // 3. Parse and validate payload
    let payload: CallbackPayload
    try {
      payload = CallbackPayloadSchema.parse(JSON.parse(rawBody))
    } catch (parseError) {
      if (parseError instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid payload', details: parseError.errors },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { error: 'Malformed JSON payload' },
        { status: 400 }
      )
    }

    // 4. Get task and verify user's webhook secret
    const task = await prisma.task.findUnique({
      where: { id: payload.taskId },
      include: {
        creator: {
          include: {
            webhookConfig: true
          }
        },
        assignee: true,
        aiAgent: true
      }
    })

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      )
    }

    // 5. Verify signature - try user config first, then fall back to env secret
    let secret: string | null = null
    let secretSource = 'none'

    // First try user's webhook config
    if (task.creator?.webhookConfig) {
      secret = decryptField(task.creator.webhookConfig.webhookSecret)
      secretSource = 'user_config'
    }

    // Fall back to env-based secret (for env-configured Claude Remote setup)
    if (!secret) {
      secret = process.env.CLAUDE_REMOTE_WEBHOOK_SECRET || null
      secretSource = 'env'
    }

    if (!secret) {
      log.error(`❌ No webhook secret available (user config: ${!!task.creator?.webhookConfig}, env: ${!!process.env.CLAUDE_REMOTE_WEBHOOK_SECRET})`)
      return NextResponse.json(
        { error: 'No webhook secret configuration found' },
        { status: 404 }
      )
    }

    const verification = verifyWebhookSignature(rawBody, signature, secret, timestamp)

    if (!verification.valid) {
      // If user config failed, try env secret as fallback
      if (secretSource === 'user_config' && process.env.CLAUDE_REMOTE_WEBHOOK_SECRET) {
        const envVerification = verifyWebhookSignature(
          rawBody,
          signature,
          process.env.CLAUDE_REMOTE_WEBHOOK_SECRET,
          timestamp
        )
        if (envVerification.valid) {
          log.info(`✅ Callback signature verified via env secret (user config secret didn't match)`)
          // Continue with processing
        } else {
          log.error(`❌ Webhook signature verification failed with both user config and env secret: ${verification.error}`)
          return NextResponse.json(
            { error: verification.error || 'Invalid signature' },
            { status: 401 }
          )
        }
      } else {
        log.error(`❌ Webhook signature verification failed (source: ${secretSource}): ${verification.error}`)
        return NextResponse.json(
          { error: verification.error || 'Invalid signature' },
          { status: 401 }
        )
      }
    } else {
      log.info(`✅ Callback signature verified via ${secretSource}`)
    }

    // 6. Process the event
    log.info(`📥 Received callback from Claude Code Remote: ${payload.event} for task ${payload.taskId}`)
    await processRemoteServerEvent(task, payload)

    return NextResponse.json({
      success: true,
      event: payload.event,
      taskId: payload.taskId,
      sessionId: payload.sessionId,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    log.error({ err: error }, '❌ Remote server callback error:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Process events from Claude Code Remote server
 */
async function processRemoteServerEvent(
  task: Awaited<ReturnType<typeof prisma.task.findUnique>> & { creator: { webhookConfig: any } | null },
  payload: CallbackPayload
) {
  if (!task) return

  const { event, data, sessionId } = payload

  switch (event) {
    case 'session.started':
      // Add a starting comment (createAIAgentComment resolves AI agent from task)
      await createAIAgentComment(
        task.id,
        formatStartedComment(sessionId, data)
      )
      break

    case 'session.completed':
      // Add completion comment
      await createAIAgentComment(
        task.id,
        formatCompletionComment(data)
      )
      break

    case 'session.waiting_input':
      // Add question comment - user can reply through Astrid
      await createAIAgentComment(
        task.id,
        formatWaitingComment(data)
      )
      break

    case 'session.progress':
      // Add progress update comment
      if (data?.message) {
        await createAIAgentComment(
          task.id,
          formatProgressComment(data)
        )
      }
      break

    case 'session.error':
      // Add error comment
      await createAIAgentComment(
        task.id,
        formatErrorComment(data)
      )
      break
  }
}

// Comment formatting helpers
function formatStartedComment(sessionId: string, data?: CallbackPayload['data']): string {
  return `## 🚀 Started Working

Session ID: \`${sessionId}\`

${data?.message || 'Beginning work on this task...'}

---
*Powered by Claude Code Remote*`
}

function formatCompletionComment(data?: CallbackPayload['data']): string {
  const lines = ['## ✅ Task Completed']

  if (data?.summary) {
    // Clean up summary - remove any duplicate PR URL lines
    const cleanedSummary = data.summary
      .replace(/^##\s*PR URL\s*\n/gim, '')
      .replace(/^https:\/\/github\.com\/[^\n]+\n/gm, '')
      .trim()
    if (cleanedSummary) {
      lines.push('', cleanedSummary)
    }
  }

  // Files modified section
  if (data?.files && data.files.length > 0) {
    // Filter out non-substantive files
    const substantiveFiles = data.files.filter(f =>
      !f.includes('package-lock.json') &&
      !f.includes('.lock') &&
      !f.includes('node_modules')
    )
    if (substantiveFiles.length > 0) {
      lines.push('', '### Files Modified')
      lines.push(substantiveFiles.map(f => `\`${f}\``).join(', '))
    }
  }

  // PR and Preview URLs in one section
  if (data?.prUrl) {
    lines.push('', '### Links')
    lines.push(`- **Pull Request:** ${data.prUrl}`)

    // Generate Vercel preview URL from PR URL
    const previewUrl = extractPreviewUrl(data.prUrl)
    if (previewUrl) {
      lines.push(`- **Preview:** ${previewUrl}`)
    }
  }

  // Include git diff preview if available
  if (data?.diff) {
    // Filter out package-lock.json changes from diff
    const cleanedDiff = cleanDiff(data.diff)
    if (cleanedDiff.trim()) {
      lines.push('', '### Code Changes Preview')
      lines.push('```diff')
      lines.push(cleanedDiff)
      lines.push('```')
    }
  }

  lines.push('', '---', '*Reply to this comment or comment "ship it" to merge and deploy.*')

  return lines.join('\n')
}

/**
 * Extract Vercel preview URL from PR URL
 * Pattern: https://astrid-res-www-git-{branch}-graceful-tools.vercel.app
 */
function extractPreviewUrl(prUrl: string): string | null {
  try {
    // Extract PR number from URL: https://github.com/owner/repo/pull/123
    const prMatch = prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/)
    if (!prMatch) return null

    // For now, we'll use the PR number to construct a branch-based URL
    // Vercel creates previews like: https://PROJECT-git-BRANCH-TEAM.vercel.app
    // We'll construct the expected pattern
    const prNumber = prMatch[3]

    // Common branch patterns for PRs: task-{id}, fix-{something}, etc.
    // The actual preview URL depends on the branch name used
    // For tasks, we typically use: task-{taskId}
    // We'll return a generic pattern that Vercel uses
    return `https://astrid-res-www-git-pr${prNumber}-graceful-tools.vercel.app`
  } catch {
    return null
  }
}

/**
 * Clean diff to remove package-lock.json and other non-substantive changes
 */
function cleanDiff(diff: string): string {
  const lines = diff.split('\n')
  const cleanedLines: string[] = []
  let skipUntilNextFile = false

  for (const line of lines) {
    // Check if this is a new file header
    if (line.startsWith('diff --git')) {
      // Check if it's a file we want to skip
      skipUntilNextFile = line.includes('package-lock.json') ||
                          line.includes('.lock') ||
                          line.includes('node_modules/')
    }

    if (!skipUntilNextFile) {
      cleanedLines.push(line)
    }
  }

  return cleanedLines.join('\n')
}

function formatWaitingComment(data?: CallbackPayload['data']): string {
  const lines = ['## 🤔 Need Your Input']

  if (data?.question) {
    lines.push('', data.question)
  } else if (data?.message) {
    lines.push('', data.message)
  }

  if (data?.options && data.options.length > 0) {
    lines.push('', '### Options')
    data.options.forEach((opt, i) => lines.push(`${i + 1}. ${opt}`))
  }

  // Show files modified so far
  if (data?.files && data.files.length > 0) {
    lines.push('', '### Files Modified')
    lines.push(data.files.map(f => `\`${f}\``).join(', '))
  }

  // Show PR if created
  if (data?.prUrl) {
    lines.push('', `**Pull Request:** ${data.prUrl}`)
  }

  // Include git diff preview if available
  if (data?.diff) {
    lines.push('', '### Code Changes Preview')
    lines.push('```diff')
    lines.push(data.diff)
    lines.push('```')
  }

  lines.push('', '---', '*Reply with your choice or provide more context.*')

  return lines.join('\n')
}

function formatProgressComment(data?: CallbackPayload['data']): string {
  return `## 📊 Progress Update

${data?.message || 'Working on task...'}

---
*Powered by Claude Code Remote*`
}

function formatErrorComment(data?: CallbackPayload['data']): string {
  const lines = ['## ❌ Error Encountered']

  if (data?.error) {
    lines.push('', data.error)
  }

  if (data?.message) {
    lines.push('', '### Context', '', data.message)
  }

  lines.push('', '---', '*Reply with guidance or "retry" to try again.*')

  return lines.join('\n')
}

/**
 * GET /api/remote-servers/callback
 *
 * Returns documentation for the callback endpoint
 */
export async function GET() {
  return NextResponse.json({
    service: 'Claude Code Remote Callback',
    description: 'Receives status updates from self-hosted Claude Code Remote servers',
    endpoint: '/api/remote-servers/callback',
    authentication: 'HMAC-SHA256 signature via X-Astrid-Signature header',
    headers: {
      'X-Astrid-Signature': 'sha256=<hmac-signature>',
      'X-Astrid-Timestamp': '<unix-timestamp-ms>',
      'Content-Type': 'application/json'
    },
    supportedEvents: [
      'session.started',
      'session.completed',
      'session.waiting_input',
      'session.progress',
      'session.error'
    ],
    payloadSchema: {
      event: 'string (one of supportedEvents)',
      timestamp: 'string (ISO 8601)',
      sessionId: 'string (Claude Code session ID)',
      taskId: 'string (Astrid task ID)',
      data: {
        message: 'string (optional)',
        summary: 'string (optional)',
        files: 'string[] (optional)',
        prUrl: 'string (optional)',
        error: 'string (optional)',
        question: 'string (optional)',
        options: 'string[] (optional)',
        changes: 'string[] (optional)'
      }
    }
  })
}
