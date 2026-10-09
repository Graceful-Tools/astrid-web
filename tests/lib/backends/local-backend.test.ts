/**
 * Spec §5.2 step 8 — the TaskBackend seam ships with one implementation, and
 * it must change nothing: Astrid's own tasks are written exactly as before.
 */

import { describe, it, expect } from 'vitest'
import { localTaskBackend } from '@/lib/backends/local'
import { taskBackendFor } from '@/lib/backends/resolve'

describe('localTaskBackend', () => {
  it('accepts a create unchanged', async () => {
    const data = { title: 'T', completed: false }
    await expect(localTaskBackend.createTask({ actorId: 'u' }, data)).resolves.toEqual({ ok: true, value: data })
  })

  it('accepts an update unchanged', async () => {
    const data = { completed: true, completedAt: new Date(0) }
    await expect(localTaskBackend.updateTask({ actorId: 'u' }, 't', data)).resolves.toEqual({ ok: true, value: data })
  })

  it('accepts a delete', async () => {
    await expect(localTaskBackend.deleteTask({ actorId: 'u' }, 't')).resolves.toEqual({ ok: true, value: undefined })
  })
})

describe('taskBackendFor', () => {
  it('is local for every task until an external backend exists', () => {
    expect(taskBackendFor([]).kind).toBe('local')
    expect(taskBackendFor(['list-1', 'list-2']).kind).toBe('local')
  })
})
