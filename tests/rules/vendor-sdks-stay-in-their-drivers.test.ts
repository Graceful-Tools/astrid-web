// @vitest-environment node
/**
 * RULE — AWTD-1463, widening task 1e772f0c.
 *
 * 1e772f0c pinned `@vercel/blob` to `lib/secure-storage.ts` after eight files
 * imported it straight past the abstraction, so a partner on S3 had to find
 * and rewrite all of them — the difference between a configurable product and
 * a fork. PLATFORM_ASSESSMENT_2026-11 §5 makes that the rule for every seam:
 * one code path, backend chosen by env. Upstash, Vercel Blob, Azure, aws4fetch,
 * Resend and nodemailer may each be named only in their driver files, listed
 * once in scripts/lib/vendor-sdk-boundaries.mjs.
 *
 * Two layers, because each misses something:
 * - ESLint's no-restricted-imports (eslint.config.mjs) fails `npm run lint` on
 *   a static import in the editor and in CI — checked here by linting a
 *   scratch file, which is the acceptance test: `@upstash/redis` from
 *   `lib/foo.ts` fails.
 * - A source scan, which also sees dynamic `import()` and `require()` — how
 *   the drivers themselves load optional SDKs, and invisible to that rule.
 *
 * Subpaths match on purpose: two routes once imported `@vercel/blob/client`
 * and a search for the bare package name missed them.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative, matchesGlob } from 'node:path'
import { ESLint } from 'eslint'
import { VENDOR_SDK_BOUNDARIES } from '../../scripts/lib/vendor-sdk-boundaries.mjs'

const ROOT = process.cwd()

/** Everything that ships or is run against real data. */
const SCANNED = ['app', 'lib', 'components', 'hooks', 'services', 'mcp', 'scripts', 'packages']
const ROOT_FILES = ['middleware.ts', 'instrumentation.ts']

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(tsx?|mjs|cjs|js)$/.test(entry)) out.push(full)
  }
  return out
}

/** `@vercel/blob` → a regex for it and its subpaths; `@azure/*` → the scope. */
function importOf(pattern: string): RegExp {
  const base = pattern.replace(/\/\*$/, '')
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tail = pattern.endsWith('/*') ? '\\/[^\'"]+' : '(?:\\/[^\'"]*)?'
  return new RegExp(`(?:from|import|require)\\s*\\(?\\s*['"]${escaped}${tail}['"]`)
}

const files = [
  ...SCANNED.flatMap(dir => sourceFiles(join(ROOT, dir))),
  ...ROOT_FILES.map(f => join(ROOT, f)),
]
  .map(f => relative(ROOT, f))
  // The list itself names every vendor in its prose.
  .filter(f => f !== 'scripts/lib/vendor-sdk-boundaries.mjs')

describe('vendor SDKs stay in their driver files (AWTD-1463)', () => {
  for (const { vendor, packages, files: allowed } of VENDOR_SDK_BOUNDARIES) {
    it(`${vendor} is imported only from ${allowed.join(', ')}`, () => {
      const patterns = packages.map(importOf)
      const offenders = files
        .filter(file => !allowed.some(glob => matchesGlob(file, glob)))
        .filter(file => {
          let source = ''
          try {
            source = readFileSync(join(ROOT, file), 'utf8')
          } catch {
            return false
          }
          return patterns.some(p => p.test(source))
        })
      expect(
        offenders,
        `These import ${vendor} outside its driver files:\n${offenders.map(f => `  ${f}`).join('\n')}\n\n` +
          'Go through the seam (lib/storage/, lib/secure-storage.ts, lib/email-transport.ts, lib/redis.ts, ' +
          'lib/realtime/). If the seam lacks a capability, add it there.'
      ).toEqual([])
    })
  }

  it('still has its importers, so the rule cannot pass by the drivers being renamed', () => {
    // A rule whose subject can vanish silently stops testing anything.
    const expected: Array<[string, string]> = [
      ['lib/secure-storage.ts', '@vercel/blob'],
      ['lib/redis.ts', '@upstash/*'],
      ['lib/email-transport.ts', 'resend'],
      ['lib/email-transport.ts', 'nodemailer'],
      ['lib/storage/s3-object-store.ts', 'aws4fetch'],
      ['lib/storage/azure-blob-object-store.ts', '@azure/*'],
    ]
    for (const [file, pkg] of expected) {
      expect(importOf(pkg).test(readFileSync(join(ROOT, file), 'utf8')), `${file} imports ${pkg}`).toBe(true)
    }
  })
})

describe('ESLint enforces the same boundaries (AWTD-1463)', { timeout: 120_000 }, () => {
  const eslint = new ESLint({ cwd: ROOT })
  async function restrictedImports(code: string, filePath: string) {
    const [result] = await eslint.lintText(code, { filePath: join(ROOT, filePath) })
    return result.messages.filter(m => m.ruleId === 'no-restricted-imports')
  }

  it('fails a scratch import of @upstash/redis from lib/foo.ts', async () => {
    const messages = await restrictedImports("import { Redis } from '@upstash/redis'\nexport const r = Redis\n", 'lib/foo.ts')
    expect(messages).toHaveLength(1)
    expect(messages[0].severity).toBe(2)
    expect(messages[0].message).toMatch(/lib\/redis\.ts/)
  })

  it.each([
    ["import { put } from '@vercel/blob'", 'app/api/foo/route.ts'],
    ["import { upload } from '@vercel/blob/client'", 'components/uploader.tsx'],
    ["import { BlobServiceClient } from '@azure/storage-blob'", 'lib/attachments.ts'],
    ["import { Resend } from 'resend'", 'lib/notifications.ts'],
    ["import nodemailer from 'nodemailer'", 'lib/storage/mail.ts'],
    ["import { AwsClient } from 'aws4fetch'", 'lib/email-transport.ts'],
  ])('fails %s in %s', async (code, filePath) => {
    expect(await restrictedImports(`${code}\n`, filePath)).toHaveLength(1)
  })

  it.each([
    ["import { Redis } from '@upstash/redis'", 'lib/redis.ts'],
    ["import { Redis } from '@upstash/redis'", 'lib/realtime/upstash-bus.ts'],
    ["import { put } from '@vercel/blob'", 'lib/secure-storage.ts'],
    ["import { BlobServiceClient } from '@azure/storage-blob'", 'lib/storage/azure-blob-object-store.ts'],
    ["import { Resend } from 'resend'", 'lib/email-transport.ts'],
    ["import { Redis } from '@upstash/redis'", 'tests/lib/anything.test.ts'],
  ])('allows %s in %s', async (code, filePath) => {
    expect(await restrictedImports(`${code}\n`, filePath)).toEqual([])
  })
})
