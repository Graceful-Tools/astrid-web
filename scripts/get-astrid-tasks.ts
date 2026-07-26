#!/usr/bin/env npx tsx

/**
 * Get uncompleted tasks from "Astrid Bugs & Polish" list
 * Includes comprehensive comment analysis for AI-assisted development
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
}

interface TaskWithComments {
  id: string
  title: string
  description: string
  priority: number
  dueDateTime: string | null
  completed: boolean
  comments: TaskComment[]
  assignee?: {
    name: string
    isAIAgent?: boolean
  }
}

/**
 * Analyze task comments to extract useful information
 */
function analyzeTaskComments(task: TaskWithComments) {
  const analysis = {
    hasAIAgentComments: false,
    hasPRReferences: false,
    hasImplementationPlan: false,
    hasTestingInstructions: false,
    prUrls: [] as string[],
    aiAgentSuggestions: [] as string[],
    recentComments: [] as TaskComment[]
  }

  // Get most recent comments (last 3)
  analysis.recentComments = task.comments
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3)

  task.comments.forEach(comment => {
    const content = comment.content.toLowerCase()

    // Check if from AI agent
    if (comment.author?.isAIAgent) {
      analysis.hasAIAgentComments = true
      analysis.aiAgentSuggestions.push(comment.content)
    }

    // Look for PR references
    const prPattern = /pull request|pr #\d+|github\.com\/.*\/pull\/\d+/i
    if (prPattern.test(comment.content)) {
      analysis.hasPRReferences = true

      // Extract PR URLs
      const urlPattern = /https?:\/\/github\.com\/[^\s]+\/pull\/\d+/g
      const urls = comment.content.match(urlPattern)
      if (urls) {
        analysis.prUrls.push(...urls)
      }
    }

    // Look for implementation plans
    if (content.includes('fix plan:') || content.includes('implementation plan') || content.includes('approach:')) {
      analysis.hasImplementationPlan = true
    }

    // Look for testing instructions
    if (content.includes('testing instructions') || content.includes('test plan') || content.includes('how to test')) {
      analysis.hasTestingInstructions = true
    }
  })

  return analysis
}

async function getAstridTasks(targetList?: 'web' | 'ios' | 'all') {
  const listType = targetList || process.argv[2] || 'all'

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  const webListId = process.env.ASTRID_OAUTH_LIST_ID
  const iosListId = process.env.ASTRID_IOS_LIST_ID

  if (!clientId || !clientSecret) {
    console.error('❌ OAuth credentials not found in .env.local')
    console.error('   Required: ASTRID_OAUTH_CLIENT_ID and ASTRID_OAUTH_CLIENT_SECRET')
    return
  }

  const lists: { id: string; name: string }[] = []

  if ((listType === 'web' || listType === 'all') && webListId) {
    lists.push({ id: webListId, name: 'Astrid Web To-do' })
  }
  if ((listType === 'ios' || listType === 'all') && iosListId) {
    lists.push({ id: iosListId, name: 'Astrid iOS To-do' })
  }

  if (lists.length === 0) {
    console.error('❌ No list IDs configured in .env.local')
    console.error('   Set ASTRID_OAUTH_LIST_ID for web or ASTRID_IOS_LIST_ID for iOS')
    return
  }

  console.log(`📋 Pulling tasks from ${lists.map(l => l.name).join(' and ')}...\n`)

  try {
    // Step 1: Obtain access token via OAuth
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
    console.log('✅ Access token obtained\n')

    // Step 2: Get tasks from each list
    for (const list of lists) {
      console.log(`\n${'='.repeat(60)}`)
      console.log(`🎯 ${list.name}`)
      console.log(`${'='.repeat(60)}`)

      const tasksResponse = await fetch(`https://astrid.cc/api/v1/tasks?listId=${list.id}&completed=false&includeComments=true`, {
        method: 'GET',
        headers: {
          'X-OAuth-Token': access_token,
          'Content-Type': 'application/json'
        }
      })

      if (!tasksResponse.ok) {
        const error = await tasksResponse.json()
        console.error(`❌ Failed to get tasks from ${list.name}:`, error)
        continue
      }

      const tasksData = await tasksResponse.json()
      const taskCount = tasksData.tasks?.length || 0
      console.log(`\n📝 Uncompleted tasks (${taskCount} total):\n`)

      if (taskCount === 0) {
        console.log('   No uncompleted tasks in this list.\n')
        continue
      }

      const tasksWithDetails = tasksData.tasks

      // Display tasks with enhanced information
      tasksWithDetails.forEach((task: any, index: number) => {
        const priority = '★'.repeat(task.priority)
        const dueDate = task.dueDateTime ? new Date(task.dueDateTime).toLocaleDateString() : 'No due date'
        const analysis = analyzeTaskComments(task)

        // Task header with priority indicators
        console.log(`${index + 1}. ${priority} ${task.title}`)
        console.log(`   ID: ${task.id}`)
        console.log(`   Priority: ${task.priority}/3 | Due: ${dueDate}`)

        // Assignee info
        if (task.assignee) {
          const assigneeType = task.assignee?.isAIAgent ? '🤖 AI Agent' : '👤 Human'
          console.log(`   Assigned to: ${assigneeType} - ${task.assignee.name}`)
        }

        // Description
        if (task.description) {
          const shortDesc = task.description.length > 100
            ? task.description.substring(0, 100) + '...'
            : task.description
          console.log(`   Description: ${shortDesc}`)
        }

        // Comment analysis insights
        if (task.comments && task.comments.length > 0) {
          console.log(`   💬 Comments: ${task.comments.length} total`)

          if (analysis.hasPRReferences) {
            console.log(`   🔗 Has Pull Request references`)
            analysis.prUrls.forEach(url => {
              console.log(`      → ${url}`)
            })
          }

          if (analysis.hasAIAgentComments) {
            console.log(`   🤖 Has AI Agent implementation suggestions`)
          }

          if (analysis.hasImplementationPlan) {
            console.log(`   📋 Has implementation plan in comments`)
          }

          if (analysis.hasTestingInstructions) {
            console.log(`   ✅ Has testing instructions`)
          }

          // Show recent comments
          if (analysis.recentComments.length > 0) {
            console.log(`   📝 Recent comments:`)
            analysis.recentComments.forEach(comment => {
              const authorType = comment.author?.isAIAgent ? '🤖' : '👤'
              const authorName = comment.author?.name || 'Unknown'
              const preview = comment.content.length > 60
                ? comment.content.substring(0, 60) + '...'
                : comment.content
              console.log(`      ${authorType} ${authorName}: ${preview}`)
            })
          }
        }

        console.log()
      })
    }

    console.log('\n🎯 Usage: npx tsx scripts/get-astrid-tasks.ts [web|ios|all]')
    console.log('📌 When you select a task, review ALL comments and PRs during analysis phase!')

  } catch (error) {
    console.error('❌ Error getting tasks:', error)
  }
}

if (require.main === module) {
  getAstridTasks().catch(console.error)
}

export { getAstridTasks }