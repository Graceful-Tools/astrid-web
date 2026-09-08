/**
 * Zod schemas for MCP tool input validation.
 *
 * Extracted from mcp-server-v2.ts so the MCP CLI script doesn't need to
 * re-declare these schemas alongside the tool registration / handler
 * surface. Imported via CommonJS (the MCP server is a `require()`-based
 * runnable script) — exposing both named exports and a default object so
 * either form works.
 */

const { z } = require("zod")
// The range is shared with the v1 HTTP API rather than restated (task 17fea642)
// — v1 checked only that priority was a number, so the two surfaces disagreed
// about the same field. An `import` rather than this file's usual `require`:
// tsc emits a require for it in the CommonJS MCP build, and a bare require of
// a sibling .ts is not resolvable when vitest loads this file directly.
import { MIN_TASK_PRIORITY, MAX_TASK_PRIORITY } from "../lib/task-priority"

const RepeatingDataSchema = z.object({
  type: z.literal("custom"),
  unit: z.enum(["days", "weeks", "months", "years"]),
  interval: z.number().min(1),
  endCondition: z.enum(["never", "after_occurrences", "until_date"]),
  endAfterOccurrences: z.number().optional(),
  endUntilDate: z.string().datetime().optional(),
  weekdays: z.array(z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])).optional(),
  monthRepeatType: z.enum(["same_date", "same_weekday"]).optional(),
  monthDay: z.number().min(1).max(31).optional(),
  monthWeekday: z.object({
    weekday: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
    weekOfMonth: z.number().min(1).max(5),
  }).optional(),
  month: z.number().min(1).max(12).optional(),
  day: z.number().min(1).max(31).optional(),
}).optional()

/**
 * `.strict()` on both task schemas is load-bearing (task ba84653c).
 *
 * Zod strips unknown keys by default. `statusRole` was not declared here, so
 * it disappeared before the request body was built while the handler still
 * answered `success: true` — a write that reported success and changed
 * nothing, detectable only by re-reading the task and diffing. Since
 * `get_agent_queue` requires `statusRole: "ready"`, that one silent strip made
 * it impossible to put a task into an agent queue through MCP at all.
 *
 * Strict turns every future instance of that into an error the caller can see.
 * The cost is that a field must be DECLARED here to be accepted, which is the
 * point: this schema is the one place that decides what the tools honour, and
 * tests/mcp/tool-schemas-match-what-the-server-honours.test.ts fails if it and
 * the advertised tool schema ever disagree in either direction.
 */
const CreateTaskSchema = z.object({
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
  repeating: z.enum(["never", "daily", "weekly", "monthly", "yearly", "custom"]).default("never"),
  repeatingData: RepeatingDataSchema,
  repeatFrom: z.enum(["DUE_DATE", "COMPLETION_DATE"]).optional(),
}).strict()

const UpdateTaskSchema = z.object({
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
  repeating: z.enum(["never", "daily", "weekly", "monthly", "yearly", "custom"]).optional(),
  repeatingData: RepeatingDataSchema,
  repeatFrom: z.enum(["DUE_DATE", "COMPLETION_DATE"]).optional(),
}).strict()

const CreateCommentSchema = z.object({
  taskId: z.string(),
  content: z.string().min(1),
  type: z.enum(["TEXT", "MARKDOWN", "ATTACHMENT"]).default("TEXT"),
  parentCommentId: z.string().optional(),
  attachmentUrl: z.string().optional(),
  attachmentName: z.string().optional(),
  attachmentType: z.string().optional(),
  attachmentSize: z.number().optional(),
})

const CreateAttachmentSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  type: z.string().min(1),
  size: z.number().min(0),
})

module.exports = {
  RepeatingDataSchema,
  CreateTaskSchema,
  UpdateTaskSchema,
  CreateCommentSchema,
  CreateAttachmentSchema,
}

// Force this file to be a module (not a script) so its top-level `const`s
// don't collide with same-named consts in sibling mcp/*.ts files under the
// project's CommonJS-style require/module.exports usage.
export {}
