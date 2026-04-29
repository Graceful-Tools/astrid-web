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

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.number().min(0).max(3).default(0),
  assigneeId: z.string().optional(),
  dueDateTime: z.string().datetime().optional(),
  isAllDay: z.boolean().optional(),
  reminderTime: z.string().datetime().optional(),
  reminderType: z.enum(["push", "email", "both"]).optional(),
  isPrivate: z.boolean().default(true),
  repeating: z.enum(["never", "daily", "weekly", "monthly", "yearly", "custom"]).default("never"),
  repeatingData: RepeatingDataSchema,
})

const UpdateTaskSchema = z.object({
  taskId: z.string(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.number().min(0).max(3).optional(),
  assigneeId: z.string().optional(),
  dueDateTime: z.string().datetime().optional(),
  isAllDay: z.boolean().optional(),
  reminderTime: z.string().datetime().optional(),
  reminderType: z.enum(["push", "email", "both"]).optional(),
  isPrivate: z.boolean().optional(),
  completed: z.boolean().optional(),
  repeating: z.enum(["never", "daily", "weekly", "monthly", "yearly", "custom"]).optional(),
  repeatingData: RepeatingDataSchema,
})

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
