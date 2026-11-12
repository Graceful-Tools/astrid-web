/**
 * RULE — AWTD-1604: the [locale] layout's background work stays out of first-load JS.
 *
 * Every [locale] page loads components/providers.tsx and the two error boundaries. Static
 * imports there used to carry the offline database (Dexie), the cache and sync managers,
 * the SSE manager, pino and Radix Toast into EVERY page — about 70 KiB gzipped of code
 * that draws nothing on first paint. Measured with `npm run check:bundle`: the leanest
 * page went 258.4 → 189.8 KiB when they moved behind next/dynamic.
 *
 * Checked as a grep because the regression is textual: one static `import` line puts the
 * whole graph back, and the bundle ceiling (which tracks the HEAVIEST route) would not
 * notice, since the TaskManager pages import most of it anyway.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')

/** `import ... from '<module>'` at the top level, not `import('<module>')`. */
function staticallyImports(source: string, specifier: string): boolean {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^import\\s[^;]*?from\\s+['"]${escaped}['"]`, 'm').test(source)
}

describe('AWTD-1604: background work in the [locale] layout loads after hydration', () => {
  it('components/providers.tsx does not statically import the sync, SSE, banner or toast modules', () => {
    const providers = read('components/providers.tsx')
    for (const specifier of [
      '@/components/offline-provider',
      '@/components/coding-workflow-provider',
      '@/components/ui/toaster',
      '@/lib/offline-sync',
      '@/lib/data-sync',
      '@/lib/cache-manager',
      '@/lib/sse-manager',
      '@/hooks/use-sse-subscription',
    ]) {
      expect(staticallyImports(providers, specifier), `providers.tsx statically imports ${specifier}`).toBe(false)
    }
  })

  it('the offline banner stays eager but loads the offline queue on demand', () => {
    expect(staticallyImports(read('components/pwa-status.tsx'), '@/lib/offline-sync')).toBe(false)
  })

  it('the feature-flag provider loads its SSE listener lazily', () => {
    const context = read('contexts/feature-flag-context.tsx')
    expect(staticallyImports(context, '@/hooks/use-sse-subscription')).toBe(false)
    expect(staticallyImports(context, '@/lib/sse-manager')).toBe(false)
  })

  it('the error boundaries load the logger only when they catch something', () => {
    for (const file of ['app/global-error.tsx', 'app/[locale]/error.tsx']) {
      expect(staticallyImports(read(file), '@/lib/logger'), `${file} statically imports pino`).toBe(false)
    }
  })
})
