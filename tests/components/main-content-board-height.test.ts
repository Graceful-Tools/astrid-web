/**
 * The board-height fix is only real if MainContent actually asks for it.
 *
 * The wrapper's className is built inline in a 1000-line component that no
 * jsdom test renders (it wants a session, a router, SSE and a dozen hooks), so
 * this pins the wiring at the source: the positioning classes come from the
 * tested helper, and the literal `relative ... absolute` conflict that caused
 * the bug does not come back.
 *
 * Same shape as tests/components/project-board-display-mode.test.ts, which
 * pins this component's project-mode wiring the same way and for the same
 * reason.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(
  join(process.cwd(), 'components/TaskManager/MainContent/MainContent.tsx'),
  'utf8',
)

describe('MainContent task-area wrapper (mobile board height)', () => {
  it('builds its positioning classes with taskAreaPositionClasses', () => {
    expect(src).toContain("from '@/lib/task-area-position-classes'")
    expect(src).toMatch(/taskAreaPositionClasses\(\{/)
  })

  it('passes board mode in, so the board branch can be pinned to the screen', () => {
    expect(src).toMatch(/taskAreaPositionClasses\(\{[^}]*boardMode/)
  })

  it('no longer hardcodes the relative/absolute conflict on the wrapper', () => {
    expect(src).not.toMatch(/relative z-10 \$\{/)
    expect(src).not.toMatch(/'absolute inset-x-0 bottom-0 transition-all/)
  })
})
