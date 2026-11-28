/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-359: the goals editor labels every field (measure, target, current) where it can be seen, and
 * lets a goal carry the date its target should be hit.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProjectGoalsEditor } from '@/components/projects/ProjectGoalsEditor'

const value = {
  goals: [{ id: 'g1', statement: 'Secure builds', measure: 'Insecure packages', target: '0', current: '3' }],
  guardrails: [],
}

describe('ADEV-359 goals editor labels', () => {
  it('shows a visible label for measure, target, current and target date', () => {
    render(<ProjectGoalsEditor value={value} onChange={() => {}} />)
    const labels = Array.from(screen.getByTestId('project-goal-row').querySelectorAll('label')).map(l => l.textContent)
    for (const label of ['Measure', 'Target', 'Current', 'Target date']) expect(labels).toContain(label)
  })

  it('sets the target date', () => {
    const onChange = vi.fn()
    render(<ProjectGoalsEditor value={value} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('project-goal-target-date'), { target: { value: '2026-12-31' } })
    expect(onChange.mock.calls[0][0].goals[0].targetDate).toBe('2026-12-31')
  })
})
