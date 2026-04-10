#!/usr/bin/env npx tsx

/**
 * Post the current Claude Code remote control session link to an Astrid task.
 * Reads the session info from ~/.claude/sessions/ and posts a comment with
 * the link so the user can follow along from any device.
 *
 * Usage: npx tsx scripts/post-session-link.ts <taskId>
 */

import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import os from 'os'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function getSessionInfo(): { bridgeSessionId: string; name: string } | null {
  const sessionsDir = path.join(os.homedir(), '.claude', 'sessions')

  if (!fs.existsSync(sessionsDir)) return null

  // Find the most recent session file
  const files = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      name: f,
      path: path.join(sessionsDir, f),
      mtime: fs.statSync(path.join(sessionsDir, f)).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime)

  if (files.length === 0) return null

  try {
    const data = JSON.parse(fs.readFileSync(files[0].path, 'utf-8'))
    if (data.bridgeSessionId) {
      return {
        bridgeSessionId: data.bridgeSessionId,
        name: data.name || 'Claude Code Session'
      }
    }
  } catch {
    // ignore parse errors
  }

  return null
}

async function postSessionLink() {
  const taskId = process.argv[2]
  if (!taskId) {
    console.error('Usage: npx tsx scripts/post-session-link.ts <taskId>')
    process.exit(1)
  }

  const session = getSessionInfo()
  if (!session) {
    console.warn('⚠️ No active Claude Code session found')
    return
  }

  const sessionUrl = `https://claude.ai/code/sessions/${session.bridgeSessionId}`

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  const agentId = process.env.CLAUDE_AGENT_ID

  if (!clientId || !clientSecret) {
    console.error('❌ OAuth credentials not found in .env.local')
    process.exit(1)
  }

  // Get OAuth token
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
    console.error('❌ Failed to obtain access token')
    process.exit(1)
  }

  const { access_token } = await tokenResponse.json()

  // Post comment with session link
  const comment = `🔗 **Claude Code Session**: [${session.name}](${sessionUrl})\n\nFollow along or provide feedback via remote control.`

  const body: { content: string; type: string; aiAgentId?: string } = {
    content: comment,
    type: 'TEXT'
  }

  if (agentId) {
    body.aiAgentId = agentId
  }

  const response = await fetch(`https://astrid.cc/api/v1/tasks/${taskId}/comments`, {
    method: 'POST',
    headers: {
      'X-OAuth-Token': access_token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (response.ok) {
    console.log(`✅ Session link posted to task`)
    console.log(`   📎 ${sessionUrl}`)
  } else {
    const error = await response.text()
    console.error('❌ Failed to post session link:', error)
  }
}

postSessionLink()
