/**
 * RULE — AWTD-1669: a runtime binding's credential and payer references are
 * read only where they are configured or used by the executor.
 *
 * RFC docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md §4: "Credential
 * retrieval is restricted to the selected executor/dispatcher, not queue
 * clients, list editors or audit readers." The references are opaque ids, not
 * secrets, but a field that reaches a queue response, a list payload or an
 * audit row is a field somebody will one day fill with the real thing.
 *
 * Allowed:
 *  - the resolver, which loads the binding and builds the plan;
 *  - enrollment, where an administrator sets them (rules + the admin page form);
 *  - lib/runtime-binding/executor-credential.ts, the executor's one reader.
 * Everything else — the queue, the claim services and routes, the audit
 * writer and export, list APIs — must not name them at all.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCANNED = ['app', 'lib', 'services', 'components', 'mcp']
const ALLOWED = new Set([
  'lib/ai/runtime-binding-resolver.ts',
  'lib/runtime-binding/enrollment-rules.ts',
  'lib/runtime-binding/executor-credential.ts',
  'app/[locale]/admin/runtime-bindings/page.tsx',
])
const REFERENCE = /\b(credentialRef|billingAccountRef|payerAccountRef|accountRef)\b/

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
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

describe('runtime-binding credential and payer references stay with the executor (AWTD-1669)', () => {
  const readers = SCANNED.flatMap(dir => sourceFiles(join(ROOT, dir)))
    .filter(file => REFERENCE.test(readFileSync(file, 'utf8')))
    .map(file => relative(ROOT, file))

  it('AWTD-1669: finds the executor module, so the scan is actually looking', () => {
    expect(readers).toContain('lib/runtime-binding/executor-credential.ts')
  })

  it('AWTD-1669: no other module reads a credential or payer reference', () => {
    expect(readers.filter(file => !ALLOWED.has(file))).toEqual([])
  })
})
