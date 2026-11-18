/**
 * lib/list-permissions.ts decided by astrid-core — the permissions cutover (AWTD-1061), phase 2 of
 * moving web onto the shared Rust core.
 *
 * On the Node runtime, every list-permission decision is put to astrid-core's `listAccess` rule
 * (the one the Apple apps use), with the list's project, status-list siblings and legacy
 * `admins` / `members` arrays when the caller loaded them, and the core's answer is returned.
 *
 * The TypeScript still answers, for two reasons — on every decision until AWTD-1591, now on a
 * sample of 1 in `ASTRID_CORE_RULES_SAMPLE` (lib/core-rules/sampling.ts) and on every fallback:
 *
 * - **Fail-safe.** It is the answer whenever the core cannot give one: not loaded, threw, sent an
 *   error envelope, or answered with something that is not an answer. Never a wrong deny or
 *   allow, never a crashed route.
 * - **The comparison still adds information.** The browser decides with the same TypeScript (it
 *   cannot load this WebAssembly), so a disagreement is a control the browser offers and the
 *   server refuses, or the reverse. It is logged once per distinct shape, with no ids, names or
 *   emails, and with running totals so a quiet log can be read as agreement.
 *
 * `ASTRID_CORE_RULES` chooses the mode: unset (the default) decides with the core; `shadow` keeps
 * the TypeScript deciding and only compares (PR #320's behaviour — the no-code rollback);
 * `off` loads nothing.
 */
import { createLogger } from '@/lib/logger'
import { setListPermissionsCore } from '@/lib/list-permissions'
import { sampleEveryFrom } from './sampling'
import { loadCoreRules } from './wasm'
import {
  createListPermissionsCore,
  coreRulesModeFrom,
  type CoreRulesMode,
  type CoreStats,
} from './list-permissions-decider'

export * from './list-permissions-decider'


export interface CoreRulesStatus {
  mode: CoreRulesMode
  /** 1 decision in this many is compared (`ASTRID_CORE_RULES_SAMPLE`; lib/core-rules/sampling.ts). */
  sampleEvery: number
  /** Whether packages/astrid-rules loaded. False with mode `decide` means the TypeScript decides. */
  loaded: boolean
  revision: string | null
  stats: CoreStats | null
}

// On globalThis for the same reason as the decider itself: /api/health is compiled into a
// different layer from instrumentation.ts, which installs this.
const STATUS_KEY = Symbol.for('astrid.listPermissions.coreStatus')
type StatusHost = { [STATUS_KEY]?: CoreRulesStatus }

/** What instrumentation.ts installed in this process, for /api/health. `null` before it ran. */
export function listPermissionsCoreStatus(): CoreRulesStatus | null {
  const status = (globalThis as StatusHost)[STATUS_KEY]
  return status ? { ...status, stats: status.stats ? { ...status.stats } : null } : null
}

/**
 * Load the vendored core and install it as the decider for lib/list-permissions.ts. Called from
 * instrumentation.ts on the Node runtime at server start. Returns whether the core is installed;
 * never throws. When the core does not load, nothing is installed — the TypeScript decides — and
 * that is logged once, as an error, because it means the cutover is not in effect.
 */
export function installListPermissionsCore(setting: string | undefined = process.env.ASTRID_CORE_RULES): boolean {
  const mode = coreRulesModeFrom(setting)
  const host = globalThis as StatusHost
  const sampleEvery = sampleEveryFrom()
  host[STATUS_KEY] = { mode, sampleEvery, loaded: false, revision: null, stats: null }
  if (mode === 'off') {
    setListPermissionsCore(null)
    return false
  }
  const log = createLogger('core-rules')
  try {
    const core = loadCoreRules()
    if (!core) {
      log.error({ mode }, 'packages/astrid-rules did not load; list permissions are decided by the TypeScript rules')
      return false
    }
    const decider = createListPermissionsCore(
      core.runJson,
      {
        disagreement: (details) => log.warn(details, 'list permissions: astrid-core and the TypeScript rules disagree'),
        failure: (details) => log.error(details, 'list permissions: astrid-core could not answer; the TypeScript answer was used'),
        summary: (details) => log.info(details, 'list permissions: astrid-core totals'),
      },
      { revision: core.revision, mode, sampleEvery },
    )
    setListPermissionsCore(decider.decide)
    host[STATUS_KEY] = { mode, sampleEvery, loaded: true, revision: core.revision, stats: decider.stats }
    log.info({ revision: core.revision, mode }, 'list permissions: astrid-core installed')
    return true
  } catch (error) {
    setListPermissionsCore(null)
    try {
      log.error({ err: error, mode }, 'list permissions: astrid-core install failed; the TypeScript rules decide')
    } catch {
      // Never fatal.
    }
    return false
  }
}
