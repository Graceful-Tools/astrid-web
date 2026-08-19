/**
 * middleware.ts must stay loadable in the edge runtime (task fd217729).
 *
 * On 2026-08-10 a branch added
 *
 *   import { detectPlatform } from '@/lib/analytics-events'
 *
 * to middleware.ts. That module imports Prisma at module scope. Middleware runs
 * on the edge, which cannot load Prisma, so the bundle failed to instantiate and
 * EVERY request returned 500 (MIDDLEWARE_INVOCATION_FAILED) — not only the
 * legacy `/api/*` traffic the change was about. Twelve minutes of full outage,
 * ended by a rollback.
 *
 * The branch's own comment stated the constraint it then broke: "a beacon is
 * needed because the middleware runs in the edge runtime and cannot reach
 * Prisma". The design was right; reusing one helper dragged in its whole import
 * graph.
 *
 * WHY THIS TEST EXISTS RATHER THAN A CODE REVIEW NOTE: predeploy was 8/8 green,
 * `next build` included. A local build compiles middleware without exercising
 * the edge runtime the way Vercel does, and nothing loads middleware in an edge
 * sandbox, so this entire class of bug was invisible until production. The task
 * called that "the more important finding than the import itself", and it is —
 * a static import walk closes it for milliseconds per run.
 *
 * This guard is deliberately about the TRANSITIVE graph. The offending import
 * was one hop from middleware and two from Prisma; a rule that only inspected
 * middleware's own import list would have passed it.
 */

import { describe, it, expect } from 'vitest'
import { collectImportGraph } from '../scripts/lib/import-graph'
import path from 'path'

const ROOT = process.cwd()
const graph = collectImportGraph(path.join(ROOT, 'middleware.ts'), ROOT)

/** Packages that cannot load on the edge. */
const FORBIDDEN_PACKAGES = ['@prisma/client', '.prisma/client', 'prisma']

/**
 * Node builtins with no edge implementation. `crypto` is omitted on purpose —
 * the edge runtime provides Web Crypto, and `node:crypto` is caught by the
 * `node:` rule below.
 */
const FORBIDDEN_BUILTINS = [
  'fs',
  'os',
  'child_process',
  'worker_threads',
  'net',
  'tls',
  'dns',
  'http',
  'https',
  'cluster',
  'perf_hooks',
]

/** Repo files that pull Prisma in by definition. */
const FORBIDDEN_FILES = ['lib/prisma.ts']

describe('middleware edge-runtime safety (task fd217729)', () => {
  it('reaches no Prisma package, however many hops away', () => {
    const offenders = graph.externals.filter(spec =>
      FORBIDDEN_PACKAGES.some(pkg => spec === pkg || spec.startsWith(`${pkg}/`)),
    )

    expect(
      offenders,
      offenders.length
        ? `middleware transitively imports ${offenders.join(', ')} via ` +
          offenders.map(o => graph.importedBy[o]?.join(', ')).join(' | ') +
          ' — the edge runtime cannot load Prisma, and this fails EVERY request, not just API ones'
        : '',
    ).toEqual([])
  })

  it('reaches no repo module that imports Prisma at module scope', () => {
    const offenders = graph.files.filter(file =>
      FORBIDDEN_FILES.some(forbidden => file === forbidden || file.endsWith(`/${forbidden}`)),
    )

    expect(offenders, `middleware transitively imports ${offenders.join(', ')}`).toEqual([])
  })

  it('reaches no node-only builtin', () => {
    const offenders = graph.externals.filter(
      spec => FORBIDDEN_BUILTINS.includes(spec) || spec.startsWith('node:'),
    )

    expect(
      offenders,
      offenders.length
        ? `middleware transitively imports node builtin(s) ${offenders.join(', ')} via ` +
          offenders.map(o => graph.importedBy[o]?.join(', ')).join(' | ')
        : '',
    ).toEqual([])
  })

  it('actually walked the graph — a guard that inspects nothing always passes', () => {
    // Without this, a resolver change that silently returns an empty graph
    // would turn the three assertions above into decoration.
    expect(graph.files).toContain('middleware.ts')
    expect(graph.files.length, 'middleware imports repo modules; the walk found none').
      toBeGreaterThan(1)
    expect(graph.externals).toContain('next/server')
  })
})
