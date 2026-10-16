/**
 * AWTD-1209: changing the binding's priority or due field must re-run the
 * field schema sync.
 *
 * `mappedTo` on a ProjectField is derived from the binding — `mappedTo()` in
 * lib/github/projects/fields.ts compares each field's remoteId against the
 * binding's statusFieldId / priorityFieldId / dueFieldId. So remapping due
 * from field A to field B silently makes two rows wrong at once: A is still
 * marked `due` and B is not marked at all.
 *
 * Until this, nothing re-derived them on PATCH, so the replica stayed wrong
 * until the next hourly reconcile. In between, `planFieldValueWrite` would
 * refuse an edit to B (it reads as mapped) and allow one to A (it no longer
 * is) — exactly backwards.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateMock = vi.hoisted(() => vi.fn(async () => ({})))
const syncMock = vi.hoisted(() => vi.fn(async () => true))
const boundBoardMock = vi.hoisted(() =>
  vi.fn(async (_projectId: string) => ({
    projectId: 'proj-1',
    listId: 'list-1',
    ownerId: 'u1',
    projectNodeId: 'PVT_1',
    installationId: 42,
    binding: {
      statusFieldId: 'F_status',
      statusOptionMap: {},
      priorityFieldId: 'F_prio',
      priorityOptionMap: null,
      dueFieldId: 'F_due',
    },
  })),
)

vi.mock('@/lib/prisma', () => ({
  prisma: { gitHubProjectBinding: { update: updateMock } },
}))
vi.mock('@/services/github-project-fields.service', () => ({
  syncProjectFields: syncMock,
  applyFieldValues: vi.fn(),
}))

describe('updateBindingMapping re-derives mappedTo (AWTD-1209)', () => {
  beforeEach(() => {
    updateMock.mockClear()
    syncMock.mockClear()
    boundBoardMock.mockClear()
  })

  const load = async () => (await import('@/services/github-projects.service')).updateBindingMapping

  it('re-runs the field sync when the due field is remapped', async () => {
    const updateBindingMapping = await load()
    await updateBindingMapping('proj-1', { dueFieldId: 'F_due_new' }, {
      board: boundBoardMock,
      client: () => ({}) as never,
    })
    expect(syncMock).toHaveBeenCalledTimes(1)
  })

  it('re-runs it when the priority field is remapped', async () => {
    const updateBindingMapping = await load()
    await updateBindingMapping('proj-1', { priorityFieldId: null }, {
      board: boundBoardMock,
      client: () => ({}) as never,
    })
    expect(syncMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT re-run it when only the status option map changes', async () => {
    const updateBindingMapping = await load()
    await updateBindingMapping('proj-1', { statusOptionMap: { Todo: 'opt' } }, {
      board: boundBoardMock,
      client: () => ({}) as never,
    })
    // statusFieldId is untouched by a PATCH, so no field's mappedTo can move.
    expect(syncMock).not.toHaveBeenCalled()
  })

  it('a sync that fails does not fail the PATCH — the reconcile is the backstop', async () => {
    const updateBindingMapping = await load()
    syncMock.mockRejectedValueOnce(new Error('GitHub down'))
    await expect(
      updateBindingMapping('proj-1', { dueFieldId: 'F_x' }, { board: boundBoardMock, client: () => ({}) as never }),
    ).resolves.toBeDefined()
    expect(updateMock).toHaveBeenCalledTimes(1)
  })
})
