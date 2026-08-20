/**
 * Task-detail fields in list mode: Who, Date, Priority, Lists (task 4dd640d9).
 *
 * Jon: *"Order (under task title): Who, Date, Priority, Lists. For Priority use
 * '!!!' as icon not a flag. Implement same order on all interfaces for list
 * mode (iOS, Mac, web — board details, mobile etc)."*
 *
 * Before this, web rendered When → Created by → Priority → Assignee → Lists,
 * and iOS and Mac each had Priority first and Who second. The SAME wrong order
 * written out three times, which is the argument for stating it once
 * (lib/task-detail-field-order.ts, mirroring TaskDetailFieldOrder.swift).
 *
 * Pinned at the source, the way iOS pins its inline SwiftUI rows: TaskFieldEditors
 * renders its rows in JSX with no order array to assert against at runtime, and
 * rendering the component in jsdom would need the twenty-odd props and pickers
 * it depends on to prove a thing about sequence.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { TASK_DETAIL_LIST_MODE_ORDER } from '@/lib/task-detail-field-order'
import { PRIORITY_ROW_GLYPH, priorityGlyph } from '@/lib/priority-glyph'

const src = readFileSync(
  join(process.cwd(), 'components/task-detail/TaskFieldEditors.tsx'),
  'utf8',
)

/** Where each field's row is declared in the file. */
function rowPosition(label: string): number {
  const index = src.indexOf(`<TaskFieldRow label="${label}"`)
  expect(index, `no <TaskFieldRow label="${label}"> found`).toBeGreaterThan(-1)
  return index
}

describe('list-mode task detail field order (task 4dd640d9)', () => {
  it('states the order once, as Who → Date → Priority → Lists', () => {
    expect(TASK_DETAIL_LIST_MODE_ORDER).toEqual(['assignee', 'when', 'priority', 'lists'])
  })

  it('renders Assignee before When', () => {
    expect(rowPosition('Assignee')).toBeLessThan(rowPosition('When'))
  })

  it('renders When before Priority', () => {
    expect(rowPosition('When')).toBeLessThan(rowPosition('Priority'))
  })

  it('renders Priority before Lists', () => {
    expect(rowPosition('Priority')).toBeLessThan(rowPosition('Lists'))
  })

  it('keeps the four in exactly the declared sequence', () => {
    // The pairwise checks above can all hold while a fifth field is spliced
    // into the middle; this asserts the sequence as a whole.
    const labels: Record<string, string> = {
      assignee: 'Assignee',
      when: 'When',
      priority: 'Priority',
      lists: 'Lists',
    }
    const positions = TASK_DETAIL_LIST_MODE_ORDER.map(field => rowPosition(labels[field]))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('marks the Priority row with !!! rather than a flag', () => {
    const priorityRow = src.slice(rowPosition('Priority'), rowPosition('Priority') + 200)

    expect(priorityRow, 'the priority row still uses the flag icon').not.toContain('FlagIcon')
    // The marker is one component so the JSX stays on one line; follow it
    // through rather than asserting only that *something* is passed as an icon.
    expect(priorityRow).toContain('<PriorityRowIcon />')
    expect(src).toMatch(/function PriorityRowIcon\(\)[\s\S]*?\{PRIORITY_ROW_GLYPH\}/)
  })

  it('imports the glyph rather than typing "!!!" into the JSX', () => {
    expect(src).toMatch(/from ['"]@\/lib\/priority-glyph['"]/)
  })

  it('no longer imports the flag icon at all', () => {
    // Left behind, it invites the next row to reach for it.
    expect(src).not.toContain('Flag as FlagIcon')
  })
})

describe('priority glyphs', () => {
  it('uses the vocabulary the rest of the app speaks', () => {
    expect([0, 1, 2, 3].map(priorityGlyph)).toEqual(['○', '!', '!!', '!!!'])
  })

  it('labels the row with !!! whatever the task priority is', () => {
    // The row names the field; the picker beside it reports the value. So the
    // marker must not follow the task's own priority.
    expect(PRIORITY_ROW_GLYPH).toBe('!!!')
  })

  it('falls back to the none-glyph for junk rather than rendering undefined', () => {
    expect(priorityGlyph(null)).toBe('○')
    expect(priorityGlyph(undefined)).toBe('○')
    expect(priorityGlyph(99)).toBe('○')
    expect(priorityGlyph(-1)).toBe('○')
  })
})
