#!/usr/bin/env npx tsx
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const ASTRID_API_URL = 'https://astrid.cc'
const CLIENT_ID = process.env.ASTRID_OAUTH_CLIENT_ID
const CLIENT_SECRET = process.env.ASTRID_OAUTH_CLIENT_SECRET

async function getToken(): Promise<string> {
  const response = await fetch(`${ASTRID_API_URL}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to get OAuth token: ${response.status} ${error}`)
  }

  const data = await response.json()
  return data.access_token
}

async function markTaskComplete(taskId: string, taskTitle: string, token: string) {
  console.log(`\n📝 Marking task as complete: ${taskTitle}`)
  console.log(`   ID: ${taskId}`)

  const response = await fetch(`${ASTRID_API_URL}/api/v1/tasks/${taskId}`, {
    method: 'PATCH',
    headers: {
      'X-OAuth-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ completed: true }),
  })

  if (!response.ok) {
    const error = await response.text()
    console.error(`   ❌ Failed: ${response.status}`)
    console.error(`   ${error}`)
    return false
  }

  console.log(`   ✅ Marked as complete`)
  return true
}

async function main() {
  const tasks = [
    {
      id: '61b86660-71ca-4f82-9c5b-2c9f79cd52b5',
      title: 'iOS: when opening app when offline'
    },
    {
      id: '0cf175b3-bcce-4f13-b7b4-27a742b20da1',
      title: 'iOS: Show profile photos in comments'
    },
    {
      id: 'cb334c14-4649-4a23-9961-f84f6148576b',
      title: 'iOS/Web: Filter-aware task defaults'
    },
  ]

  console.log('🚀 Marking shipped tasks as complete...\n')
  console.log('🔐 Getting OAuth token...')
  const token = await getToken()
  console.log('✅ Token obtained')

  let completed = 0
  for (const task of tasks) {
    const success = await markTaskComplete(task.id, task.title, token)
    if (success) completed++
  }

  console.log(`\n🎉 Completed ${completed}/${tasks.length} tasks`)
}

main().catch(console.error)
