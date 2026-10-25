/**
 * Where a task's shared fields actually live.
 *
 * Today that is always Astrid's own database (`local`). The seam exists so a
 * list bound to an external system — a GitHub Project, in the white-label spec —
 * can sit in front of the write: the service asks the backend first, and writes
 * to the replica only what the backend accepted (remote-authoritative replica,
 * docs/specs/GITHUB_PROJECTS_WHITELABEL.md §3.3 and §5.3).
 *
 * The contract every backend keeps:
 *   - it is called with the row data the service is about to write, after all
 *     of the service's own rules have run;
 *   - it returns the data to write — reshaped if the remote normalised it — or
 *     a refusal, in which case NOTHING is written;
 *   - it never runs side effects (events, SSE, notifications). Those stay in
 *     the service, so every backend gets the same ones.
 */

export type TaskBackendKind = 'local' | 'github_project'

/** Who is writing, for attribution on the remote side. */
export interface TaskBackendContext {
  actorId: string
  /**
   * 'remote': the change came FROM the backend (a GitHub webhook said the
   * issue was deleted). The backend accepts its own news; refusing it would
   * leave the replica disagreeing with the remote for good.
   */
  origin?: 'remote'
}

export type TaskBackendRow = Record<string, unknown>

export type TaskBackendResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 409 | 429 | 502; error: string; retryAfter?: number; ssoUrl?: string }

export interface TaskBackend {
  readonly kind: TaskBackendKind
  createTask(ctx: TaskBackendContext, data: TaskBackendRow): Promise<TaskBackendResult<TaskBackendRow>>
  updateTask(ctx: TaskBackendContext, taskId: string, data: TaskBackendRow): Promise<TaskBackendResult<TaskBackendRow>>
  deleteTask(ctx: TaskBackendContext, taskId: string): Promise<TaskBackendResult<void>>
  /**
   * One project field value, already validated and shaped by
   * `planFieldValueWrite` (AWTD-1209, §9.4.2). `value` is GitHub's
   * `ProjectV2FieldValue` input, or null to clear.
   *
   * The caller owns validation and the replica write; this only carries the
   * value to the backend, so a backend with no fields refuses rather than
   * silently accepting a value nobody will store.
   */
  setFieldValue(
    ctx: TaskBackendContext,
    taskId: string,
    fieldRemoteId: string,
    value: Record<string, unknown> | null,
  ): Promise<TaskBackendResult<void>>
}
