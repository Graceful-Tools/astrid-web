#!/usr/bin/env npx tsx

/**
 * Post THIS Claude Code session's remote-control link to an Astrid task, so the
 * task says who is working it and Jon can follow along from any device.
 *
 * Session identification lives in ./lib/calling-session.ts and is deliberately
 * environment-driven: this script used to pick the most recently modified file
 * in ~/.claude/sessions, which is the caller only when one session is running
 * (task 8ee7e873). When the session cannot be identified it posts NOTHING —
 * the link is a claim about who owns the task, and a wrong claim is worse than
 * an unclaimed task.
 *
 * Usage: npx tsx scripts/post-session-link.ts <taskId>
 */

import { loadScriptEnv } from './lib/load-env'
import { resolveCallingSession, sessionUrl } from './lib/calling-session'

loadScriptEnv()

async function postSessionLink() {
  const taskId = process.argv[2]
  if (!taskId) {
    console.error('Usage: npx tsx scripts/post-session-link.ts <taskId>')
    process.exit(1)
  }

  const session = resolveCallingSession()
  if (!session) {
    console.warn(
      '⚠️ Could not identify the calling session (no CLAUDE_CODE_BRIDGE_SESSION_ID, ' +
        'no readable session file for CLAUDE_PID) — posting no link rather than a guessed one',
    )
    return
  }

  const url = sessionUrl(session.bridgeSessionId)

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
  const comment = `🔗 **Claude Code Session**: [${session.name}](${url})\n\nFollow along or provide feedback via remote control.`

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
    console.log(`   📎 ${url}`)
  } else {
    const error = await response.text()
    console.error('❌ Failed to post session link:', error)
  }
}

postSessionLink()
