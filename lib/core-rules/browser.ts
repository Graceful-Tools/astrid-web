/**
 * astrid-core's rules door in the browser (AWTD-1586).
 *
 * packages/astrid-rules/web/ is core's browser build: the same `runJson` door as the Node package
 * in ./wasm.ts, compiled with only the rules web's client code calls (astrid-core
 * docs/BROWSER_DOOR.md). It is ~187 KB brotli, a size Jon accepted on 2026-11-17, and it never
 * sits on the first-load path: nothing imports it until `scheduleBrowserCoreRules` runs after
 * the page has painted, and the glue's `new URL(…wasm, import.meta.url)` makes the bundler emit
 * the .wasm as a hashed asset of that lazy chunk.
 *
 * Until it has loaded, if it fails to load, or while the flag is off, `browserCoreRules()` is
 * null and every caller keeps its TypeScript rule. A rule is asked only when the build lists it in
 * `kinds()`, so a build that dropped a rule is a fallback, never a refusal on screen.
 *
 * The flag is NEXT_PUBLIC_ASTRID_CORE_RULES_BROWSER, "on" to load; anything else, unset
 * included, leaves the browser exactly as it was. Like every NEXT_PUBLIC_ value it is read
 * literally so Next can inline it (lib/env.ts).
 */

import { setBoardCore } from '@/lib/board-core-hook'
import { setListPermissionsCore } from '@/lib/list-permissions'

export interface BrowserCoreRules {
  /** astrid-core `rules::run_json`: one JSON request in, one `{ ok, value?, error? }` out. */
  runJson(request: string): string
  /** The rule kinds this build answers. */
  answers(kind: string): boolean
}

interface Glue {
  default: (init?: unknown) => Promise<unknown>
  runJson(request: string): string
  kinds(): string[]
}

export const BROWSER_CORE_RULES_ON = process.env.NEXT_PUBLIC_ASTRID_CORE_RULES_BROWSER === 'on'

const importGlue = () => import('../../packages/astrid-rules/web/astrid_rules_wasm.js') as Promise<Glue>

type RowsCore = typeof import('./rows-core')
type SmartParseCore = typeof import('./smart-parse-core')

let loaded: BrowserCoreRules | null = null
let loading: Promise<BrowserCoreRules | null> | null = null
// The saved-view rows adapter (AWTD-1663) rides in the same lazy load as the door, so it costs the
// first load nothing: it is only ever used once the door is there.
let rowsCore: RowsCore | null = null
let smartParseCore: SmartParseCore | null = null

/** The saved-view rows adapter, once the door has loaded; null before. */
export function browserRowsCore(): RowsCore | null {
  return loaded ? rowsCore : null
}

/** Quick-add's smartParse adapter, once the door has loaded; null before. */
export function browserSmartParseCore(): SmartParseCore | null {
  return loaded ? smartParseCore : null
}

/** The loaded door, or null while it is off, loading or failed. Never throws. */
export function browserCoreRules(): BrowserCoreRules | null {
  return loaded
}

/**
 * Load the door once. Resolves null when the flag is off or the module fails to load or
 * instantiate; never rejects, because every caller has a TypeScript rule to fall back to.
 */
export function loadBrowserCoreRules(
  options: { enabled?: boolean; load?: () => Promise<Glue> } = {},
): Promise<BrowserCoreRules | null> {
  const { enabled = BROWSER_CORE_RULES_ON, load = importGlue } = options
  if (!enabled) return Promise.resolve(null)
  if (!loading) {
    loading = load()
      .then(async (glue) => {
        await glue.default()
        // The adapters ride in the same lazy load, so they cost the first load nothing.
        ;[rowsCore, smartParseCore] = await Promise.all([
          import('./rows-core').catch(() => null),
          import('./smart-parse-core').catch(() => null),
        ])
        const kinds = new Set(glue.kinds())
        loaded = { runJson: (request) => glue.runJson(request), answers: (kind) => kinds.has(kind) }
        // Permission affordances ask core listAccess too (ADEV-90). Lazy, like the door itself,
        // and never a reason for the load to fail: the TypeScript decides without it.
        try {
          const { installBrowserListPermissions } = await import('./browser-list-permissions')
          installBrowserListPermissions(loaded)
        } catch {
          // keep the TypeScript rules
        }
        // The board's columns too (ADEV-307): same lazy load, same fallback.
        try {
          const { installBrowserBoard } = await import('./browser-board')
          installBrowserBoard(loaded)
        } catch {
          // keep the TypeScript rules
        }
        return loaded
      })
      .catch(() => null)
  }
  return loading
}

/**
 * Start loading once the browser is idle after first paint. Returns the cancel for an effect
 * cleanup. A no-op while the flag is off, so the lazy chunk is never even requested.
 */
export function scheduleBrowserCoreRules(enabled = BROWSER_CORE_RULES_ON): () => void {
  if (!enabled || typeof window === 'undefined') return () => {}
  const start = () => void loadBrowserCoreRules({ enabled })
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(start)
    return () => window.cancelIdleCallback(id)
  }
  const id = window.setTimeout(start, 2000)
  return () => window.clearTimeout(id)
}

/** Tests only: forget the loaded door. */
export function resetBrowserCoreRulesForTests(
  door: BrowserCoreRules | null = null,
  adapters: { rows?: RowsCore | null; smartParse?: SmartParseCore | null } = {},
): void {
  loaded = door
  loading = null
  rowsCore = adapters.rows ?? null
  smartParseCore = adapters.smartParse ?? null
  setListPermissionsCore(null)
  setBoardCore(null)
}
