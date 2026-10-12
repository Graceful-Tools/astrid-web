/**
 * A GitHub milestone is GitHub's to change (AWTD-1189, P6c-3).
 *
 * The guard that already refused label writes now covers milestone lists too,
 * because they are mirrored the same way and a flavor that syncs inbound while
 * staying writable outbound accepts changes it silently loses at the next
 * hydration.
 *
 * Pinned here, beyond what github-labels.test.ts covers:
 *   - a milestone write is refused with its OWN code, not the label's — a client
 *     that special-cases `github_label_read_only` must not see it for a milestone;
 *   - joining, leaving, and a `set` that drops the milestone are all refused;
 *   - a write that touches neither flavor still goes through;
 *   - GitHub's own writes (`origin: 'remote'`) are never refused — that is how
 *     the mirror applies in the first place.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  GITHUB_LABEL_READ_ONLY,
  GITHUB_MILESTONE_READ_ONLY,
  mirroredListChanged,
  withGithubLabelGuard,
} from '@/lib/backends/github-labels'
import type { TaskBackend } from '@/lib/backends/types'

const milestone = { id: 'list-v12', held: false, listType: 'milestone' }
const heldMilestone = { ...milestone, held: true }
const label = { id: 'list-bug', held: false, listType: 'label' }

const inner: TaskBackend = {
  kind: 'local',
  createTask: vi.fn(async () => ({ ok: true as const, value: { id: 't1' } as never })),
  updateTask: vi.fn(async () => ({ ok: true as const, value: { id: 't1' } as never })),
  deleteTask: vi.fn(async () => ({ ok: true as const, value: undefined as never })),
}

const ctx = { origin: 'local' } as never
const remoteCtx = { origin: 'remote' } as never

describe('mirroredListChanged (AWTD-1189)', () => {
  it('names the milestone being joined', () => {
    expect(mirroredListChanged({ connect: [{ id: 'list-v12' }] }, [milestone])).toEqual(milestone)
  })

  it('names the milestone being left', () => {
    expect(mirroredListChanged({ disconnect: [{ id: 'list-v12' }] }, [heldMilestone])).toEqual(heldMilestone)
  })

  it('catches a `set` that silently drops the milestone', () => {
    // `set` replaces the whole membership, so omitting the milestone removes it.
    expect(mirroredListChanged({ set: [{ id: 'some-board' }] }, [heldMilestone])).toEqual(heldMilestone)
  })

  it('is null when the write leaves every mirrored list alone', () => {
    expect(mirroredListChanged({ connect: [{ id: 'some-board' }] }, [milestone, label])).toBeNull()
    expect(mirroredListChanged({ set: [{ id: 'list-v12' }] }, [heldMilestone])).toBeNull()
  })
})

describe('withGithubLabelGuard, milestone flavor (AWTD-1189)', () => {
  it('refuses a milestone change with the milestone code, not the label one', async () => {
    const guarded = withGithubLabelGuard(inner, async () => [milestone])
    const result = await guarded.updateTask(ctx, 't1', { lists: { connect: [{ id: 'list-v12' }] } } as never)

    expect(result).toEqual({ ok: false, status: 400, error: GITHUB_MILESTONE_READ_ONLY })
    expect(result).not.toMatchObject({ error: GITHUB_LABEL_READ_ONLY })
  })

  it('still refuses a label change with the label code', async () => {
    const guarded = withGithubLabelGuard(inner, async () => [label])
    const result = await guarded.updateTask(ctx, 't1', { lists: { connect: [{ id: 'list-bug' }] } } as never)

    expect(result).toEqual({ ok: false, status: 400, error: GITHUB_LABEL_READ_ONLY })
  })

  it('refuses a milestone change on create too', async () => {
    const guarded = withGithubLabelGuard(inner, async () => [milestone])
    const result = await guarded.createTask(ctx, { lists: { connect: [{ id: 'list-v12' }] } } as never)

    expect(result).toEqual({ ok: false, status: 400, error: GITHUB_MILESTONE_READ_ONLY })
  })

  it('lets GitHub’s own write through — that is how the mirror applies', async () => {
    const guarded = withGithubLabelGuard(inner, async () => [milestone])
    const result = await guarded.updateTask(remoteCtx, 't1', { lists: { connect: [{ id: 'list-v12' }] } } as never)

    expect(result).toMatchObject({ ok: true })
  })

  it('lets an ordinary list move through untouched', async () => {
    const guarded = withGithubLabelGuard(inner, async () => [milestone])
    const result = await guarded.updateTask(ctx, 't1', { lists: { connect: [{ id: 'my-list' }] } } as never)

    expect(result).toMatchObject({ ok: true })
  })
})
