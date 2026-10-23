/**
 * RULE — every MCPToken row is written hashed (AWTD-1335).
 *
 * `MCPToken.token` holds the SHA-256 of the credential and `tokenEncrypted`
 * its ciphertext; `mcpTokenStorageFields` (lib/mcp-token.ts) is the one place
 * that computes both. `app/api/mcp/tokens/route.ts` wrote the plaintext
 * `astrid_mcp_…` straight into `token` and then listed it to every member of
 * the list — and because a prefixed value passes `mcpTokenLookup`'s legacy
 * branch, a member could read a working credential minted by someone else.
 * That route is gone; this keeps the next create site from doing the same.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(__dirname, '..', '..')
const SCAN = ['app', 'lib', 'services', 'scripts']
const SKIP = new Set(['node_modules', '.next', 'archive'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    if (SKIP.has(name)) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|mts)$/.test(name) ? [path] : []
  })
}

/** Each `mCPToken.create(` / `.upsert(` call and the text of its argument, up to the matching paren. */
function createCalls(source: string): string[] {
  const calls: string[] = []
  const re = /\bmCPToken\.(create|upsert|createMany)\(/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) {
    let depth = 1
    let i = match.index + match[0].length
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '(') depth++
      else if (source[i] === ')') depth--
    }
    calls.push(source.slice(match.index, i))
  }
  return calls
}

describe('MCP tokens are hashed at rest (AWTD-1335)', () => {
  const sites = SCAN.flatMap(dir => sourceFiles(join(ROOT, dir))).flatMap(file =>
    createCalls(readFileSync(file, 'utf8')).map(call => ({ file: relative(ROOT, file), call })),
  )

  it('finds the create sites it is guarding', () => {
    expect(sites.length).toBeGreaterThanOrEqual(3)
  })

  it('writes every MCPToken through mcpTokenStorageFields', () => {
    const raw = sites.filter(site => !site.call.includes('mcpTokenStorageFields(')).map(site => site.file)
    expect(raw, 'These write MCPToken.token without hashing it — spread mcpTokenStorageFields(plaintext) instead').toEqual([])
  })
})
