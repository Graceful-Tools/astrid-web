/**
 * RULE — P3 of docs/specs/GITHUB_PROJECTS_WHITELABEL.md §7.2.
 *
 * One GitHub App per brand, constructed in one place, reached through one host
 * module. The coding agent's App was constructed inline in five files, and the
 * GitHub hosts were string literals in four more — so a GHE.com data-residency
 * tenant (or, later, GitHub Enterprise Server) would have been a fork, not a
 * setting.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const files = ['app', 'lib', 'mcp'].flatMap(d => sourceFiles(join(ROOT, d))).map(f => relative(ROOT, f))
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8')

const NEW_APP = /\bnew App\s*\(/
const GITHUB_HOST_LITERAL = /['"`]https:\/\/(?:api\.)?github\.com(?=[/'"`])/

const HOST_ALLOWED: Record<string, string> = {
  'lib/github/host.ts': 'the one place the hosts are named',
  'lib/copilot/oauth.ts': 'Copilot authorises a different product with its own credential (spec §7.4)',
  'app/api/v1/integrations/copilot/authorize/route.ts': 'the Copilot connect flow, same reason',
  'lib/mac-release.ts': "the product's own public release feed on github.com, not a tenant's GitHub",
  'app/api/coding-agent/github-trigger/route.ts': 'a documentation link in a comment body',
}

describe('GitHub access goes through lib/github/', () => {
  it('recognises the patterns it bans', () => {
    expect(NEW_APP.test('const app = new App({ appId, privateKey })')).toBe(true)
    expect(GITHUB_HOST_LITERAL.test("fetch('https://api.github.com/user')")).toBe(true)
    expect(GITHUB_HOST_LITERAL.test('`https://github.com/login/oauth/authorize`')).toBe(true)
    expect(GITHUB_HOST_LITERAL.test("'https://github.community/x'")).toBe(false)
  })

  it('constructs the GitHub App only in lib/github/app.ts', () => {
    const offenders = files.filter(f => f !== 'lib/github/app.ts' && NEW_APP.test(read(f)))
    expect(offenders, `Use getGitHubApp() from lib/github/app.ts:\n${offenders.join('\n')}`).toEqual([])
  })

  it('names the GitHub hosts only in lib/github/host.ts', () => {
    const offenders = files.filter(f => !(f in HOST_ALLOWED) && GITHUB_HOST_LITERAL.test(read(f)))
    expect(offenders, `Use GITHUB_API_URL / GITHUB_WEB_URL from lib/github/host.ts:\n${offenders.join('\n')}`).toEqual([])
  })

  it('keeps the host allow-list honest', () => {
    for (const f of Object.keys(HOST_ALLOWED)) expect(GITHUB_HOST_LITERAL.test(read(f)), f).toBe(true)
  })
})
