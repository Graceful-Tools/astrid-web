/**
 * The project board decided by astrid-core (AWTD-1585): its columns, and what a drop on one writes.
 *
 * On the Node runtime, lib/project-status.ts's `getProjectBoardColumns` / `resolveProjectColumnMove`
 * and lib/task-status.ts's `boardColumnsFor` / `resolveColumnMove` put the question to astrid-core's
 * `board` and `boardMove` rules (through lib/board-core-hook.ts) and return the core's answer. The
 * TypeScript answers too, for the same two reasons as the other cutovers (list-permissions-core.ts):
 *
 * - **Fail-safe.** Its answer is returned whenever the core cannot give one: not loaded, threw, sent
 *   an error envelope, or answered something that is not an answer.
 * - **Comparison.** The browser draws the board with the same TypeScript (it cannot load this
 *   WebAssembly), so a disagreement is a column the browser draws that the server would not, or a
 *   drop the two would write differently. It is logged once per distinct shape — which fields
 *   differed, how many custom columns, the kind of column dropped on. Never a column's name or
 *   role (both are words a person typed), a task or list id.
 *
 * Today the server's only caller is list insights (`getProjectBoardColumns`); the other three run
 * in the browser, so on the server they are routed but idle until a server path calls them.
 *
 * The same `ASTRID_CORE_RULES` setting chooses the mode for every rule: unset decides with the core,
 * `shadow` keeps the TypeScript deciding and only compares, `off` loads nothing.
 */
import { createLogger } from '@/lib/logger'
import {
  VIRTUAL_DONE_COLUMN_ID,
  VIRTUAL_INBOX_COLUMN_ID,
  setBoardCore,
  type CoreBoardColumn,
  type CoreColumnMove,
  type CoreMoveQuestion,
} from '@/lib/board-core-hook'
import { coreRulesModeFrom, type CoreRulesMode, type CoreRulesStatus, type CoreStats } from './list-permissions-core'
import { loadCoreRules } from './wasm'

interface Reporter {
  disagreement(details: Record<string, unknown>): void
  failure(details: Record<string, unknown>): void
}

/** Distinct disagreements logged per process, at most. */
const MAX_LOGGED = 50

const DEFAULT_ROLES = new Set(['ready', 'doing', 'waiting'])
const KINDS = new Set(['inbox', 'status', 'done'])

const isString = (value: unknown): value is string => typeof value === 'string'

function isColumn(value: unknown): value is CoreBoardColumn {
  if (!value || typeof value !== 'object') return false
  const column = value as Record<string, unknown>
  return isString(column.id) && isString(column.name) && isString(column.description) && KINDS.has(column.kind as string)
}

function isMove(value: unknown): value is CoreColumnMove {
  if (!value || typeof value !== 'object') return false
  const move = value as Record<string, unknown>
  return (
    Array.isArray(move.listIds) &&
    move.listIds.every(isString) &&
    typeof move.completed === 'boolean' &&
    (move.statusRole === null || isString(move.statusRole))
  )
}

/** How many entries a `customStates` value has — the only thing about it a log may say. */
const customCount = (customStates: unknown) => (Array.isArray(customStates) ? customStates.length : null)

/** The kind of column dropped on, from a fixed vocabulary: never a custom role, which a person named. */
function targetOf(column: CoreMoveQuestion['column']): string {
  if (column.kind !== 'status') return column.kind
  return DEFAULT_ROLES.has(column.id) ? column.id : 'custom'
}

/** Which parts of two column lists differ, from a fixed vocabulary. */
function differingColumns(a: CoreBoardColumn[], b: CoreBoardColumn[]): string[] {
  if (a.length !== b.length) return ['count']
  const fields = (['id', 'name', 'description', 'kind'] as const).filter((field) =>
    a.some((column, index) => column[field] !== b[index][field]),
  )
  return fields
}

function differingMove(a: CoreColumnMove, b: CoreColumnMove): string[] {
  const differing: string[] = []
  if (a.completed !== b.completed) differing.push('completed')
  if (a.statusRole !== b.statusRole) differing.push('statusRole')
  if (a.listIds.length !== b.listIds.length || a.listIds.some((id, index) => id !== b.listIds[index])) {
    differing.push('listIds')
  }
  return differing
}

/**
 * The `boardMove` request for one drop, or why the core is not asked.
 *
 * The callers have the column, not always the board's `customStates`, so a board is described that
 * holds exactly that column: none for Inbox, Done or a default role, a one-entry `customStates`
 * for a custom role. The core trims a role, so a role it would read differently is not asked.
 */
export function moveRequestFor(question: CoreMoveQuestion): { request: object } | { skip: string } {
  const { id, kind } = question.column
  if (kind === 'inbox' && id !== VIRTUAL_INBOX_COLUMN_ID) return { skip: 'inbox-id' }
  if (kind === 'done' && id !== VIRTUAL_DONE_COLUMN_ID) return { skip: 'done-id' }
  if (kind === 'status' && (!id || id !== id.trim() || id === VIRTUAL_INBOX_COLUMN_ID || id === VIRTUAL_DONE_COLUMN_ID)) {
    return { skip: 'status-id' }
  }
  const custom = kind === 'status' && !DEFAULT_ROLES.has(id)
  return {
    request: {
      kind: 'boardMove',
      task: {
        id: 'card',
        completed: question.task.completed,
        statusRole: question.task.statusRole,
        listIds: question.task.listIds,
      },
      column: id,
      customStates: custom ? [{ role: id, name: id, order: 0 }] : null,
      lists: question.lists.map((list) => ({
        id: list.id,
        name: list.id,
        listType: list.listType ?? null,
        projectId: list.projectId ?? null,
      })),
    },
  }
}

/**
 * A {@link setBoardCore} hook backed by `runJson` (astrid-core `rules::run_json`). In `decide` mode
 * it returns the core's answers; in `shadow` mode `undefined`, so the TypeScript decides. A core
 * that THROWS is switched off for the rest of the process, as for permissions.
 */
export function createBoardCore(
  runJson: (request: string) => string,
  report: Reporter,
  {
    revision = 'unknown',
    mode = 'decide',
    now = () => new Date(),
  }: { revision?: string; mode?: Exclude<CoreRulesMode, 'off'>; now?: () => Date } = {},
) {
  const stats: CoreStats = { agreed: 0, disagreed: 0, skipped: 0, failed: 0 }
  const logged = new Set<string>()
  let failureLogged = false
  let tripped = false

  function fail(rule: string, error: unknown): undefined {
    stats.failed++
    if (!failureLogged) {
      failureLogged = true
      try {
        report.failure({ rule, revision, mode, tripped, error: String(error) })
      } catch {
        // A reporter that throws must not change an answer.
      }
    }
    return undefined
  }

  /** Run one request; the reply's `value`, or `undefined` after recording the failure. */
  function ask(rule: string, request: object): unknown {
    let raw: string
    try {
      raw = runJson(JSON.stringify(request))
    } catch (error) {
      tripped = true
      return fail(rule, error)
    }
    try {
      const reply = JSON.parse(raw) as { ok: boolean; value?: unknown; error?: { kind?: string } }
      if (!reply.ok || reply.value === undefined) throw new Error(`core answered ${reply.error?.kind ?? 'no value'}`)
      return reply.value
    } catch (error) {
      return fail(rule, error)
    }
  }

  function compare<T>(rule: string, core: T, differing: string[], shape: Record<string, unknown>): T | undefined {
    if (differing.length === 0) {
      stats.agreed++
    } else {
      stats.disagreed++
      try {
        const details = { rule, differing, ...shape }
        const signature = JSON.stringify(details)
        if (logged.size < MAX_LOGGED && !logged.has(signature)) {
          logged.add(signature)
          report.disagreement({ ...details, revision, mode, returned: mode === 'decide' ? 'core' : 'typescript', stats: { ...stats } })
        }
      } catch {
        // Reporting must never change an answer.
      }
    }
    return mode === 'decide' ? core : undefined
  }

  function columns(customStates: unknown, typescriptAnswer: CoreBoardColumn[]): CoreBoardColumn[] | undefined {
    if (tripped) return fail('board', 'core switched off after it threw')
    let request: object
    try {
      // Columns only: no cards are asked about, so none are sent. A value that cannot be sent as
      // JSON (it came from a JSON column, so it should not happen) is a failure, not a throw.
      request = { kind: 'board', projectId: 'board', customStates: customStates ?? null, tasks: [], lists: [], now: now().toISOString() }
      JSON.stringify(request)
    } catch (error) {
      return fail('board', error)
    }
    const value = ask('board', request)
    if (value === undefined) return undefined
    if (!Array.isArray(value) || !value.every(isColumn)) return fail('board', 'core answered something that is not columns')
    const core = value.map(({ id, name, description, kind }) => ({ id, name, description, kind }))
    return compare('board', core, differingColumns(core, typescriptAnswer), { customCount: customCount(customStates) })
  }

  function move(question: CoreMoveQuestion, typescriptAnswer: CoreColumnMove): CoreColumnMove | undefined {
    if (tripped) return fail('boardMove', 'core switched off after it threw')
    let built: ReturnType<typeof moveRequestFor>
    try {
      built = moveRequestFor(question)
    } catch (error) {
      return fail('boardMove', error)
    }
    if ('skip' in built) {
      stats.skipped++
      return undefined
    }
    const value = ask('boardMove', built.request)
    if (value === undefined) return undefined
    if (!isMove(value)) return fail('boardMove', 'core answered something that is not a move')
    const core = { listIds: [...value.listIds], completed: value.completed, statusRole: value.statusRole }
    return compare('boardMove', core, differingMove(core, typescriptAnswer), {
      target: targetOf(question.column),
      from: question.task.completed ? 'done' : question.task.statusRole ? 'status' : 'inbox',
      statusMemberships: question.lists.some((list) => list.listType === 'status' && question.task.listIds.includes(list.id)),
    })
  }

  return { columns, move, stats }
}

const STATUS_KEY = Symbol.for('astrid.board.coreStatus')
type StatusHost = { [STATUS_KEY]?: CoreRulesStatus }

/** What instrumentation.ts installed in this process, for /api/health. `null` before it ran. */
export function boardCoreStatus(): CoreRulesStatus | null {
  const status = (globalThis as StatusHost)[STATUS_KEY]
  return status ? { ...status, stats: status.stats ? { ...status.stats } : null } : null
}

/**
 * Load the vendored core and install it behind lib/board-core-hook.ts. Called from
 * instrumentation.ts on the Node runtime. Returns whether the core is installed; never throws.
 */
export function installBoardCore(setting: string | undefined = process.env.ASTRID_CORE_RULES): boolean {
  const mode = coreRulesModeFrom(setting)
  const host = globalThis as StatusHost
  host[STATUS_KEY] = { mode, loaded: false, revision: null, stats: null }
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
      { revision: core.revision, mode },
    )
    setBoardCore({ columns: hook.columns, move: hook.move })
    host[STATUS_KEY] = { mode, loaded: true, revision: core.revision, stats: hook.stats }
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
