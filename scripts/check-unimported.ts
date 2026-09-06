#!/usr/bin/env npx tsx
/**
 * Fail on modules under lib/ and components/ that nothing can reach
 * (task 1b381810).
 *
 * ~2,900 lines of lib/ had zero import sites. Most of it was merely dead, but
 * one file was a trap: lib/api/withAuth.ts exported a symbol with the SAME NAME
 * as lib/api-auth-wrapper.ts's enforcing withAuth, minus the `capability`
 * option. Autocomplete offered both. A route that imported the wrong one
 * compiled, passed review, and silently had no capability gate — indistinguish-
 * able from a correct route at the call site.
 *
 * Deleting them once fixes today. This is what stops it coming back.
 *
 * Deliberately scoped to lib/ and components/. scripts/ is full of one-off
 * operational tools meant to be run by hand, so "not imported" is not evidence
 * of death there, and failing on it would push people to delete working tools
 * to satisfy a count.
 *
 * Uses the repo's own import-graph walker rather than adding knip or ts-prune:
 * a third tool for a question two lines of graph traversal already answer.
 */

import { readdirSync, readFileSync, statSync } from 'fs'
import { join, dirname, normalize } from 'path'

const ROOT = process.cwd()
const SKIP = new Set(['node_modules', '.next', '.git', 'archived', 'dist', '.vercel', 'coverage', 'public'])

/** Modules that are entry points by nature — nothing imports them, by design. */
const ENTRY_PATTERNS = [
  /^app\//,            // routes, pages, layouts — Next resolves these
  /^pages\//,
  /^middleware\.ts$/,
  /^instrumentation\.ts$/,
  /^tests\//,          // vitest resolves these
  /^e2e\//,
  /^scripts\//,        // run by hand or by package.json
  /^mcp\//,            // standalone servers
  /^packages\//,       // separately published
  /^tools\//,
  /^prisma\//,
  /\.d\.ts$/,
  /^next\.config\.mjs$/,
  /^tailwind\.config/,
  /^postcss\.config/,
  /^vitest\..*config/,
  /^playwright\.config/,
  /^eslint\.config/,
]

/** Checked for reachability. Everything else is either an entry point or not ours. */
const CHECKED_PATTERNS = [/^lib\//, /^components\//]

/**
 * Reachable, but not through an import this scanner can see.
 *
 * The walker looks for `from`/`import`/`require` specifiers. A module named as
 * a STRING PATH in a config file has no such specifier, so it looks orphaned —
 * and lib/i18n/request.ts is exactly that case. Deleting it on the scanner's
 * say-so would have removed the app's entire i18n configuration.
 *
 * Each entry needs the reference that keeps it alive, so the list cannot become
 * a dumping ground.
 */
const REACHED_BY_CONFIG: Record<string, string> = {
  'lib/i18n/request.ts': "next.config.mjs: createNextIntlPlugin('./lib/i18n/request.ts')",
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry) || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) out.push(full.replace(`${ROOT}/`, ''))
  }
  return out
}

function specifiersIn(source: string): string[] {
  const specs: string[] = []
  for (const match of source.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    specs.push(match[1])
  }
  return specs
}

function main() {
  const files = walk(ROOT)
  const known = new Set(files)

  function resolve(spec: string, importer: string): string | null {
    let base: string
    if (spec.startsWith('@/')) base = spec.slice(2)
    else if (spec.startsWith('.')) base = normalize(join(dirname(importer), spec))
    else return null

    for (const ext of ['.ts', '.tsx', '.js', '.mjs', '']) {
      if (known.has(base + ext)) return base + ext
    }
    for (const ext of ['.ts', '.tsx', '.js']) {
      const index = join(base, `index${ext}`)
      if (known.has(index)) return index
    }
    return null
  }

  const importedBy = new Map<string, string[]>()
  for (const file of files) {
    for (const spec of specifiersIn(readFileSync(join(ROOT, file), 'utf8'))) {
      const target = resolve(spec, file)
      if (!target || target === file) continue
      importedBy.set(target, [...(importedBy.get(target) ?? []), file])
    }
  }

  const isEntry = (f: string) => ENTRY_PATTERNS.some((p) => p.test(f))
  const isChecked = (f: string) => CHECKED_PATTERNS.some((p) => p.test(f))

  const orphans: string[] = []
  const testOnly: string[] = []

  for (const file of files) {
    if (!isChecked(file) || isEntry(file)) continue
    if (file in REACHED_BY_CONFIG) continue
    const importers = importedBy.get(file) ?? []
    if (importers.length === 0) {
      orphans.push(file)
      continue
    }
    // Imported only by its own test. Usually dead — components/task-form.tsx
    // looked alive for exactly this reason — but NOT always: a specification
    // module (lib/api-contracts/legacy-ios-shapes.ts, lib/task-detail-field-order.ts)
    // exists so a test can assert a cross-platform contract, and its value IS
    // the test. So this is reported, never fatal; the judgement is a person's.
    if (importers.every((i) => i.startsWith('tests/') || i.startsWith('e2e/'))) {
      testOnly.push(`${file}  (only ${[...new Set(importers)].join(', ')})`)
    }
  }

  console.log(`\n🧹 check:unimported — ${files.length} files, checking lib/ and components/\n`)

  if (testOnly.length) {
    console.log(`📋 ${testOnly.length} module(s) imported ONLY by tests — advisory:`)
    for (const f of testOnly) console.log(`     - ${f}`)
    console.log(
      '     Often dead. But a SPECIFICATION module exists so a test can assert a\n' +
      '     cross-platform contract, and there its value is the test. Judge each.\n'
    )
  }

  if (orphans.length === 0) {
    console.log('✅ Every module under lib/ and components/ is reachable.\n')
    process.exit(0)
  }

  console.log(`❌ ${orphans.length} module(s) nothing imports:`)
  for (const f of orphans) console.log(`     - ${f}`)
  console.log(
    '     Delete them, or wire them up. If something DOES reach it by a path\n' +
    '     string in a config file, add it to REACHED_BY_CONFIG with the reference.\n'
  )

  process.exit(1)
}

main()
