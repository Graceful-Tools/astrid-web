#!/usr/bin/env npx tsx

/**
 * Download a secure file (a task screenshot, say) through the API so an agent
 * can open it. The blob URL on a task is private and cannot be fetched
 * directly; the secure-files route authorises by `attachments:read` and by the
 * caller's access to the task (ADEV-356).
 *
 * Usage: npx tsx scripts/download-task-attachment.ts <fileId> <outDir>
 * `fileId` is `secureFiles[].id` from get_task / get_task_comments.
 */

import { mkdirSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

const BASE_URL = process.env.ASTRID_API_URL || 'https://astrid.cc'

async function main() {
  const [fileId, outDir] = process.argv.slice(2)
  if (!fileId || !outDir) {
    console.error('Usage: npx tsx scripts/download-task-attachment.ts <fileId> <outDir>')
    process.exit(1)
  }

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('❌ OAuth credentials not found in the environment')
    process.exit(1)
  }

  const tokenResponse = await fetch(`${BASE_URL}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  })
  if (!tokenResponse.ok) {
    console.error('❌ Failed to obtain access token')
    process.exit(1)
  }
  const { access_token } = await tokenResponse.json()

  const headers = { 'X-OAuth-Token': access_token }
  const info = await fetch(`${BASE_URL}/api/v1/secure-files/${encodeURIComponent(fileId)}?info=true`, { headers })
  if (info.status === 403) {
    console.error(
      '❌ 403: this connection lacks attachments:read. Adopt the AI agent scope group in Settings → Connections.',
    )
    process.exit(1)
  }
  if (!info.ok) {
    console.error(`❌ Could not read file info (HTTP ${info.status})`)
    process.exit(1)
  }
  const meta = (await info.json()) as { url: string; fileName?: string }
  const name = basename(meta.fileName || fileId)

  const file = await fetch(meta.url)
  if (!file.ok) {
    console.error(`❌ Could not download file (HTTP ${file.status})`)
    process.exit(1)
  }

  mkdirSync(outDir, { recursive: true })
  const dest = join(outDir, name)
  writeFileSync(dest, Buffer.from(await file.arrayBuffer()))
  console.log(dest)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
