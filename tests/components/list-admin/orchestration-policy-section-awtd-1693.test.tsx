/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1693 — the agent policy section in list settings: the project's policy and this list's
 * override, each field showing what it inherits, and the policy in effect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import OrchestrationPolicySection from '@/components/list-admin/OrchestrationPolicySection'
import { resolvePolicy } from '@/lib/orchestration-policy'
import type { TaskList } from '@/types/task'

const project = { autonomy: { merge: 'allowed' as const, deploy: 'ask' as const } }
const listOverride = { autonomy: { merge: 'ask' as const } }

function mockView(canEdit: { list: boolean; project: boolean }, projectId: string | null = 'p1') {
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      listId: 'list-1', projectId,
      project: projectId ? project : null, list: listOverride,
      effective: resolvePolicy(projectId ? project : null, listOverride),
      canEdit,
    }),
  } as Response)) as typeof fetch
}

const list = { id: 'list-1', name: 'Build', ownerId: 'owner', privacy: 'PRIVATE', members: [], admins: [], tasks: [] } as unknown as TaskList

describe('OrchestrationPolicySection (AWTD-1693)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('shows the project policy and the list override, and the policy in effect', async () => {
    mockView({ list: true, project: true })
    render(<OrchestrationPolicySection list={list} />)
    await waitFor(() => expect(screen.getByTestId('orchestration-policy')).toBeTruthy())
    expect(screen.getByTestId('orchestration-policy-project')).toBeTruthy()
    // The list sets merge itself; deploy is inherited from the project.
    expect(within(screen.getByTestId('orchestration-list-merge')).getByText('Ask first')).toBeTruthy()
    expect(within(screen.getByTestId('orchestration-list-deploy')).getByText(/Inherited \(Ask first\)/)).toBeTruthy()
    // The project's unset fields fall back to the default.
    expect(within(screen.getByTestId('orchestration-project-release')).getByText(/Default \(Never/)).toBeTruthy()
    const effective = screen.getByTestId('orchestration-policy-effective')
    expect(within(effective).getByText('Merge pull requests: Ask first')).toBeTruthy()
    expect(within(effective).getByText('Deploy: Ask first')).toBeTruthy()
    expect(within(effective).getByText('Questions go to: The list owner')).toBeTruthy()
  })

  it('a list admin who is not a project admin cannot change the project policy', async () => {
    mockView({ list: true, project: false })
    render(<OrchestrationPolicySection list={list} />)
    await waitFor(() => expect(screen.getByTestId('orchestration-project-merge')).toBeTruthy())
    expect((screen.getByTestId('orchestration-project-merge') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('orchestration-list-merge') as HTMLButtonElement).disabled).toBe(false)
  })

  it('a list with no project has only its own override', async () => {
    mockView({ list: true, project: false }, null)
    render(<OrchestrationPolicySection list={list} />)
    await waitFor(() => expect(screen.getByTestId('orchestration-policy-list')).toBeTruthy())
    expect(screen.queryByTestId('orchestration-policy-project')).toBeNull()
  })
})
