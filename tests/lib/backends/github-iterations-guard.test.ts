/**
 * An iteration list is GitHub's to change (AWTD-1230, P6c-3b).
 *
 * Joining or leaving an iteration list from Astrid is refused with its OWN
 * code — `github_iteration_read_only`, not the label's or the milestone's — the
 * way AWTD-1189 split milestones from labels. The iteration itself is still
 * editable as a field value (AWTD-1209); only membership is refused.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  GITHUB_ITERATION_READ_ONLY,
  GITHUB_MIRRORED_LIST,
  isGithubLabelList,
  withGithubLabelGuard,
} from '@/lib/backends/github-labels'
import type { TaskBackend } from '@/lib/backends/types'

const iteration = { id: 'list-sprint-41', held: true, listType: 'iteration' }

const inner: TaskBackend = {
  kind: 'local',
  createTask: vi.fn(async () => ({ ok: true as const, value: { id: 't1' } as never })),
  updateTask: vi.fn(async () => ({ ok: true as const, value: { id: 't1' } as never })),
  deleteTask: vi.fn(async () => ({ ok: true as const, value: undefined as never })),
  setFieldValue: vi.fn(async () => ({ ok: true as const, value: undefined as never })),
}

describe('withGithubLabelGuard — iteration lists (AWTD-1230)', () => {
  it('refuses leaving an iteration list with github_iteration_read_only', async () => {
    const guarded = withGithubLabelGuard(inner, async () => [iteration])
    const result = await guarded.updateTask({ origin: 'local' } as never, 't1', { lists: { disconnect: [{ id: 'list-sprint-41' }] } } as never)
    expect(result).toEqual({ ok: false, status: 400, error: GITHUB_ITERATION_READ_ONLY })
    expect(GITHUB_ITERATION_READ_ONLY).toBe('github_iteration_read_only')
  })

  it('lets GitHub’s own writes through', async () => {
    const guarded = withGithubLabelGuard(inner, async () => [iteration])
    const result = await guarded.updateTask({ origin: 'remote' } as never, 't1', { lists: { disconnect: [{ id: 'list-sprint-41' }] } } as never)
    expect(result.ok).toBe(true)
  })

  it('the mirrored-list read covers iterations, so the replica reads them back', () => {
    expect(GITHUB_MIRRORED_LIST.listType.in).toContain('iteration')
    expect(isGithubLabelList({ listType: 'iteration', remoteNodeId: 'PVTIF_x:it-1' })).toBe(true)
  })
})
