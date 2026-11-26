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
 * null and the callers that still have a TypeScript rule keep it. A rule is asked only when the
 * build lists it in `kinds()`.
 *
 * LIST PERMISSIONS HAVE NO TYPESCRIPT RULE (ADEV-304). Until the door has installed `listAccess`
 * every permission check is refused, so the door's permission state is published
 * ({@link browserListPermissionsState}: pending → ready, or unavailable) and the app shell
 * (components/authenticated-app.tsx, through hooks/useBrowserCoreRules.ts) shows its loading
 * skeleton while it is pending, starting the load at mount rather than at idle. Unavailable (flag
 * off, the module failed, or a build without `listAccess`) draws the app read-only with a notice.
 *
 * The flag is NEXT_PUBLIC_ASTRID_CORE_RULES_BROWSER (./browser-flag.ts). Since ADEV-304 the door
 * loads unless it is "off", because the browser needs it for permissions.
 */

import { setBoardCore } from '@/lib/board-core-hook'
import { setListPermissionsCore } from '@/lib/list-permissions'
import { browserCoreRulesFlagOn } from './browser-flag'

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

export const BROWSER_CORE_RULES_ON = browserCoreRulesFlagOn()

/**
 * Whether the browser can answer list-permission questions (ADEV-304): `pending` until the door
 * has loaded, `ready` once it installed `listAccess`, `unavailable` when it never will (flag off,
 * the module failed to load, or the build does not answer `listAccess`). While it is not `ready`
 * every permission check is refused, so nothing should draw affordances from it while `pending`.
 */
export type ListPermissionsState = 'pending' | 'ready' | 'unavailable'

let permissionsState: ListPermissionsState = 'pending'
const permissionsListeners = new Set<() => void>()

function setPermissionsState(next: ListPermissionsState): void {
  if (permissionsState === next) return
  permissionsState = next
  for (const listener of permissionsListeners) listener()
}

/** The browser's list-permissions state; see {@link ListPermissionsState}. */
export function browserListPermissionsState(): ListPermissionsState {
  return permissionsState
}

/** Subscribe to {@link browserListPermissionsState} changes (useSyncExternalStore's shape). */
export function subscribeBrowserListPermissions(listener: () => void): () => void {
  permissionsListeners.add(listener)
  return () => {
    permissionsListeners.delete(listener)
  }
}

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
 * instantiate; never rejects. List permissions then stay refused, and their state says
 * `unavailable` so the page can say so.
 */
export function loadBrowserCoreRules(
  options: { enabled?: boolean; load?: () => Promise<Glue> } = {},
): Promise<BrowserCoreRules | null> {
  const { enabled = BROWSER_CORE_RULES_ON, load = importGlue } = options
  if (!enabled) {
    setPermissionsState('unavailable')
    return Promise.resolve(null)
  }
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
        // Permission affordances ask core listAccess (ADEV-90), and nothing else answers them
        // (ADEV-304). Lazy, like the door itself. Not a reason for the door's other rules to fail.
        try {
          const { installBrowserListPermissions } = await import('./browser-list-permissions')
          setPermissionsState(installBrowserListPermissions(loaded) ? 'ready' : 'unavailable')
        } catch {
          setPermissionsState('unavailable')
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
      .catch(() => {
        setPermissionsState('unavailable')
        return null
      })
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
  permissionsState = 'pending'
  permissionsListeners.clear()
  rowsCore = adapters.rows ?? null
  smartParseCore = adapters.smartParse ?? null
  setListPermissionsCore(null)
  setBoardCore(null)
}
