/**
 * AWTD2-176 — Long task string break comment column width.
 *
 * A URL, hash or any other run of characters with no space in it overflowed
 * the comment column: measured in a browser at 360px, a comment bubble's text
 * was 1986px wide inside a 280px box, and a task description 2276px inside 290.
 * `min-w-0` (task 61a21152) lets the boxes shrink, but text with no break
 * opportunity still runs out of them. Both surfaces now let such a run break
 * anywhere. The title already did (`TaskHeader`); code blocks keep scrolling,
 * since `white-space: pre` takes no wrap opportunities.
 *
 * jsdom does no layout, so this pins the rule that does the wrapping; the
 * overflow itself was measured with Playwright.
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { TaskDetailDescriptionRow } from '@/components/task-detail/TaskDetailDescriptionRow'
import type { Task } from '@/types/task'

const LONG = 'https://example.com/' + 'unbroken'.repeat(40)

function cssBlock(selector: string): string {
  const css = readFileSync(join(process.cwd(), 'styles/components.css'), 'utf8')
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} rule exists`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start))
}

describe('long unbroken strings wrap (AWTD2-176)', () => {
  it('a comment bubble breaks a run with no spaces rather than overflowing', () => {
    expect(cssBlock('.chat-bubble')).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('a task description breaks a run with no spaces rather than overflowing', () => {
    const { container } = render(
      <TaskDetailDescriptionRow
        task={{ id: 't1', description: `See ${LONG}` } as unknown as Task}
        readOnly
        editingDescription={false}
        setEditingDescription={vi.fn()}
        tempDescription=""
        setTempDescription={vi.fn()}
        descriptionRef={{ current: null }}
        descriptionTextareaRef={{ current: null }}
        handleSaveDescription={vi.fn()}
        handleCancelDescription={vi.fn()}
      />
    )
    const prose = container.querySelector('.prose')
    expect(prose).not.toBeNull()
    expect(prose!.className).toContain('[overflow-wrap:anywhere]')
  })
})
