/**
 * The task-detail icon column lands under the title's leading control — pinned
 * by the ARITHMETIC, not by the class names (AWTD-1177).
 *
 * Jon, choosing the Mac pattern for the detail pane: *"e. Icons should
 * horizontally align as well."* Measuring the rendered pane showed web already
 * satisfies it — every field icon is centred at x=34 under the checkbox, and
 * every value starts at x=58 on the title's left edge.
 *
 * So this is not a fix. It is the test that was missing while the alignment
 * happened to be right.
 *
 * `task-field-row.test.tsx` already asserts `FIELD_ICON_COLUMN_CLASS` is `w-8`
 * and the gap is `gap-2`. That pins two of the three terms. The third — the
 * PADDING of the container each row sits in — lives in two different files, and
 * nothing compared them:
 *
 *     header row:  TaskHeader.tsx        p-4  + leading control w-8 + gap-2 → 56
 *     field rows:  task-detail.tsx       p-4  + icon column     w-8 + gap-2 → 56
 *
 * Change one `p-4` to `p-6` and every existing assertion still passes while the
 * icons visibly drift from the checkbox — which is exactly the defect being
 * reported here, from a stale screenshot, at a moment when the code was fine.
 *
 * Pinned at the source, in the idiom `task-detail-field-order.test.ts` already
 * uses for this component: jsdom performs no layout, so rendering the pane
 * would measure nothing, and the real geometry is a property of these class
 * names in these two files.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  FIELD_ICON_COLUMN_CLASS,
  FIELD_ROW_GAP_CLASS,
} from '@/components/task-detail/TaskFieldRow'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const headerSrc = read('components/task-detail/TaskHeader.tsx')
const paneSrc = read('components/task-detail.tsx')
const leadingSrc = read('components/task-leading-control.tsx')

/** Tailwind spacing scale, in px, for the few steps these containers use. */
const SPACING_PX: Record<string, number> = {
  '0': 0, '0.5': 2, '1': 4, '1.5': 6, '2': 8, '2.5': 10, '3': 12, '4': 16, '5': 20, '6': 24, '8': 32,
}

function px(token: string, kind: 'p' | 'w' | 'gap'): number {
  const value = SPACING_PX[token]
  if (value === undefined) {
    throw new Error(`task-detail alignment: unknown Tailwind ${kind} step "${token}"`)
  }
  return value
}

/** `w-8` → 32. */
function widthOf(cls: string): number {
  const m = cls.match(/\bw-([\d.]+)\b/)
  if (!m) throw new Error(`task-detail alignment: no w-* in "${cls}"`)
  return px(m[1], 'w')
}

/** `gap-2` → 8. */
function gapOf(cls: string): number {
  const m = cls.match(/\bgap-([\d.]+)\b/)
  if (!m) throw new Error(`task-detail alignment: no gap-* in "${cls}"`)
  return px(m[1], 'gap')
}

describe('task detail: field icons align with the title checkbox (AWTD-1177)', () => {
  /**
   * The header's non-compact container. Compact is the board card, which
   * deliberately uses its own p-3/gap-3 pair — it is a different row shape, not
   * a drift, so this invariant is about the full pane only.
   */
  const headerPadding = (() => {
    const m = headerSrc.match(/className=\{compact \? "p-3 pr-0\.5" : "(p-\d+)"\}/)
    if (!m) {
      throw new Error(
        'task-detail alignment: could not find the header padding container in TaskHeader.tsx. ' +
          'If the header was restructured, re-derive the alignment and update this test deliberately.',
      )
    }
    return px(m[1].slice(2), 'p')
  })()

  /** The scrolling container every field row sits in. */
  const fieldsPadding = (() => {
    const m = paneSrc.match(/overflow-y-auto scrollbar-hide (p-\d+) space-y-\d+/)
    if (!m) {
      throw new Error(
        'task-detail alignment: could not find the field-rows scroll container in task-detail.tsx. ' +
          'If the pane was restructured, re-derive the alignment and update this test deliberately.',
      )
    }
    return px(m[1].slice(2), 'p')
  })()

  /** The leading control's square — the thing the icons sit under. */
  const leadingWidth = (() => {
    const m = leadingSrc.match(/const SQUARE_CLASS = "([^"]+)"/)
    if (!m) throw new Error('task-detail alignment: SQUARE_CLASS not found in task-leading-control.tsx')
    return widthOf(m[1])
  })()

  it('gives the header row and the field rows the same container padding', () => {
    // The term nothing used to check. Both are p-4 today.
    expect(fieldsPadding).toBe(headerPadding)
  })

  it('makes the icon column exactly as wide as the leading control', () => {
    expect(widthOf(FIELD_ICON_COLUMN_CLASS)).toBe(leadingWidth)
  })

  it('starts content at the same x in the header and in every field row', () => {
    const gap = gapOf(FIELD_ROW_GAP_CLASS)
    const titleLeft = headerPadding + leadingWidth + gap
    const valueLeft = fieldsPadding + widthOf(FIELD_ICON_COLUMN_CLASS) + gap

    // 16 + 32 + 8 = 56, both rows. Measured in a real browser as x=58 for both,
    // the extra 2px being the leading control's own border.
    expect(valueLeft).toBe(titleLeft)
    expect(titleLeft).toBe(56)
  })

  it('centres the icon column on the leading control', () => {
    const iconCentre = fieldsPadding + widthOf(FIELD_ICON_COLUMN_CLASS) / 2
    const leadingCentre = headerPadding + leadingWidth / 2

    expect(iconCentre).toBe(leadingCentre)
  })
})
