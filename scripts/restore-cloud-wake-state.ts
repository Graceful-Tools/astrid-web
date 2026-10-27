#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSeenKeys } from './lib/wake-keys'

const harness = process.env.ASTRID_FIXALL_HARNESS
if (!harness || !['claude-code', 'github-copilot', 'codex'].includes(harness)) {
  throw new Error('A supported cloud harness is required')
}
const name = `agent-run-${harness}-`
const pages = JSON.parse(execFileSync('gh', [
  'api', '--paginate', '--slurp', 'repos/{owner}/{repo}/actions/artifacts?per_page=100',
], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })) as Array<{ artifacts: Array<{
  id: number; name: string; expired: boolean; workflow_run?: { head_branch?: string }
}> }>
const candidates = pages.flatMap(page => page.artifacts).filter(artifact => artifact.name.startsWith(name) &&
  artifact.name !== `${name}${process.env.GITHUB_RUN_ID}` &&
  !artifact.expired && artifact.workflow_run?.head_branch === process.env.GITHUB_REF_NAME)
let restored = false
for (const previous of candidates) {
  const temp = process.env.RUNNER_TEMP
  if (!temp) throw new Error('RUNNER_TEMP is required')
  const archive = join(temp, 'astrid-wake-state.zip')
  writeFileSync(archive, execFileSync('gh', [
    'api', `repos/{owner}/{repo}/actions/artifacts/${previous.id}/zip`,
  ], { maxBuffer: 64 * 1024 * 1024 }))
  const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split('\n')
  if (!entries.includes('.agent-state/seen.json') || !entries.includes('.agent-state/seen.json.attempts.json')) {
    console.log(`STATE: artifact ${previous.id} contains no wake outcome; checking the previous run`)
    continue
  }
  // Never extract arbitrary archive paths. Only these two validated JSON values
  // may cross into the next worker's durable memory.
  const seen = execFileSync('unzip', ['-p', archive, '.agent-state/seen.json'], { encoding: 'utf8' })
  const attempts = execFileSync('unzip', ['-p', archive, '.agent-state/seen.json.attempts.json'], { encoding: 'utf8' })
  const keys = parseSeenKeys(seen)
  const counts: unknown = JSON.parse(attempts)
  if (!keys || !counts || typeof counts !== 'object' || Array.isArray(counts) ||
      Object.values(counts).some(value => typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
    throw new Error('Retained wake state is malformed; refusing to silently reset retry bounds')
  }
  mkdirSync('.agent-state', { recursive: true })
  writeFileSync('.agent-state/seen.json', JSON.stringify(keys))
  writeFileSync('.agent-state/seen.json.attempts.json', JSON.stringify(counts))
  console.log(`STATE: restored bounded wake history from artifact ${previous.id}`)
  restored = true
  break
}
if (!restored) {
  mkdirSync('.agent-state', { recursive: true })
  writeFileSync('.agent-state/seen.json', '[]')
  writeFileSync('.agent-state/seen.json.attempts.json', '{}')
  console.log('STATE: no retained run state — starting a new bounded wake history')
}
