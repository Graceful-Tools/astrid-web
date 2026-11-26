/**
 * The project board decided by astrid-core on the server (AWTD-1585): installs the decider in
 * ./board-decider.ts behind lib/board-core-hook.ts on the Node runtime. The decider is its own
 * module, free of Node imports, so the browser's installer (./browser-board.ts, ADEV-307) can
 * share it; this file loads the vendored WebAssembly (./wasm, `node:fs`) and keeps /api/health's
 * status, so it must never be imported by client code.
 *
 * The same `ASTRID_CORE_RULES` setting chooses the mode for every rule: unset decides with the core,
 * `shadow` keeps the TypeScript deciding (drops are still compared, columns not asked), `off`
 * loads nothing.
 */
import { createLogger } from '@/lib/logger'
import { setBoardCore } from '@/lib/board-core-hook'
import { coreRulesModeFrom } from './list-permissions-core'
import { createBoardCore, type BoardCoreStatus } from './board-decider'
import { sampleEveryFrom } from './sampling'
import { loadCoreRules } from './wasm'

export { createBoardCore, moveRequestFor, type BoardCoreStatus, type BoardStats } from './board-decider'

const COMPARE = { columns: 'retired', drops: 'sampled' } as const

const STATUS_KEY = Symbol.for('astrid.board.coreStatus')
type StatusHost = { [STATUS_KEY]?: BoardCoreStatus }

/** What instrumentation.ts installed in this process, for /api/health. `null` before it ran. */
export function boardCoreStatus(): BoardCoreStatus | null {
  const status = (globalThis as StatusHost)[STATUS_KEY]
  if (!status) return null
  const stats = status.stats ? { columns: { ...status.stats.columns }, drops: { ...status.stats.drops } } : null
  return { ...status, compare: { ...status.compare }, stats }
}

/**
 * Load the vendored core and install it behind lib/board-core-hook.ts. Called from
 * instrumentation.ts on the Node runtime. Returns whether the core is installed; never throws.
 */
export function installBoardCore(setting: string | undefined = process.env.ASTRID_CORE_RULES): boolean {
  const mode = coreRulesModeFrom(setting)
  const host = globalThis as StatusHost
  const sampleEvery = sampleEveryFrom()
  host[STATUS_KEY] = { mode, compare: COMPARE, sampleEvery, loaded: false, revision: null, stats: null }
  if (mode === 'off') {
    setBoardCore(null)
    return false
  }
  const log = createLogger('core-rules')
  try {
    const core = loadCoreRules()
    if (!core) {
      log.error({ mode }, 'packages/astrid-rules did not load; the board is decided by the TypeScript')
      return false
    }
    const hook = createBoardCore(
      core.runJson,
      {
        disagreement: (details) => log.warn(details, 'board: astrid-core and the TypeScript disagree'),
        failure: (details) => log.error(details, 'board: astrid-core could not answer; the TypeScript answer was used'),
      },
      { revision: core.revision, mode, sampleEvery },
    )
    setBoardCore({ columns: hook.columns, move: hook.move })
    host[STATUS_KEY] = { mode, compare: COMPARE, sampleEvery, loaded: true, revision: core.revision, stats: hook.stats }
    log.info({ revision: core.revision, mode }, 'board: astrid-core installed')
    return true
  } catch (error) {
    setBoardCore(null)
    try {
      log.error({ err: error, mode }, 'board: astrid-core install failed; the TypeScript decides')
    } catch {
      // Never fatal.
    }
    return false
  }
}
