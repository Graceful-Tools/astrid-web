/**
 * Which backend owns a task, from the lists it is (or will be) on.
 *
 * Every list is local today. When an external backend exists, a task is owned
 * by it if ANY of its lists is bound to it: shared fields route remotely, while
 * Astrid-only fields and personal-list membership stay local (spec §5.3).
 */

import { localTaskBackend } from './local'
import type { TaskBackend } from './types'

export function taskBackendFor(_listIds: readonly string[]): TaskBackend {
  return localTaskBackend
}
