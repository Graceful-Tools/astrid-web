/**
 * The write that hands a task back to a person — astrid-core's `handBack` shape
 * (`rules::run_json` kind `handBack`): `{ statusRole: null, assigneeId }`.
 *
 * R4 (Jon, 2026-11-12): "If it is waiting on a user to act on the specific task
 * move it to the inbox." So a handback is the Inbox (no status) assigned to that
 * person — never Waiting, which holds only tasks waiting on a date or a task.
 * The reply-resume detection (lib/agent-handback.ts) keys on exactly this shape.
 *
 * `completed: false` is part of core's answer but is left out: a PUT that sent it
 * would reopen a task someone completed in the meantime.
 */
export function handbackWrite(personId: string): { statusRole: null; assigneeId: string } {
  if (!personId.trim()) throw new Error('A handback needs the person to hand it to')
  return { statusRole: null, assigneeId: personId }
}
