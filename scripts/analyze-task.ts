#!/usr/bin/env npx tsx

/**
 * Comprehensive task analysis for development workflow
 * Shows full task details, comments, and PR analysis
 */

import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

interface TaskComment {
  id: string
  content: string
  author: {
    name: string
    email: string
    isAIAgent?: boolean
  }
  createdAt: string
  updatedAt?: string
}

interface TaskDetails {
  id: string
  title: string
  description: string
  priority: number
  dueDateTime: string | null
  completed: boolean
  comments: TaskComment[]
  assignee?: {
    name: string
    email: string
    isAIAgent?: boolean
  }
  creator?: {
    name: string
    email: string
  }
  lists: Array<{ id: string; name: string }>
  createdAt: string
  updatedAt: string
}

/**
 * Extract and analyze PR information from comments
 */
function analyzePRReferences(comments: TaskComment[]) {
  const prInfo = {
    prUrls: [] as string[],
    prNumbers: [] as number[],
    prStatuses: [] as string[],
    mostRecentPR: null as string | null
  }

  comments.forEach(comment => {
    // Extract PR URLs
    const urlPattern = /https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/g
    let match
    while ((match = urlPattern.exec(comment.content)) !== null) {
      prInfo.prUrls.push(match[0])
      prInfo.prNumbers.push(parseInt(match[3]))
    }

    // Look for PR status indicators
    if (comment.content.toLowerCase().includes('pr created') ||
        comment.content.toLowerCase().includes('pull request created')) {
      prInfo.prStatuses.push('created')
    }
    if (comment.content.toLowerCase().includes('merged')) {
      prInfo.prStatuses.push('merged')
    }
    if (comment.content.toLowerCase().includes('closed') ||
        comment.content.toLowerCase().includes('rejected')) {
      prInfo.prStatuses.push('closed')
    }
  })

  // Get most recent PR
  if (prInfo.prUrls.length > 0) {
    prInfo.mostRecentPR = prInfo.prUrls[prInfo.prUrls.length - 1]
  }

  return prInfo
}

/**
 * Extract implementation plans from comments
 */
function extractImplementationPlans(comments: TaskComment[]) {
  const plans = comments
    .filter(comment => {
      const content = comment.content.toLowerCase()
      return content.includes('fix plan:') ||
             content.includes('implementation plan') ||
             content.includes('approach:') ||
             content.includes('plan created')
    })
    .map(comment => ({
      author: comment.author?.name || 'Unknown',
      isAIAgent: comment.author?.isAIAgent || false,
      content: comment.content,
      createdAt: comment.createdAt
    }))

  return plans
}

/**
 * Extract testing instructions from comments
 */
function extractTestingInstructions(comments: TaskComment[]) {
  const instructions = comments
    .filter(comment => {
      const content = comment.content.toLowerCase()
      return content.includes('testing instructions') ||
             content.includes('test plan') ||
             content.includes('how to test') ||
             content.includes('ready for testing')
    })
    .map(comment => ({
      author: comment.author?.name || 'Unknown',
      content: comment.content,
      createdAt: comment.createdAt
    }))

  return instructions
}

async function analyzeTask(taskId: string) {
  console.log(`\n🔍 COMPREHENSIVE TASK ANALYSIS\n${'='.repeat(60)}\n`)

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error('❌ OAuth credentials not found in .env.local')
    console.error('   Required: ASTRID_OAUTH_CLIENT_ID and ASTRID_OAUTH_CLIENT_SECRET')
    return
  }

  try {
    // Step 1: Obtain OAuth access token
    console.log('🔐 Obtaining OAuth access token...')
    const tokenResponse = await fetch('https://astrid.cc/api/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      })
    })

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json()
      console.error('❌ Failed to obtain access token:', error)
      return
    }

    const { access_token } = await tokenResponse.json()

    // Step 2: Fetch task details with comments
    const response = await fetch(`https://astrid.cc/api/v1/tasks/${taskId}?includeComments=true`, {
      method: 'GET',
      headers: {
        'X-OAuth-Token': access_token,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch task: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const task: TaskDetails = data.task || data

    // ========================================
    // BASIC TASK INFO
    // ========================================
    console.log('📋 TASK OVERVIEW')
    console.log('─'.repeat(60))
    console.log(`Title: ${task.title}`)
    console.log(`ID: ${task.id}`)
    console.log(`Priority: ${'★'.repeat(task.priority)} (${task.priority}/3)`)
    console.log(`Status: ${task.completed ? '✅ Completed' : '⏳ Incomplete'}`)
    console.log(`Created: ${new Date(task.createdAt).toLocaleString()}`)
    console.log(`Updated: ${new Date(task.updatedAt).toLocaleString()}`)

    if (task.creator) {
      console.log(`Creator: ${task.creator.name} (${task.creator.email})`)
    }

    if (task.assignee) {
      const assigneeType = task.assignee.isAIAgent ? '🤖 AI Agent' : '👤 Human'
      console.log(`Assignee: ${assigneeType} - ${task.assignee.name} (${task.assignee.email})`)
    }

    if (task.dueDateTime) {
      console.log(`Due Date: ${new Date(task.dueDateTime).toLocaleString()}`)
    }

    console.log(`Lists: ${task.lists.map(l => l.name).join(', ')}`)

    // ========================================
    // DESCRIPTION
    // ========================================
    console.log('\n📝 DESCRIPTION')
    console.log('─'.repeat(60))
    console.log(task.description || 'No description provided')

    // ========================================
    // PR ANALYSIS
    // ========================================
    const prInfo = analyzePRReferences(task.comments)
    if (prInfo.prUrls.length > 0) {
      console.log('\n🔗 PULL REQUEST ANALYSIS')
      console.log('─'.repeat(60))
      console.log(`Found ${prInfo.prUrls.length} PR reference(s)`)

      prInfo.prUrls.forEach((url, idx) => {
        console.log(`\nPR #${idx + 1}: ${url}`)
      })

      if (prInfo.mostRecentPR) {
        console.log(`\n⚠️  MOST RECENT PR: ${prInfo.mostRecentPR}`)
        console.log('    → Review this PR during analysis phase!')
        console.log('    → Test the PR solution if it looks promising')
        console.log('    → Decide: Use PR as-is, improve it, or create new solution')
      }

      if (prInfo.prStatuses.length > 0) {
        console.log(`\nPR Status History: ${prInfo.prStatuses.join(' → ')}`)
      }
    }

    // ========================================
    // IMPLEMENTATION PLANS
    // ========================================
    const plans = extractImplementationPlans(task.comments)
    if (plans.length > 0) {
      console.log('\n📋 IMPLEMENTATION PLANS FOUND')
      console.log('─'.repeat(60))
      plans.forEach((plan, idx) => {
        const authorType = plan.isAIAgent ? '🤖 AI Agent' : '👤 Human'
        console.log(`\nPlan #${idx + 1} by ${authorType} ${plan.author}`)
        console.log(`Posted: ${new Date(plan.createdAt).toLocaleString()}`)
        console.log('─'.repeat(40))
        console.log(plan.content)
      })
    }

    // ========================================
    // TESTING INSTRUCTIONS
    // ========================================
    const testInstructions = extractTestingInstructions(task.comments)
    if (testInstructions.length > 0) {
      console.log('\n✅ TESTING INSTRUCTIONS FOUND')
      console.log('─'.repeat(60))
      testInstructions.forEach((instruction, idx) => {
        console.log(`\nInstructions #${idx + 1} by ${instruction.author}`)
        console.log(`Posted: ${new Date(instruction.createdAt).toLocaleString()}`)
        console.log('─'.repeat(40))
        console.log(instruction.content)
      })
    }

    // ========================================
    // ALL COMMENTS CHRONOLOGICALLY
    // ========================================
    if (task.comments.length > 0) {
      console.log(`\n💬 ALL COMMENTS (${task.comments.length} total)`)
      console.log('─'.repeat(60))

      // Sort by creation date
      const sortedComments = [...task.comments].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )

      sortedComments.forEach((comment, idx) => {
        const authorType = comment.author?.isAIAgent ? '🤖 AI Agent' : '👤 Human'
        const authorName = comment.author?.name || 'Unknown'
        console.log(`\n[${idx + 1}] ${authorType} ${authorName}`)
        console.log(`    Posted: ${new Date(comment.createdAt).toLocaleString()}`)
        console.log('─'.repeat(40))
        console.log(comment.content)
      })
    } else {
      console.log('\n💬 No comments yet')
    }

    // ========================================
    // ACTION ITEMS FOR ANALYSIS
    // ========================================
    console.log('\n\n🎯 ACTION ITEMS FOR ANALYSIS PHASE')
    console.log('='.repeat(60))

    const actionItems: string[] = []

    if (prInfo.prUrls.length > 0) {
      actionItems.push('✓ Review PR code changes')
      actionItems.push('✓ Test PR solution locally')
      actionItems.push('✓ Identify improvements or issues with PR')
      actionItems.push('✓ Decide: Use PR as-is, improve it, or create new solution')
    }

    if (plans.length > 0) {
      actionItems.push('✓ Review previous implementation plans')
      actionItems.push('✓ Consider what worked/didn\'t work in previous attempts')
    }

    if (testInstructions.length > 0) {
      actionItems.push('✓ Review existing test instructions')
      actionItems.push('✓ Ensure your solution includes these test cases')
    }

    actionItems.push('✓ Read ALL comments for context and blockers')
    actionItems.push('✓ Deep scan affected components with Grep/Glob')
    actionItems.push('✓ Identify ALL related code patterns')
    actionItems.push('✓ Map dependencies and side effects')
    actionItems.push('✓ Create comprehensive implementation plan')

    actionItems.forEach(item => console.log(`  ${item}`))

    console.log('\n' + '='.repeat(60))
    console.log('Ready to proceed with implementation? Confirm with user!\n')

  } catch (error) {
    console.error('❌ Error analyzing task:', error)
    if (error instanceof Error) {
      console.error('   ', error.message)
    }
  }
}

// Main execution
async function main() {
  const taskId = process.argv[2]

  if (!taskId) {
    console.error('❌ Usage: npx tsx scripts/analyze-task.ts <taskId>')
    console.error('   Example: npx tsx scripts/analyze-task.ts 4c65c10a-dff2-4d38-8ff0-2293781d377a')
    process.exit(1)
  }

  await analyzeTask(taskId)
}

if (require.main === module) {
  main().catch(console.error)
}

export { analyzeTask }
