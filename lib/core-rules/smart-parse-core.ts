/**
 * Quick-add's smart parse through astrid-core's `smartParse` (AWTD-1586), so a line typed on the
 * web makes the same task as the same line typed on iOS or the Mac, which already parse through
 * the core.
 *
 * The core answers what the line says. Web composes the rest the same way its TypeScript parser
 * does, for the two differences astrid-core docs/CONTRACTS.md records:
 *
 * - D12: the core's date is a calendar day; web stores an instant. The instant is that day at the
 *   current time of day, which is what the TypeScript's relative dates produce.
 * - The core answers the `#tags`; the selected list is appended here, as web's create does.
 *
 * D13 ("assign to" / "for") is web-only and outside the core's contract, so a line carrying it
 * answers null and the TypeScript parses it, as before.
 */
import type { WeeklyRepeatingPattern, Weekday } from '@/types/repeating'

import { ASSIGNEE_PHRASE } from '@/lib/assignee-phrase'

export interface SmartParseList {
  id: string
  name: string
  isVirtual?: boolean
}

/** The shape parseTaskInput returns. */
export interface ParsedTaskInput {
  title: string
  dueDateTime: Date | undefined
  priority: number | undefined
  assigneeId: string | undefined
  listIds: string[]
  isPrivate: undefined
  repeating: string | undefined
  customRepeatingData: WeeklyRepeatingPattern | null
}

interface SmartParseValue {
  title: string
  listIds: string[]
  dueDay: string | null
  priority: number | null
  repeating: string | null
  weekdays: string[]
}

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** `day` (YYYY-MM-DD) at `now`'s local time of day. */
function onDay(day: string, now: Date): Date {
  const [y, m, d] = day.split('-').map(Number)
  const at = new Date(now)
  at.setFullYear(y, m - 1, d)
  return at
}

export function smartParseThroughCore(args: {
  runJson: (request: string) => string
  input: string
  selectedListId: string
  lists: SmartParseList[]
  locale: string
  now: Date
  isVirtualListId: (id: string) => boolean
}): ParsedTaskInput | null {
  const { runJson, input, selectedListId, lists, locale, now, isVirtualListId } = args
  if (ASSIGNEE_PHRASE.test(input)) return null

  let value: SmartParseValue
  try {
    const reply = JSON.parse(
      runJson(
        JSON.stringify({
          kind: 'smartParse',
          text: input.trim(),
          lists: lists.map((l) => ({ id: l.id, name: l.name, isVirtual: Boolean(l.isVirtual) })),
          locale,
          today: localDay(now),
        }),
      ),
    ) as { ok: boolean; value?: SmartParseValue }
    if (!reply.ok || !reply.value) return null
    value = reply.value
  } catch {
    return null
  }

  const listIds = [...value.listIds]
  if (selectedListId && !isVirtualListId(selectedListId) && !listIds.includes(selectedListId)) {
    listIds.push(selectedListId)
  }
  const repeating = value.repeating ?? undefined
  const weekdays = (value.weekdays ?? []) as Weekday[]

  return {
    title: value.title || input.trim(),
    dueDateTime: value.dueDay ? onDay(value.dueDay, now) : undefined,
    priority: value.priority || undefined,
    assigneeId: undefined,
    listIds,
    isPrivate: undefined,
    repeating,
    customRepeatingData:
      repeating === 'custom' && weekdays.length > 0
        ? { type: 'custom', unit: 'weeks', interval: 1, weekdays, endCondition: 'never' }
        : null,
  }
}
