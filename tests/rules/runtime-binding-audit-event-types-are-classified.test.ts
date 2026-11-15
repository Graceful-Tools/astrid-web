/**
 * RULE — AWTD-1670: every RuntimeBindingAuditEvent type the code writes is
 * classified for retention in lib/runtime-binding/audit-retention.ts.
 *
 * An unclassified type is not pruned early (it counts as lifecycle, the
 * keep-longer side), but it silently keeps a detailed operational event for a
 * binding's whole life plus 90 days, which is not what Jon decided either. So a
 * new event type has to be put in one class or the other on purpose.
 *
 * What it scans: a `runtimeBindingAuditEvent` write, or any object passed to the
 * shared audit helper, whose `eventType` is a string literal. An event type
 * built at runtime cannot be checked here, so write it as a literal (or as a
 * constant whose value is one of the map's keys).
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { RUNTIME_BINDING_AUDIT_EVENT_CLASS } from '@/lib/runtime-binding/audit-retention'

const ROOT = process.cwd()
const SCANNED = ['app', 'lib', 'services', 'mcp', 'scripts']

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
    else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(full)
  }
  return out
}

/** Files that deal in runtime-binding audit events at all. */
const AUDIT_FILE = /runtimeBindingAuditEvent|RuntimeBindingAuditEvent|runtime-binding\/audit/

/** `eventType: 'x'` or `eventType: "x"`. */
const EVENT_TYPE_LITERAL = /\beventType\s*:\s*['"]([^'"]+)['"]/g

describe('runtime-binding audit event types are classified for retention (AWTD-1670)', () => {
  const written = new Map<string, string>()
  for (const file of SCANNED.flatMap(dir => sourceFiles(join(ROOT, dir)))) {
    const src = readFileSync(file, 'utf8')
    if (!AUDIT_FILE.test(src)) continue
    for (const m of src.matchAll(EVENT_TYPE_LITERAL)) {
      if (!written.has(m[1])) written.set(m[1], relative(ROOT, file))
    }
  }

  it('AWTD-1670: finds the export event, so the scan is actually looking', () => {
    expect(written.has('audit-exported')).toBe(true)
  })

  it('AWTD-1670: every literal event type written is in the classification map', () => {
    const unclassified = [...written]
      .filter(([type]) => !Object.prototype.hasOwnProperty.call(RUNTIME_BINDING_AUDIT_EVENT_CLASS, type))
      .map(([type, file]) => `${type} (${file})`)
    expect(
      unclassified,
      'Add each to RUNTIME_BINDING_AUDIT_EVENT_CLASS in lib/runtime-binding/audit-retention.ts as operational or lifecycle',
    ).toEqual([])
  })
})
