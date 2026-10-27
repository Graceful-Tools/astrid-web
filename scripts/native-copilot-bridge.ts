#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadScriptEnv } from './lib/load-env'
import { runNativeCopilotBridge, type BridgeTransport } from './lib/native-copilot-bridge'

loadScriptEnv()

const argv = process.argv.slice(2)
function value(flag: string): string {
  const index = argv.indexOf(flag)
  const result = index < 0 ? undefined : argv[index + 1]
  if (!result || result.startsWith('--')) throw new Error(`${flag} is required`)
  return result
}

async function main() {
  const listId = value('--list')
  const output = value('--output')
  if (argv.includes('--execute') && argv.includes('--dry-run')) throw new Error('Use either --execute or --dry-run, not both')
  const dryRun = !argv.includes('--execute')
  const repo = 'Graceful-Tools/astrid-web'
  const events: string[] = []
  const result: { version: 1; listId: string; dryRun: boolean; ok: boolean; events: string[]; error?: string } =
    { version: 1, listId, dryRun, ok: false, events }
  try {
    if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN must be an authorized user-to-server token; no built-in token fallback')
    const response = await fetch('https://astrid.cc/api/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: process.env.ASTRID_OAUTH_CLIENT_ID,
        client_secret: process.env.ASTRID_OAUTH_CLIENT_SECRET,
      }),
    })
    if (!response.ok) throw new Error(`Astrid OAuth failed: HTTP ${response.status}`)
    const auth: { access_token?: string } = await response.json()
    if (!auth.access_token) throw new Error('Astrid OAuth returned no access token')
    const accessToken = auth.access_token
    const transport: BridgeTransport = {
      async astrid<T>(path: string, body?: unknown): Promise<T> {
        const res = await fetch(`https://astrid.cc${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'X-OAuth-Token': accessToken, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        if (!res.ok) throw new Error(`Astrid ${path}: HTTP ${res.status}: ${await res.text()}`)
        return res.json()
      },
      async github<T>(path: string, body?: unknown): Promise<T> {
        const args = ['api', '--hostname', 'github.com', '-H', 'Accept: application/vnd.github+json',
          '-H', 'X-GitHub-Api-Version: 2022-11-28', '--method', body === undefined ? 'GET' : 'POST', path]
        if (body !== undefined) args.push('--input', '-')
        return JSON.parse(execFileSync('gh', args, {
          encoding: 'utf8', input: body === undefined ? undefined : JSON.stringify(body),
          maxBuffer: 16 * 1024 * 1024, timeout: 60_000,
        })) as T
      },
    }
    const template = readFileSync('.github/ISSUE_TEMPLATE/feature_request.md', 'utf8')
      .replace(/^---[\s\S]*?---\s*/, '')
      .replace(/^A clear and concise.*$/gm, 'See the Astrid source task below.')
      .replace(/^Add any other context.*$/gm, 'See the Astrid source task and comments below.')
      .replace(/^Which platform.*$/gm, 'Web; mirrored from the explicit Astrid Web board.')
      .replace('- [ ] Web', '- [x] Web')
    await runNativeCopilotBridge({
      transport, repo, listId, dryRun, issueTemplate: template,
      report: message => { events.push(message); console.error(message) },
    })
    result.ok = true
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  }
}

main().catch(error => {
  console.error(`Native Copilot bridge failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
