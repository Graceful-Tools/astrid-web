/**
 * RULE — task 1e772f0c.
 *
 * `lib/secure-storage.ts` exists as the storage abstraction, and eight other
 * files imported `@vercel/blob` straight past it. A partner running on S3 had
 * to find and rewrite all of them, which is the difference between a
 * configurable product and a fork.
 *
 * A ban rather than a ratchet: unlike the Prisma ratchet next door, the count
 * here is ZERO and stays zero. There is exactly one legitimate importer, so
 * "the number must not go up" would be a strictly weaker rule than "there is
 * one", and the fix for a violation is always the same one line.
 *
 * IT MATCHES SUBPATHS ON PURPOSE. Two client-token routes import
 * `@vercel/blob/client`, and the original filing recorded one of them as
 * already clean because a search for the bare package name did not find it. A
 * rule with that same blind spot would ship green over the very files it
 * exists to catch.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

/** The one module allowed to name the storage vendor. */
const STORAGE_MODULE = 'lib/secure-storage.ts'

/** Everything that ships or is run against real data. */
const SCANNED = ['app', 'lib', 'components', 'hooks', 'services', 'mcp', 'scripts']

/** `@vercel/blob`, `@vercel/blob/client`, and anything else under it. */
const BLOB_IMPORT = /(?:from|import|require)\s*\(?\s*['"]@vercel\/blob(?:\/[^'"]*)?['"]/

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
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

describe('blob storage access goes through lib/secure-storage.ts (task 1e772f0c)', () => {
  it('has exactly one module importing the storage vendor', () => {
    const offenders = SCANNED.flatMap(dir => sourceFiles(join(ROOT, dir)))
      .map(file => relative(ROOT, file))
      .filter(file => file !== STORAGE_MODULE)
      .filter(file => BLOB_IMPORT.test(readFileSync(join(ROOT, file), 'utf8')))

    expect(
      offenders,
      `These import @vercel/blob directly instead of going through ${STORAGE_MODULE}:\n` +
        offenders.map(f => `  ${f}`).join('\n') +
        `\n\nUse putObject / deleteObject / issueClientUploadToken from ${STORAGE_MODULE}. ` +
        `If you genuinely need a capability it does not expose, add it there rather than here.`
    ).toEqual([])
  })

  it('still has the one importer, so the rule cannot pass by the module being deleted', () => {
    // A rule whose subject can vanish silently is a rule that stops testing
    // anything the day someone renames the file.
    expect(BLOB_IMPORT.test(readFileSync(join(ROOT, STORAGE_MODULE), 'utf8'))).toBe(true)
  })
})
