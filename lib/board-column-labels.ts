/**
 * The words a board column shows: its name and its blurb, in the reader's
 * language (AWTD-1601).
 *
 * A column's `name` and `description` arrive as data — the built-in English
 * from lib/task-status.ts / lib/project-status.ts, or whatever the board typed
 * when it renamed or added a column. Only the built-in English is translated:
 * a board's own words are shown exactly as written, in every language, as on
 * iOS (`TaskBoardStatus`: a rename wins over the built-in name).
 *
 * A built-in column is recognised by its id AND its untouched English text, so
 * a rename of "Ready" to "Up next" stays "Up next", while an unrenamed "Ready"
 * becomes "Bereit" for a German reader.
 */
import { DEFAULT_STATES, DONE_COLUMN_ID, INBOX_COLUMN_ID } from '@/lib/task-status'
import { VIRTUAL_DONE_COLUMN_ID, VIRTUAL_INBOX_COLUMN_ID } from '@/lib/project-status'
import { BOARD_PRESETS } from '@/lib/waiting-rules'

type Translate = (key: string) => string

type BuiltIn = 'inbox' | 'ready' | 'doing' | 'waiting' | 'done' | 'testing'

const INBOX_TEXT = { name: 'Inbox', description: 'Move them to "Ready" when they are... ready!' }
const DONE_TEXT = { name: 'Done', description: 'Complete — congrats!' }

const BUILT_IN_TEXT: Record<string, { role: BuiltIn; name: string; description: string }> = {
  [INBOX_COLUMN_ID]: { role: 'inbox', ...INBOX_TEXT },
  [VIRTUAL_INBOX_COLUMN_ID]: { role: 'inbox', ...INBOX_TEXT },
  [DONE_COLUMN_ID]: { role: 'done', ...DONE_TEXT },
  [VIRTUAL_DONE_COLUMN_ID]: { role: 'done', ...DONE_TEXT },
  ...Object.fromEntries(
    DEFAULT_STATES.map(state => [
      state.role,
      { role: state.role as BuiltIn, name: state.name, description: state.description ?? '' },
    ]),
  ),
  // The optional preset columns (R7, astrid-core): built-in words too, translated until renamed.
  ...Object.fromEntries(
    BOARD_PRESETS.map(preset => [preset.role, { role: preset.role as BuiltIn, name: preset.name, description: preset.description }]),
  ),
}

/** `t` returns the key itself when a message is missing; fall back to the data then. */
function translated(t: Translate, key: string, fallback: string): string {
  const value = t(key)
  return value && value !== key ? value : fallback
}

export function boardColumnLabel(column: { id: string; name: string }, t: Translate): string {
  const builtIn = BUILT_IN_TEXT[column.id]
  if (!builtIn || column.name !== builtIn.name) return column.name
  return translated(t, `board.status.${builtIn.role}`, column.name)
}

export function boardColumnBlurb(column: { id: string; description?: string | null }, t: Translate): string {
  const description = column.description ?? ''
  const builtIn = BUILT_IN_TEXT[column.id]
  if (!builtIn || description !== builtIn.description) return description
  return translated(t, `board.blurb.${builtIn.role}`, description)
}
