/**
 * RULE — AWTD-1094.
 *
 * The coding agent (the GitHub App that turns a task into a branch, a PR and
 * a merge) was gated on `syncGithubIssues`, the repo-level Issues sync — a
 * different integration with a different credential. A partner who turned
 * Issues sync off lost the coding agent without being told, and could not
 * have one without the other.
 *
 * Every coding-agent route now answers to `codingAgent`, and none of them to
 * `syncGithubIssues`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

/** The coding agent's server surface. */
const CODING_AGENT_DIRS = [
  'app/api/github',
  'app/api/v1/github',
  'app/api/coding-workflow',
  'app/api/coding-agent',
]

function routeFiles(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) routeFiles(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

/**
 * GitHub Projects boards are their own product surface with their own switch
 * (githubProjects, AWTD-1151), not the coding agent's.
 */
const NOT_THE_CODING_AGENT = 'app/api/v1/github/projects/'

const routes = CODING_AGENT_DIRS.flatMap(dir => routeFiles(join(ROOT, dir)))
  .map(f => relative(ROOT, f))
  .filter(f => !f.startsWith(NOT_THE_CODING_AGENT))

describe('the coding agent has its own capability (AWTD-1094)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('finds the routes it is about', () => {
    expect(routes.length).toBeGreaterThan(10)
  })

  it.each(routes)('%s is gated on codingAgent, not syncGithubIssues', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8')
    expect(source).toMatch(/capabilityGate\('codingAgent'\)|capability:\s*'codingAgent'/)
    expect(source).not.toMatch(/'syncGithubIssues'/)
  })

  it('is on by default and can be switched off on its own', async () => {
    let { CAPABILITIES } = await import('@/lib/brand/capabilities')
    expect(CAPABILITIES.codingAgent).toBe(true)

    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_BRAND_ENABLE_CODING_AGENT', 'false')
    ;({ CAPABILITIES } = await import('@/lib/brand/capabilities'))
    expect(CAPABILITIES.codingAgent).toBe(false)
    expect(CAPABILITIES.syncGithubIssues).toBe(true)
  })
})
