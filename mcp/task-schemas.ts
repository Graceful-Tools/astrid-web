/**
 * What the OAuth MCP task tools actually honour.
 *
 * Lifted out of `mcp-server-oauth.ts` unchanged. That file's own comment has
 * said for some time that this belongs elsewhere; the oversized-files ratchet
 * (task 9377bc2c) is what finally made moving it cheaper than not. Re-exported
 * from there, so every existing import keeps working.
 */

import { z } from "zod"
import { MIN_TASK_PRIORITY, MAX_TASK_PRIORITY } from "../lib/task-priority"

/**
 * Repeat configuration, shared by create and update.
 *
 * The wire shape is settled and cross-platform — `types/repeating.ts` is
 * canonical and iOS mirrors it in RepeatingTaskHandler.swift — so this is
 * plumbing, not a new design. Next-occurrence math stays in the calculator
 * (ASTRID.md rule 4); nothing here computes a date.
 *
 * `repeatFrom` matters more than it looks for scheduled work: the column
 * defaults to COMPLETION_DATE, which drags the slot forward every time a run
 * lands late. A weekly job that must stay on its day needs DUE_DATE.
 */
const RepeatingFields = {
  repeating: z.enum(["never", "daily", "weekly", "monthly", "yearly", "custom"]).optional(),
  /** Only meaningful when `repeating` is "custom"; a CustomRepeatingPattern. */
  repeatingData: z.record(z.any()).nullable().optional(),
  repeatFrom: z.enum(["DUE_DATE", "COMPLETION_DATE"]).optional(),
}

/**
 * Schema definitions for validation.
 *
 * `.strict()` is load-bearing (task ba84653c). Zod strips unknown keys by
 * default, so `statusRole` — which was not declared here — disappeared before
 * the request body was built while the handler still answered `success: true`.
 * A write that reports success and changes nothing is detectable only by
 * re-reading the task and diffing, and because `get_agent_queue` requires
 * `statusRole: "ready"`, that single silent strip made it impossible to put a
 * task into an agent queue through MCP at all.
 *
 * A field must now be DECLARED here to be accepted, which is the point: this
 * is the one gate deciding what the tools honour, and
 * tests/mcp/tool-schemas-match-what-the-server-honours.test.ts goes red if it
 * and OAUTH_MCP_TOOLS ever disagree in either direction.
 *
 * These duplicate mcp/schemas.ts, which serves the shared-list MCP surface.
 * The same test pins the two to each other so they cannot drift further, but
 * the duplication itself is still worth deleting.
 */
export const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.number().int().min(MIN_TASK_PRIORITY).max(MAX_TASK_PRIORITY).default(0),
  assigneeId: z.string().optional(),
  dueDateTime: z.string().datetime().optional(),
  isAllDay: z.boolean().optional(),
  reminderTime: z.string().datetime().optional(),
  reminderType: z.enum(["push", "email", "both"]).optional(),
  isPrivate: z.boolean().default(true),
  statusRole: z.string().nullable().optional(),
  ...RepeatingFields,
}).strict()

export const UpdateTaskSchema = z.object({
  taskId: z.string(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.number().int().min(MIN_TASK_PRIORITY).max(MAX_TASK_PRIORITY).optional(),
  assigneeId: z.string().optional(),
  dueDateTime: z.string().datetime().optional(),
  isAllDay: z.boolean().optional(),
  reminderTime: z.string().datetime().optional(),
  reminderType: z.enum(["push", "email", "both"]).optional(),
  isPrivate: z.boolean().optional(),
  completed: z.boolean().optional(),
  statusRole: z.string().nullable().optional(),
  ...RepeatingFields,
}).strict()
