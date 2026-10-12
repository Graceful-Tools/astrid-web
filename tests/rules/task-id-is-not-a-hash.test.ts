/**
 * AWTD-1187 (web half of iOS AITD-484): a TASK ID is never drawn with `#`.
 *
 * `#` already means a LIST everywhere in both apps — the list glyph, the
 * sidebar rows, the quick-add picker — and `!` means priority. Drawing a task
 * id with `#` reads as a list. A tag icon is out for the same reason: lists
 * behave like tags. iOS settled on the SF Symbol `ticket`, so web uses lucide's
 * `Ticket` and the two follow each other.
 *
 * A source rule rather than a render test: the point is that NO task-id
 * surface reaches for Hash again, and there is no single component to render
 * that would catch the next one.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '../..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

/** Every place that draws the task id or offers to copy it. */
const TASK_ID_SURFACES = [
  'components/task-detail/TaskDetailIdentifierRow.tsx',
  'components/task-detail/TaskActionMenu.tsx',
]

describe('a task id is drawn with a ticket, not a hash (AWTD-1187)', () => {
  it.each(TASK_ID_SURFACES)('%s imports Ticket', file => {
    expect(read(file)).toMatch(/import \{[^}]*\bTicket\b[^}]*\} from "lucide-react"/)
  })

  it('the identifier row renders a Ticket as its field icon', () => {
    expect(read(TASK_ID_SURFACES[0])).toContain('icon={<Ticket className="w-4 h-4" />}')
  })

  it('the copy-task-id menu item renders a Ticket', () => {
    const src = read(TASK_ID_SURFACES[1])
    const item = src.slice(src.indexOf('copyIdentifier.copy'))
    expect(item.slice(0, 300)).toContain('<Ticket')
  })

  it.each(TASK_ID_SURFACES)('%s no longer uses the Hash icon at all', file => {
    const src = read(file)
    // The word may survive in prose explaining why it is not used; what must
    // not come back is the import or the element.
    expect(src).not.toMatch(/import \{[^}]*\bHash\b[^}]*\} from "lucide-react"/)
    expect(src).not.toContain('<Hash')
  })

  it('leaves `#` alone where it correctly means a LIST', () => {
    // The whole point of the change: lists keep their hash.
    expect(read('components/list-glyph.tsx')).toContain('<Hash')
  })
})
