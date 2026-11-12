/**
 * Where astrid-core's board rules plug into the TypeScript ones (AWTD-1585).
 *
 * lib/project-status.ts (`getProjectBoardColumns`, `resolveProjectColumnMove`) and
 * lib/task-status.ts (`boardColumnsFor`, `resolveColumnMove`) compute the board's columns and what
 * a drop writes. On the Node runtime, instrumentation.ts installs lib/core-rules/board-core.ts
 * here, and those four functions put the question to astrid-core's `board` / `boardMove` rules —
 * the ones the Apple apps and Astrid Code use — and return its answer. In the browser, in the edge
 * runtime and whenever the core cannot answer, nothing is installed or the hook declines, and the
 * TypeScript answer stands.
 *
 * Kept apart from both rule files so neither has to import the other's internals, and so this file
 * imports nothing but lib/lazy-value.ts: it is reachable from client components.
 *
 * Column ids here are the core's (and lib/project-status.ts's): the virtual columns are
 * `__virtual_inbox__` / `__virtual_done__`. lib/task-status.ts names them `__inbox__` / `__done__`
 * and translates at its edge.
 */

import { lazyValue } from '@/lib/lazy-value'

/** astrid-core's id for the virtual Inbox column (board.rs `VIRTUAL_INBOX_COLUMN_ID`). */
export const VIRTUAL_INBOX_COLUMN_ID = '__virtual_inbox__'
/** astrid-core's id for the virtual Done column (board.rs `VIRTUAL_DONE_COLUMN_ID`). */
export const VIRTUAL_DONE_COLUMN_ID = '__virtual_done__'

export type CoreBoardColumnKind = 'inbox' | 'status' | 'done'

export interface CoreBoardColumn {
  id: string
  name: string
  description: string
  kind: CoreBoardColumnKind
}

export interface CoreColumnMove {
  listIds: string[]
  completed: boolean
  statusRole: string | null
}

/** One drop, as the core's `boardMove` reads it. */
export interface CoreMoveQuestion {
  task: { completed: boolean; statusRole: string | null; listIds: string[] }
  /** The column dropped on, in the core's id space. */
  column: Pick<CoreBoardColumn, 'id' | 'kind'>
  /** The lists the caller knows, so a leftover `listType: 'status'` membership can be shed. */
  lists: Array<{ id: string; listType?: string | null; projectId?: string | null }>
}

/**
 * The installed core. Each method returns its answer, or `undefined` to leave the TypeScript's
 * answer standing (shadow mode, or the core could not answer). The TypeScript answer is a getter,
 * computed at most once and only when asked for: for a fallback or a sampled comparison
 * (AWTD-1591).
 */
export interface BoardCore {
  columns(customStates: unknown, typescriptAnswer: () => CoreBoardColumn[]): CoreBoardColumn[] | undefined
  move(question: CoreMoveQuestion, typescriptAnswer: () => CoreColumnMove): CoreColumnMove | undefined
}

// On globalThis, as with the other core hooks: Next compiles this module into several layers, each
// with its own module state, and the core is installed once from instrumentation.ts.
const CORE_KEY = Symbol.for('astrid.board.core')
type CoreHost = { [CORE_KEY]?: BoardCore | null }

/** Install (or, with `null`, remove) astrid-core's board rules behind the TypeScript ones. */
export function setBoardCore(core: BoardCore | null): void {
  ;(globalThis as CoreHost)[CORE_KEY] = core
}

const installed = (): BoardCore | null | undefined => (globalThis as CoreHost)[CORE_KEY]

/** The board's columns: the core's answer when one is installed and answers, else the TypeScript's. */
export function boardColumnsThroughCore(customStates: unknown, computeTypescript: () => CoreBoardColumn[]): CoreBoardColumn[] {
  const core = installed()
  if (!core) return computeTypescript()
  const typescriptAnswer = lazyValue(computeTypescript)
  try {
    return core.columns(customStates, typescriptAnswer) ?? typescriptAnswer()
  } catch {
    // A hook that throws must not take a board down; the TypeScript answer stands.
    return typescriptAnswer()
  }
}

/** What a drop writes: the core's answer when one is installed and answers, else the TypeScript's. */
export function columnMoveThroughCore(question: CoreMoveQuestion, computeTypescript: () => CoreColumnMove): CoreColumnMove {
  const core = installed()
  if (!core) return computeTypescript()
  const typescriptAnswer = lazyValue(computeTypescript)
  try {
    return core.move(question, typescriptAnswer) ?? typescriptAnswer()
  } catch {
    return typescriptAnswer()
  }
}
