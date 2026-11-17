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
// The name lookup and the --list/--board rule are the SDK's (ADEV-83): `astrid-agent queue --board`
// resolves a board the same way, and two copies would drift about which board `windows` means.
import { BOARD_LIST_NAMES, findBoardList, parseBoardTarget, type BoardTarget } from '../../packages/astrid-sdk/src/board'

export { BOARD_LIST_NAMES, findBoardList, parseBoardTarget, type BoardTarget }

/**
 * The checkouts each board's workflow can touch, its own repo first (AWTD-1510).
 *
 * A Windows [core] task — a rule, a service, the Outbox, sync — is fixed in the
 * astrid-core checkout beside astrid-windows (astrid-windows CLAUDE.md), so its
 * branch lives there. A Doing release that searched only the board's own repo told
 * the next run such a task "starts fresh". Names are repo names (origin's last path
 * segment); the others are looked for as siblings of the loop's own checkout, which
 * is where astrid-windows' fixall-loop.ps1 looks for `$CoreRepo`.
 */
export const BOARD_CHECKOUTS: Record<ReadyQueueBoard, readonly string[]> = {
  // Since 2026-11-15 core work belongs to the web and iOS loops (FIXALL_WORKFLOW.md →
  // *astrid-core is worked by web and iOS*); agent-run.yml clones it beside astrid-web (AWTD-1682).
  web: ['astrid-web', 'astrid-core'],
  ios: ['astrid-ios', 'astrid-core'],
  windows: ['astrid-windows', 'astrid-core'],
  android: ['astrid-android'],
}

/** The board whose own repo this is, e.g. `astrid-windows` → `windows`. */
export function boardForRepo(repoName: string): ReadyQueueBoard | null {
  const board = READY_QUEUE_BOARDS.find(b => BOARD_CHECKOUTS[b][0] === repoName)
  return board ?? null
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
