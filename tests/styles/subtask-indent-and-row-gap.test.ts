/**
 * AWTD-1617, astrid-core register DS11 and DS12.
 *
 * DS11: in task details the gap after the icon column is `layout.row-gap`
 * (12), so field content starts at the token's detail icon column (62). Web's
 * gap was 8. The arithmetic is pinned in
 * tests/components/task-detail/task-detail-icon-alignment.test.ts.
 *
 * DS12: a subtask indents one `layout.subtask-indent` step (16) per depth,
 * four deep at most. Web indented 24 per level, a literal in TaskRow.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { designTokens } from '@/lib/design/tokens'
import { SUBTASK_MAX_INDENT_DEPTH, subtaskIndent } from '@/lib/design/subtask-indent'
import { compileClasses, ruleFor } from './compile-tailwind'

describe('subtask indent (AWTD-1617, DS12)', () => {
  it('is the token, 16 in both densities', () => {
    expect(designTokens.layout.comfortable['subtask-indent']).toBe(16)
    expect(designTokens.layout.compact['subtask-indent']).toBe(16)
    expect(subtaskIndent(1)).toBe('calc(var(--astrid-layout-comfortable-subtask-indent) * 1)')
  })

  it('stops at four deep', () => {
    expect(SUBTASK_MAX_INDENT_DEPTH).toBe(4)
    expect(subtaskIndent(7)).toBe(subtaskIndent(4))
  })

  it('is what the task row indents by, with no literal left', () => {
    const row = readFileSync(join(process.cwd(), 'components/TaskManager/MainContent/TaskRow.tsx'), 'utf8')
    expect(row).toContain('marginLeft: subtaskIndent(task.subtaskDepth)')
    expect(row).not.toMatch(/subtaskDepth, 4\) \* \d+/)
  })
})

describe('the detail row gap (AWTD-1617, DS11)', () => {
  it('compiles gap-row-gap to the layout.row-gap token', async () => {
    const css = await compileClasses(['gap-row-gap'])
    expect(ruleFor(css, 'gap-row-gap')).toContain('gap: var(--astrid-layout-comfortable-row-gap)')
    expect(designTokens.layout.comfortable['row-gap']).toBe(12)
  })
})
