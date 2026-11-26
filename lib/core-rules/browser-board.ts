/**
 * The board's columns ask astrid-core's `board` rule in the browser once the door has loaded
 * (ADEV-307, step B of docs/architecture/CORE_RULES_FALLBACK_RETIREMENT.md): ProjectBoard, the
 * task-detail menus and the rest call `getProjectBoardColumns` / `boardColumnsFor`, which put the
 * question to the hook installed here. The TypeScript stays the answer until the door has loaded
 * and whenever the core cannot answer.
 *
 * Drops (`boardMove`) are not installed: they stay TypeScript in the browser until they have a
 * server caller (AWTD-1608). The hook's `move` declines, so `columnMoveThroughCore` falls back.
 *
 * Its own module so ./browser.ts can import it lazily, after first paint: it is not part of any
 * route's first-load JS.
 */
import { setBoardCore } from '@/lib/board-core-hook'
import { createLogger } from '@/lib/logger'
import { createBoardCore } from './board-decider'

export function installBrowserBoard(door: {
  runJson(request: string): string
  answers(kind: string): boolean
}): boolean {
  if (!door.answers('board')) return false
  const log = createLogger('core-rules-browser')
  const hook = createBoardCore(
    door.runJson,
    {
      disagreement: () => {},
      failure: (details) => log.error(details, 'board: astrid-core could not answer; the TypeScript answer was used'),
    },
    { mode: 'decide' },
  )
  setBoardCore({ columns: hook.columns, move: () => undefined })
  return true
}
