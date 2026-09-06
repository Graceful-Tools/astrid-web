/**
 * Reuse Phase 2 (task 5fac84e8): callers used to import a specific add-task
 * implementation — EnhancedTaskCreation inline, MobileQuickAdd in the mobile
 * footer — so adding a control meant finding every mount and knowing which of
 * the two it was. AddTaskInput became the only entry point: one component, one
 * `variant` prop.
 *
 * Task f699462a finished the job behind that seam. The two implementations are
 * now one control (components/quick-add.tsx) rendered in two placements, so
 * `variant` names WHERE the control goes rather than WHICH component it is.
 */
import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { render, screen } from '@testing-library/react'
import { AddTaskInput } from '@/components/add-task-input'

vi.mock('@/components/quick-add', () => ({
  QuickAdd: (props: Record<string, unknown>) => (
    <div
      data-testid="quick-add"
      data-placement={String(props.placement)}
      data-layout={String(props.layoutType)}
      data-users={String((props.availableUsers as unknown[])?.length ?? 'none')}
    />
  ),
}))

const base = {
  selectedListId: 'list-1',
  availableLists: [],
  quickTaskInput: '',
  setQuickTaskInput: vi.fn(),
  onCreateTask: vi.fn(),
  onKeyDown: vi.fn(),
  isSessionReady: true,
}

describe('AddTaskInput (tasks 5fac84e8, f699462a)', () => {
  it('places variant="inline" in the flow, above the list', () => {
    render(<AddTaskInput variant="inline" layoutType="3-column" {...(base as never)} />)
    expect(screen.getByTestId('quick-add').getAttribute('data-placement')).toBe('inline')
  })

  it('pins variant="footer" to the bottom of the 1-column view', () => {
    render(<AddTaskInput variant="footer" availableUsers={[]} {...(base as never)} />)
    expect(screen.getByTestId('quick-add').getAttribute('data-placement')).toBe('fixed-bottom')
  })

  it('passes the layout through so the contextual placeholder still works', () => {
    render(<AddTaskInput variant="inline" layoutType="3-column" {...(base as never)} />)
    expect(screen.getByTestId('quick-add').getAttribute('data-layout')).toBe('3-column')
  })

  it('defaults the variant-only props rather than passing undefined through', () => {
    // Callers of one variant should not have to know the other's props exist.
    render(<AddTaskInput variant="inline" {...(base as never)} />)
    expect(screen.getByTestId('quick-add').getAttribute('data-layout')).toBe('1-column')
    expect(screen.getByTestId('quick-add').getAttribute('data-users')).toBe('0')
  })

  it('does not give the fixed-bottom bar a column layout it has no use for', () => {
    render(<AddTaskInput variant="footer" layoutType="3-column" {...(base as never)} />)
    expect(screen.getByTestId('quick-add').getAttribute('data-layout')).toBe('undefined')
  })

  it('is the only add-task entry point components import', () => {
    // Guards the seam: a new mount must not reach past AddTaskInput to the
    // implementation, which is what made this hard to change before.
    const offenders: string[] = []
    const OWN = ['add-task-input.tsx', 'quick-add.tsx']
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.tsx$/.test(entry.name) || OWN.includes(entry.name)) continue
        const src = fs.readFileSync(full, 'utf8')
        if (/\bQuickAdd\b/.test(src)) offenders.push(full)
      }
    }
    walk(path.join(process.cwd(), 'components'))
    walk(path.join(process.cwd(), 'app'))

    expect(offenders, `import AddTaskInput instead: ${offenders.join(', ')}`).toEqual([])
  })
})
