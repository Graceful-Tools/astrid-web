/**
 * Resolve a loop's board by NAME (AWTD-1267).
 *
 * A board id is account data. A hardcoded or stale one fails silently by
 * returning an empty board, which reads exactly like "nothing to do" — so the
 * loops name their board and look the id up on every run, and a name that is
 * not on the account is an error, never an empty result.
 *
 * Shared by `ready-tasks.ts` and `release-stuck-doing.ts` so the two cannot
 * drift about which board `windows` means. astrid-windows keeps no list id at
 * all; this is how its loop reaches the start-of-tick Doing release.
 */
import { READY_QUEUE_BOARDS, type ReadyQueueBoard } from '@/lib/ready-queue-scope'

export const BOARD_LIST_NAMES: Record<ReadyQueueBoard, string> = {
  web: 'Astrid Web To-do',
  ios: 'Astrid iOS To-do',
  windows: 'Astrid Windows To-do',
  android: 'Astrid Android To-do',
}

type BoardList = { id: string; name?: string }

/** Pick the board out of a `GET /api/v1/lists` body, or throw. */
export function findBoardList(listsBody: unknown, board: ReadyQueueBoard): BoardList {
  const name = BOARD_LIST_NAMES[board]
  const lists = (listsBody as { lists?: unknown })?.lists ?? listsBody
  const matches = (Array.isArray(lists) ? lists : []).filter(
    (list: { name?: string }) => list?.name === name,
  ) as BoardList[]
  if (matches.length > 1) throw new Error(`Multiple lists named "${name}" found — pass an explicit --list id.`)
  const found = matches[0]
  if (!found) throw new Error(`No list named "${name}" found — refusing to run unscoped.`)
  return found
}

export async function resolveBoardListId(options: {
  board: ReadyQueueBoard
  auth: Record<string, string>
  origin: string
  fetchImpl?: typeof fetch
}): Promise<string> {
  const { board, auth, origin, fetchImpl = fetch } = options
  const response = await fetchImpl(`${origin}/api/v1/lists`, { headers: auth })
  if (!response.ok) {
    throw new Error(`Could not read lists to find "${BOARD_LIST_NAMES[board]}" — HTTP ${response.status}`)
  }
  return findBoardList(await response.json(), board).id
}

export type BoardTarget =
  | { kind: 'list'; listId: string }
  | { kind: 'board'; board: ReadyQueueBoard }

/**
 * `--list <id>` or `--board <name>`, at most one. Neither is `null`: no board
 * pass, which the caller may or may not accept.
 */
export function parseBoardTarget(args: { list?: string; board?: string }): BoardTarget | null {
  if (args.list && args.board) throw new Error('Pass --list <listId> or --board <name>, not both.')
  if (args.list) return { kind: 'list', listId: args.list }
  if (args.board === undefined) return null
  if (!READY_QUEUE_BOARDS.includes(args.board as ReadyQueueBoard)) {
    throw new Error(`Unknown board "${args.board}". Expected one of: ${READY_QUEUE_BOARDS.join(', ')}`)
  }
  return { kind: 'board', board: args.board as ReadyQueueBoard }
}
