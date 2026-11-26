/**
 * lib/list-permissions.ts decided by astrid-core — the permissions cutover (AWTD-1061), phase 2 of
 * moving web onto the shared Rust core.
 *
 * On the Node runtime, every list-permission decision is put to astrid-core's `listAccess` rule
 * (the one the Apple apps use), with the list's project, status-list siblings and legacy
 * `admins` / `members` arrays when the caller loaded them, and the core's answer is returned.
 *
 * The TypeScript is the fail-safe: it is the answer whenever the core cannot give one (not loaded,
 * threw, sent an error envelope, or answered something that is not an answer). Never a wrong deny
 * or allow, never a crashed route. It is also still the browser's rule until the browser door
 * loads. Until AWTD-1591 it also ran on every decision to compare; AWTD-1591 sampled that, and
 * AWTD-1608 retired it (step A of docs/architecture/CORE_RULES_FALLBACK_RETIREMENT.md: no
 * disagreement and no failure in production), so a decision the core answers runs no TypeScript.
 * The permissions fixture parity test still holds the TypeScript to the core.
 *
 * `ASTRID_CORE_RULES` chooses the mode: unset (the default) decides with the core; `shadow` keeps
 * the TypeScript deciding and does not ask the core (the no-code rollback);
 * `off` loads nothing.
 */
import { createLogger } from '@/lib/logger'
import { setListPermissionsCore } from '@/lib/list-permissions'
import type { RetiredRuleStatus } from './core-asker'
import { loadCoreRules } from './wasm'
import {
  createListPermissionsCore,
  coreRulesModeFrom,
  type CoreRulesMode,
  type CoreStats,
} from './list-permissions-decider'

export * from './list-permissions-decider'


/** /api/health's block for a rule that is still compared (the Waiting lane, board drops). */
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
type StatusHost = { [STATUS_KEY]?: RetiredRuleStatus }

/** What instrumentation.ts installed in this process, for /api/health. `null` before it ran. */
export function listPermissionsCoreStatus(): RetiredRuleStatus | null {
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
  host[STATUS_KEY] = { mode, compare: 'retired', loaded: false, revision: null, stats: null }
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
        failure: (details) => log.error(details, 'list permissions: astrid-core could not answer; the TypeScript answer was used'),
        summary: (details) => log.info(details, 'list permissions: astrid-core totals'),
      },
      { revision: core.revision, mode },
    )
    setListPermissionsCore(decider.decide)
    host[STATUS_KEY] = { mode, compare: 'retired', loaded: true, revision: core.revision, stats: decider.stats }
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
