/**
 * AWTD-1497 — the creator's own tab must not show a task twice.
 *
 * task_created now reaches the creator too, so their other devices update
 * live. On the creating tab the SSE echo can arrive BEFORE the POST returns
 * (the broadcast runs inside the request). The SSE handler already skips a
 * task it has; the POST's own onTaskCreated prepended unconditionally, so the
 * echo-then-response order would have put the row on screen twice.
 */
import { describe, expect, it } from 'vitest'
import { upsertCreatedTask } from '@/hooks/task-manager/merge-tasks'
import type { Task } from '@/types/task'

const t = (id: string, title = id) => ({ id, title }) as unknown as Task

describe('upsertCreatedTask (AWTD-1497)', () => {
  it('prepends a task the list does not have', () => {
    expect(upsertCreatedTask([t('a')], t('b')).map(x => x.id)).toEqual(['b', 'a'])
  })

  it('replaces, never duplicates, a task the SSE echo already added', () => {
    const afterEcho = [t('b', 'from SSE'), t('a')]
    const result = upsertCreatedTask(afterEcho, t('b', 'from POST'))
    expect(result.map(x => x.id)).toEqual(['b', 'a'])
    expect(result[0].title).toBe('from POST')
  })
})
