/**
 * The backend for tasks that live only in Astrid: accept every write as is.
 * The service's own rules have already run; there is no remote to consult.
 */

import type { TaskBackend } from './types'

export const localTaskBackend: TaskBackend = {
  kind: 'local',
  async createTask(_ctx, data) {
    return { ok: true, value: data }
  },
  async updateTask(_ctx, _taskId, data) {
    return { ok: true, value: data }
  },
  async deleteTask() {
    return { ok: true, value: undefined }
  },
}
