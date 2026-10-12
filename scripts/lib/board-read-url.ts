/**
 * The board read a lane SWEEP makes — AWTD-1237.
 *
 * `GET /api/v1/tasks` serves two different appetites. An agent working a task
 * needs its description; a sweep that only sorts tasks into lanes never looks
 * at one. Measured 2026-10-12, `description` is **80% of that response's wire
 * bytes** (443.3 of 551.8 KiB over a thousand tasks), so a sweep that takes the
 * default payload spends most of its bandwidth on text it will not read — every
 * thirty minutes, in two repos, plus once per agent session.
 *
 * So the sweeps ask for the lean shape (AWTD-1233 → AWTD-1236). The saving is
 * free: `?omit=description` is opt-out, and an omitted field is ABSENT from the
 * task rather than null.
 *
 * **That absence is the one rule for using this.** A caller that reads
 * `task.description` off a response from this URL gets `undefined`, not the
 * text, and `undefined` reads as "no description" in every truthiness check it
 * will meet. So this URL is only for readers that never touch the field;
 * `tests/rules/board-sweeps-do-not-read-description.test.ts` holds them to it.
 * A reader that needs descriptions — `monitor-vercel-logs.ts` does — must build
 * its own URL and say why.
 */

import { BRAND } from '@/lib/brand/config'

/** Everything a sweep filters on, and nothing it does not read. */
export interface BoardReadOptions {
  boardId: string
  /** Page cap. The caller compares it against `meta.total` and says so if the page truncated. */
  limit: number
  /** Overridable for tests and for a caller that already resolved its origin. */
  origin?: string
}

export function boardTasksUrl({
  boardId,
  limit,
  origin = `https://${BRAND.domain}`,
}: BoardReadOptions): string {
  const params = new URLSearchParams({
    listId: boardId,
    completed: 'false',
    // Membership rows repeat across every task sharing a list; a sweep resolves
    // none of them.
    leanListMembers: '1',
    omit: 'description',
    limit: String(limit),
  })
  return `${origin}/api/v1/tasks?${params.toString()}`
}
