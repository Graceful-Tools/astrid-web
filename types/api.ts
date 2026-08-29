import type { CustomRepeatingPattern } from "./repeating"

// API request/response types
export interface CreateTaskData {
  title: string
  description?: string
  priority?: 0 | 1 | 2 | 3
  repeating?: "never" | "daily" | "weekly" | "monthly" | "yearly" | "custom"
  customRepeatingData?: CustomRepeatingPattern | null
  repeatFrom?: "DUE_DATE" | "COMPLETION_DATE"
  isPrivate?: boolean
  when?: Date  // DEPRECATED: Use dueDateTime + isAllDay instead
  dueDateTime?: Date
  isAllDay?: boolean  // Whether this is an all-day task (true = all-day, false = timed)
  reminderTime?: Date
  reminderType?: "none" | "push" | "email" | "both"
  listIds?: string[]
  assigneeId?: string
  assigneeEmail?: string // For assigning to non-registered users
  clientRequestId?: string // Idempotency key for dedup (8-128 chars)
  // Board column at creation — a ROLE, never a list id (tasks eb7fce2f,
  // f58ece7c); POST /api/v1/tasks persists it. Absence means Inbox.
  statusRole?: string
  attachments?: Array<{
    name: string
    url: string
    type: string
    size: number
  }>
}

export interface UpdateTaskData {
  title?: string
  description?: string
  priority?: 0 | 1 | 2 | 3
  repeating?: "never" | "daily" | "weekly" | "monthly" | "yearly"
  isPrivate?: boolean
  completed?: boolean
  when?: Date  // DEPRECATED: Use dueDateTime + isAllDay instead
  dueDateTime?: Date
  isAllDay?: boolean  // Whether this is an all-day task
  listIds?: string[]
  assigneeId?: string
  assigneeEmail?: string // For assigning to non-registered users
  localCompletionDate?: string // YYYY-MM-DD format, used for all-day repeating tasks with COMPLETION_DATE mode
}

export interface CreateListData {
  name: string
  description?: string
  color?: string
  imageUrl?: string
  projectId?: string | null
  listType?: "regular" | "status"
  statusRole?: "inbox" | "ready" | "doing" | "waiting" | "done" | "custom" | null
  statusOrder?: number | null
  statusDescription?: string | null
  statusCompleted?: boolean
  privacy: "PRIVATE" | "SHARED" | "PUBLIC"
  adminIds?: string[]
  memberIds?: string[]
  memberEmails?: string[]
  defaultAssigneeId?: string
  defaultPriority?: number
  defaultRepeating?: string
  defaultIsPrivate?: boolean
  defaultDueDate?: "none" | "today" | "tomorrow" | "next_week"
}

export interface CreateCommentData {
  content: string
  type?: "TEXT" | "MARKDOWN" | "ATTACHMENT"
  fileId?: string
  parentCommentId?: string
  clientRequestId?: string
}

export interface CopyTaskData {
  taskId: string
  targetListIds: string[]
  assigneeId?: string
}

export interface ApiResponse<T = any> {
  data?: T
  error?: string
  message?: string
}
