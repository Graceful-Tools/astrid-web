/**
 * AWTD-1209 (P6a-3): the rules around writing one project field value.
 *
 * The validation itself is covered by tests/lib/github-projects-field-write.test.ts.
 * What is pinned here is the part that is easy to get subtly wrong:
 *
 *   - 404, never 403, for a task or board the caller cannot see (§9.4.2) —
 *     a 403 would confirm the board exists.
 *   - GitHub FIRST, replica second. A refused remote write must leave no
 *     TaskFieldValue behind, or the replica would claim a value GitHub never
 *     took.
 *   - a mapped field is refused without any remote call at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const taskFindFirst = vi.hoisted(() => vi.fn())
const fieldFindFirst = vi.hoisted(() => vi.fn())
const transaction = vi.hoisted(() => vi.fn(async () => []))
const upsert = vi.hoisted(() => vi.fn(() => 'upsert'))
const deleteMany = vi.hoisted(() => vi.fn(() => 'deleteMany'))
const taskUpdate = vi.hoisted(() => vi.fn(() => 'touch'))
type SetResult =
  | { ok: true; value: undefined }
  | { ok: false; status: 400 | 403 | 409 | 429 | 502; error: string; retryAfter?: number; ssoUrl?: string }
const setFieldValue = vi.hoisted(() => vi.fn(async (): Promise<SetResult> => ({ ok: true, value: undefined })))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findFirst: taskFindFirst, update: taskUpdate },
    projectField: { findFirst: fieldFindFirst },
    taskFieldValue: { upsert, deleteMany },
    $transaction: transaction,
  },
}))
vi.mock('@/lib/list-permissions', () => ({
  canUserEditTasks: vi.fn(() => true),
  listVisibilityWhere: vi.fn(() => ({})),
}))

const BOARD = { id: 'list-1', backend: 'github_project', projectId: 'proj-1', ownerId: 'u1', listMembers: [], privacy: 'PRIVATE' }
const TEXT_FIELD = {
  remoteId: 'PVTF_text', name: 'Notes', dataType: 'text',
  options: null, iterations: null, mappedTo: null, position: 0,
}

const deps = { backendFor: async () => ({ setFieldValue }) as never }
const load = async () => (await import('@/services/github-project-fields.service')).setProjectFieldValue

describe('setProjectFieldValue (AWTD-1209)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transaction.mockResolvedValue([])
    setFieldValue.mockResolvedValue({ ok: true, value: undefined })
    taskFindFirst.mockResolvedValue({ id: 't1', lists: [BOARD] })
    fieldFindFirst.mockResolvedValue(TEXT_FIELD)
  })

  it('writes to GitHub and then stores the value', async () => {
    const result = await (await load())('t1', 'f1', 'hello', 'u1', deps)
    expect(result).toEqual({ ok: true, scalar: 'hello' })
    expect(setFieldValue).toHaveBeenCalledWith({ actorId: 'u1' }, 't1', 'PVTF_text', { text: 'hello' })
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('a task the caller cannot see is 404, not 403', async () => {
    taskFindFirst.mockResolvedValue(null)
    expect(await (await load())('t1', 'f1', 'x', 'u1', deps)).toEqual({ error: 'not_found' })
    expect(setFieldValue).not.toHaveBeenCalled()
  })

  it('a task on no GitHub-backed list is 404', async () => {
    taskFindFirst.mockResolvedValue({ id: 't1', lists: [{ ...BOARD, backend: null, projectId: null }] })
    expect(await (await load())('t1', 'f1', 'x', 'u1', deps)).toEqual({ error: 'not_found' })
  })

  it('a field belonging to another board is 404', async () => {
    fieldFindFirst.mockResolvedValue(null)
    expect(await (await load())('t1', 'f1', 'x', 'u1', deps)).toEqual({ error: 'not_found' })
    expect(setFieldValue).not.toHaveBeenCalled()
  })

  it('a mapped field is refused without calling GitHub', async () => {
    fieldFindFirst.mockResolvedValue({ ...TEXT_FIELD, mappedTo: 'due' })
    expect(await (await load())('t1', 'f1', 'x', 'u1', deps)).toEqual({ refused: 'field_is_mapped' })
    expect(setFieldValue).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('a refused remote write stores NOTHING — the replica never claims a value GitHub rejected', async () => {
    setFieldValue.mockResolvedValue({ ok: false, status: 429, error: 'rate_limited', retryAfter: 30 })
    const result = await (await load())('t1', 'f1', 'hello', 'u1', deps)
    expect(result).toEqual({ backend: { status: 429, error: 'rate_limited', retryAfter: 30 } })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('an sso_required refusal carries its ssoUrl through', async () => {
    setFieldValue.mockResolvedValue({ ok: false, status: 403, error: 'sso_required', ssoUrl: 'https://sso' })
    expect(await (await load())('t1', 'f1', 'hello', 'u1', deps)).toEqual({
      backend: { status: 403, error: 'sso_required', ssoUrl: 'https://sso' },
    })
  })

  it('null clears the row rather than storing an empty value', async () => {
    const result = await (await load())('t1', 'f1', null, 'u1', deps)
    expect(result).toEqual({ ok: true, scalar: null })
    expect(setFieldValue).toHaveBeenCalledWith({ actorId: 'u1' }, 't1', 'PVTF_text', null)
    expect(deleteMany).toHaveBeenCalledWith({ where: { taskId: 't1', fieldId: 'f1' } })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('a caller who can see the board but not edit its tasks gets 403', async () => {
    const { canUserEditTasks } = await import('@/lib/list-permissions')
    vi.mocked(canUserEditTasks).mockReturnValueOnce(false)
    expect(await (await load())('t1', 'f1', 'x', 'u1', deps)).toEqual({ error: 'forbidden' })
    expect(setFieldValue).not.toHaveBeenCalled()
  })
})
