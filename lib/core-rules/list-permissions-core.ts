/**
 * lib/list-permissions.ts decided by astrid-core: the permissions cutover (AWTD-1061), phase 2 of
 * moving web onto the shared Rust core.
 *
 * On the Node runtime, every list-permission decision is put to astrid-core's `listAccess` rule
 * (the one the Apple apps use), with the list's project, status-list siblings and legacy
 * `admins` / `members` arrays when the caller loaded them, and the core's answer is returned.
 *
 * Step B (ADEV-304, docs/architecture/CORE_RULES_FALLBACK_RETIREMENT.md): the TypeScript rule is
 * deleted. A question the core cannot answer (threw, sent an error envelope, answered something
 * that is not an answer) is REFUSED, and counted in `stats.failed`. A core that does not load at
 * all would refuse every check, which is an unusable app that still answers 200; so
 * instrumentation.ts calls {@link assertListPermissionsCoreInstalled} and fails the boot instead,
 * and /api/health reports unhealthy if a process somehow serves without it.
 *
 * `ASTRID_CORE_RULES=shadow|off` no longer applies to list permissions: there is no TypeScript to
 * hand the decision to, so the core decides whatever the setting says (a warning is logged). The
 * rollback for a bad `listAccess` is a redeploy of an earlier build.
 */
import { createLogger } from '@/lib/logger'
import { listPermissionsCoreInstalled, setListPermissionsCore } from '@/lib/list-permissions'
import type { RetiredRuleStatus } from './core-asker'
import { loadCoreRules, type CoreRules } from './wasm'
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
  /** Whether packages/astrid-rules loaded. */
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
 * instrumentation.ts on the Node runtime at server start, and from the token-based stdio MCP
 * server. Returns whether the core is installed; never throws (the caller decides whether a
 * missing core is fatal: see {@link assertListPermissionsCoreInstalled}).
 */
export function installListPermissionsCore(
  setting: string | undefined = process.env.ASTRID_CORE_RULES,
  load: () => CoreRules | null = loadCoreRules,
): boolean {
  // Always decide: list permissions have no TypeScript rule to shadow with or switch off to.
  const mode: CoreRulesMode = 'decide'
  const host = globalThis as StatusHost
  host[STATUS_KEY] = { mode, compare: 'retired', loaded: false, revision: null, stats: null }
  setListPermissionsCore(null)
  const log = createLogger('core-rules')
  try {
    const requested = coreRulesModeFrom(setting)
    if (requested !== 'decide') {
      log.warn(
        { requested },
        'list permissions: ASTRID_CORE_RULES no longer applies to list permissions (ADEV-304); astrid-core decides',
      )
    }
    const core = load()
    if (!core) {
      log.error({ mode }, 'packages/astrid-rules did not load; every list permission check would be refused')
      return false
    }
    const decider = createListPermissionsCore(
      core.runJson,
      {
        failure: (details) => log.error(details, 'list permissions: astrid-core could not answer; the check was refused'),
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
      log.error({ err: error, mode }, 'list permissions: astrid-core install failed; every list permission check would be refused')
    } catch {
      // Logging must not throw from here.
    }
    return false
  }
}

/**
 * Throw unless astrid-core is installed as the list-permissions decider in this process.
 *
 * instrumentation.ts calls this after {@link installListPermissionsCore}, so a build whose core
 * does not load fails at boot (every request 500s, /api/health included, so the deployment
 * workflow's health check goes red) rather than serving an app in which every permission check is
 * refused.
 */
export function assertListPermissionsCoreInstalled(): void {
  if (listPermissionsCoreStatus()?.loaded !== true || !listPermissionsCoreInstalled()) {
    throw new Error(
      'astrid-core (packages/astrid-rules) is not installed for list permissions. There is no TypeScript fallback since ADEV-304, so every permission check would be refused. Check that packages/astrid-rules/node and REVISION reach the server (next.config.mjs outputFileTracingIncludes).',
    )
  }
}
