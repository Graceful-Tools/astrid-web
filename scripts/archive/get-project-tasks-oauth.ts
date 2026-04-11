#!/usr/bin/env tsx

/**
 * Get Project Tasks using OAuth API
 *
 * Example script showing how to retrieve tasks from Astrid using OAuth 2.0
 * This replaces the legacy MCP-based task retrieval
 */

import dotenv from 'dotenv'
import path from 'path'
import { OAuthAPIClient } from '../lib/oauth-api-client'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function getProjectTasks() {
  console.log('📋 Pulling tasks from your project list using OAuth API...\n')

  // Initialize OAuth API client
  const client = new OAuthAPIClient()

  if (!client.isConfigured()) {
    console.error('❌ OAuth credentials not configured!')
    console.error('\nPlease set the following environment variables in .env.local:')
    console.error('  ASTRID_OAUTH_CLIENT_ID=your_client_id')
    console.error('  ASTRID_OAUTH_CLIENT_SECRET=your_client_secret')
    console.error('\nGet your OAuth credentials from:')
    console.error('  https://astrid.cc/settings/api-access\n')
    process.exit(1)
  }

  try {
    // Step 1: Test connection
    console.log('🔍 Testing API connection...')
    const connectionTest = await client.testConnection()
    if (!connectionTest.success) {
      throw new Error(connectionTest.error)
    }
    console.log('✅ Connected successfully\n')

    // Step 2: Get all lists
    console.log('📂 Fetching your lists...')
    const listsResult = await client.getLists()
    if (!listsResult.success || !listsResult.data) {
      throw new Error(listsResult.error || 'Failed to get lists')
    }

    console.log(`Found ${listsResult.data.length} lists:\n`)
    listsResult.data.forEach((list, index) => {
      console.log(`${index + 1}. ${list.name}`)
      console.log(`   ID: ${list.id}`)
    })

    // Step 3: Find your project list
    const projectListId = process.env.ASTRID_OAUTH_LIST_ID

    if (!projectListId) {
      console.error('\n❌ ASTRID_OAUTH_LIST_ID not set in .env.local')
      console.error('Available lists:')
      listsResult.data.forEach(list => console.error(`  - ${list.name} (ID: ${list.id})`))
      console.error('\nSet ASTRID_OAUTH_LIST_ID in .env.local')
      process.exit(1)
    }

    const projectList = listsResult.data.find(list => list.id === projectListId)
    if (!projectList) {
      console.error(`\n❌ Project list with ID "${projectListId}" not found`)
      console.error('Available lists:')
      listsResult.data.forEach(list => console.error(`  - ${list.name} (ID: ${list.id})`))
      console.error('\nUpdate ASTRID_OAUTH_LIST_ID in .env.local')
      process.exit(1)
    }

    console.log(`\n✅ Using project list: "${projectList.name}"\n`)

    // Step 4: Get uncompleted tasks from the project list
    console.log('📝 Fetching tasks...')
    const tasksResult = await client.getTasks(projectList.id, false)
    if (!tasksResult.success || !tasksResult.data) {
      throw new Error(tasksResult.error || 'Failed to get tasks')
    }

    console.log(`\nFound ${tasksResult.data.length} uncompleted tasks:\n`)

    // Display tasks with details
    tasksResult.data.forEach((task, index) => {
      const priority = '★'.repeat(task.priority)
      console.log(`${index + 1}. ${priority} ${task.title}`)
      console.log(`   ID: ${task.id}`)
      if (task.description) {
        const desc = task.description.length > 100
          ? task.description.substring(0, 100) + '...'
          : task.description
        console.log(`   Description: ${desc}`)
      }
      if (task.dueDateTime) {
        console.log(`   Due: ${new Date(task.dueDateTime).toLocaleDateString()}`)
      }
      console.log()
    })

    console.log('🎯 Ready to work on tasks!')
    console.log('\nNext steps:')
    console.log('1. Copy a task ID from above')
    console.log('2. Use it with your AI coding assistant')
    console.log('3. The assistant can update tasks and add comments via the OAuth API\n')

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

// Run the script
getProjectTasks().catch(console.error)
