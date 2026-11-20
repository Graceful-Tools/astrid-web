/**
 * ADEV-157: one Pill for the board's capsules; the completed-on pill wears
 * Done's tint as on iOS, and the pasted grey class string is gone.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { BoardCompletedOnPill } from '@/components/board-completed-on-pill'
import { Pill } from '@/components/ui/pill'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx$/.test(name) ? [path] : []
  })
}

describe('Pill (ADEV-157)', () => {
  it('ADEV-157 completed-on pill uses the Done tone', () => {
    render(<BoardCompletedOnPill task={{ completedAt: new Date('2026-11-19T12:00:00Z') }} />)
    const pill = screen.getByTestId('board-card-completed-on')
    expect(pill.className).toContain('board-status-pill')
    expect(pill.className).toContain('board-status-done')
    expect(pill.className).not.toContain('theme-bg-hover')
  })

  it('ADEV-157 neutral pill carries no state tone', () => {
    render(<Pill data-testid="count">3</Pill>)
    const pill = screen.getByTestId('count')
    expect(pill.className).toContain('board-status-pill')
    expect(pill.className).not.toMatch(/board-status-(done|ready|doing|waiting|inbox)/)
  })

  it('ADEV-157 the pasted pill class string appears nowhere in components/', () => {
    const offenders = sources(join(process.cwd(), 'components')).filter((file) =>
      readFileSync(file, 'utf8').includes('rounded-full theme-bg-hover px-2 py-0.5'),
    )
    expect(offenders).toEqual([])
  })
})
