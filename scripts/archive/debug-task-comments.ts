#!/usr/bin/env npx tsx

/**
 * Debug script to see task comments and understand why filtering is happening
 */

import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const CONFIG = {
  astridApiUrl: process.env.ASTRID_API_URL || 'https://astrid.cc',
  astridClientId: process.env.ASTRID_OAUTH_CLIENT_ID,
  astridClientSecret: process.env.ASTRID_OAUTH_CLIENT_SECRET,
}

let cachedToken: string | null = null

async function getOAuthToken(): Promise<string> {
  if (cachedToken) return cachedToken

  const response = await fetch(`${CONFIG.astridApiUrl}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: CONFIG.astridClientId,
      client_secret: CONFIG.astridClientSecret,
    }),
  })

  if (!response.ok) {
    throw new Error(`OAuth failed: ${await response.text()}`)
  }

  const data = await response.json()
  cachedToken = data.access_token
  return cachedToken!
}

async function astridFetch(path: string) {
  const token = await getOAuthToken()
  const response = await fetch(`${CONFIG.astridApiUrl}${path}`, {
    headers: {
      'X-OAuth-Token': token,
      'Content-Type': 'application/json',
    },
  })
  if (!response.ok) {
    throw new Error(`API error: ${await response.text()}`)
  }
  return response.json()
}

// Check if a comment indicates the task was completed
function isCompletionMarker(content: string): boolean {
  if (content.includes('Pull Request Created') || (content.includes('github.com') && content.includes('/pull/'))) {
    return true
  }
  if (content.includes('Implementation Complete') || content.includes('Implementation Failed')) {
    return true
  }
  // Check for ship it deployment completion (prevents re-triggering after deployment)
  if (content.includes('Deployment Complete') || content.includes('Ship It Deployment Started')) {
    return true
  }
  return false
}

// Simple approval keywords
const APPROVAL_KEYWORDS = [
  'approve', 'approved', 'yes', 'y', 'lgtm', 'looks good',
  'merge', 'ship it', 'ship', 'thanks', 'thank you', 'great',
  'perfect', 'good', 'ok', 'okay', 'done', 'nice'
]

function isApprovalComment(content: string): boolean {
  const trimmed = content.toLowerCase().trim()
  if (APPROVAL_KEYWORDS.includes(trimmed)) return true
  if (trimmed.length < 20 && APPROVAL_KEYWORDS.some(k => trimmed.includes(k))) return true
  return false
}

// System comment patterns
const SYSTEM_COMMENT_PATTERNS = [
  /^.+ (reassigned|assigned|changed priority|marked this|moved to|removed from)/i,
  /^.+ (created|deleted|updated) (this task|a subtask)/i,
]

function isSystemComment(content: string): boolean {
  return SYSTEM_COMMENT_PATTERNS.some(pattern => pattern.test(content))
}

async function debugTask(taskId: string) {
  console.log(`\n🔍 Debugging task: ${taskId}\n`)

  // Get task with comments
  const data = await astridFetch(`/api/v1/tasks/${taskId}?includeComments=true`)
  const task = data.task || data

  console.log(`📋 Task: ${task.title}`)
  console.log(`   Assignee: ${task.assignee?.email || 'none'} (isAIAgent: ${task.assignee?.isAIAgent})`)
  console.log(`   Completed: ${task.completed}`)
  console.log(`   Comments: ${task.comments?.length || 0}`)

  if (!task.comments?.length) {
    console.log('\n   ❌ No comments found')
    return
  }

  // Sort comments by createdAt ascending (oldest first)
  const sortedComments = [...task.comments].sort(
    (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )

  console.log('\n📝 Comments (oldest to newest):')
  console.log('=' .repeat(80))

  let lastCompletionIndex = -1
  sortedComments.forEach((comment: any, i: number) => {
    const isCompletion = isCompletionMarker(comment.content)
    const isApproval = isApprovalComment(comment.content)
    const isAI = comment.author?.isAIAgent

    if (isCompletion) {
      lastCompletionIndex = i
    }

    const flags = [
      isCompletion ? '🏁 COMPLETION' : '',
      isApproval ? '👍 APPROVAL' : '',
      isAI ? '🤖 AI' : '👤 USER',
    ].filter(Boolean).join(' | ')

    console.log(`\n[${i}] ${new Date(comment.createdAt).toISOString()}`)
    console.log(`    Author: ${comment.author?.email || 'unknown'} (isAIAgent: ${comment.author?.isAIAgent})`)
    console.log(`    Flags: ${flags}`)
    console.log(`    Content: ${comment.content.substring(0, 200)}${comment.content.length > 200 ? '...' : ''}`)
  })

  console.log('\n' + '=' .repeat(80))
  console.log('\n📊 Analysis (using updated logic):')
  console.log(`   Last completion marker at index: ${lastCompletionIndex}`)

  if (lastCompletionIndex >= 0) {
    const commentsAfterCompletion = sortedComments.slice(lastCompletionIndex + 1)
    console.log(`   Comments after completion: ${commentsAfterCompletion.length}`)

    for (const comment of commentsAfterCompletion) {
      // Skip system comments (no author or matches system pattern)
      if (!comment.author?.id || !comment.author?.email) {
        console.log(`   ↳ Skip: System comment (no author): "${comment.content.substring(0, 40)}..."`)
        continue
      }

      if (isSystemComment(comment.content)) {
        console.log(`   ↳ Skip: System pattern: "${comment.content.substring(0, 40)}..."`)
        continue
      }

      // Skip AI agent comments
      if (comment.author.isAIAgent) {
        console.log(`   ↳ Skip: AI agent (${comment.author.email}): "${comment.content.substring(0, 40)}..."`)
        continue
      }

      // This is a real user comment
      if (isApprovalComment(comment.content)) {
        console.log(`   ↳ Skip: User approval: "${comment.content.substring(0, 40)}..."`)
        continue
      }

      // Found real user feedback!
      console.log(`\n   ✅ SHOULD REPROCESS - User feedback found:`)
      console.log(`      "${comment.content.substring(0, 100)}..."`)
      console.log(`      Author: ${comment.author.email} (isAIAgent: ${comment.author.isAIAgent})`)
      return
    }

    console.log(`\n   ❌ WILL SKIP - No user feedback after completion`)
  } else {
    console.log(`   ✅ SHOULD PROCESS - No completion markers found`)
  }
}

// Get task ID from args or use default
const taskId = process.argv[2]
if (!taskId) {
  console.error('Usage: npx tsx scripts/debug-task-comments.ts <taskId>')
  process.exit(1)
}

debugTask(taskId).catch(console.error)
