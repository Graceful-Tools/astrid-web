export interface User {
  id: string
  name?: string | null
  email: string
  image?: string | null
  createdAt: Date
  defaultDueTime?: string // HH:MM format, defaults to "17:00"
  isPending?: boolean // For users who have been invited but haven't accepted yet
  isAIAgent?: boolean // Whether this user is an AI agent
  aiAgentType?: string | null // Type of AI agent ('coding_agent', etc.)
}

export interface ListMember {
  id: string
  listId: string
  userId: string
  role: string
  createdAt: Date
  updatedAt: Date
  user?: User // Optional to handle cases where user relation isn't included
}

export interface Project {
  id: string
  name: string
  description?: string | null
  color?: string
  imageUrl?: string | null
  ownerId: string
  owner?: User
  lists?: TaskList[]
  createdAt: Date
  updatedAt: Date
}

export interface TaskList {
  id: string
  name: string
  projectId?: string | null
  listType?: "regular" | "status" | null
  statusRole?: "inbox" | "ready" | "doing" | "waiting" | "done" | "custom" | null
  statusOrder?: number | null
  statusDescription?: string | null
  statusCompleted?: boolean | null
  color?: string
  imageUrl?: string | null
  coverImageUrl?: string | null
  privacy: "PRIVATE" | "SHARED" | "PUBLIC"
  publicListType?: string | null // 'read_only' or 'collaborative' for PUBLIC lists
  owner: User
  ownerId: string
  admins?: User[] // Can manage list settings and members
  members?: User[] // Can add, edit, and manage tasks on the list
  listMembers?: ListMember[] // New member management structure
  defaultAssignee?: User
  defaultAssigneeId?: string | null
  defaultPriority?: 0 | 1 | 2 | 3
  defaultRepeating?: "never" | "daily" | "weekly" | "monthly" | "yearly" | "custom"
  defaultIsPrivate?: boolean
  defaultDueDate?: "none" | "today" | "tomorrow" | "next_week"
  defaultDueTime?: string | null // HH:MM format, or null for "all day"
  mcpEnabled?: boolean // Whether MCP access is enabled for this list
  mcpAccessLevel?: "READ" | "WRITE" | "BOTH" // MCP access level

  // AI Coding Agent Configuration
  preferredAiProvider?: string | null // 'claude', 'openai'
  fallbackAiProvider?: string | null // backup AI provider
  githubRepositoryId?: string | null // target GitHub repository full name (e.g., 'user/repo')
  aiAgentsEnabled?: string[] | null // enabled agent types — always an array on the v1 wire (iOS/Mac decode it as [String])
  aiAgentConfig?: { enabledTypes: string[]; defaultAgentId: string | null } | null // full config; carries the per-list default agent
  createdAt: Date
  updatedAt: Date
  description?: string
  tasks?: Task[]
  
  // Favorites system
  isFavorite?: boolean
  favoriteOrder?: number | null
  
  // Virtual list filtering settings
  filterCompletion?: string | null // "completed", "incomplete", "all"
  // Per-list "Recently completed" window. null = legacy 24h default.
  // Shape: see lib/recently-completed-window.ts → RecentlyCompletedWindow.
  recentlyCompletedWindow?: unknown | null
  // Show subtasks inline in this list. Absent/null = show (the default).
  // Combined with the user's subtaskDisplay by lib/list-subtask-visibility.ts.
  showSubtasks?: boolean | null
  filterDueDate?: string | null // "all", "today", "overdue", "this_week", "this_month", "this_calendar_week", "this_calendar_month"
  filterAssignee?: string | null // "current_user", "unassigned", specific user ID, etc.
  filterAssignedBy?: string | null // "current_user", specific user ID, etc.
  filterRepeating?: string | null // "not_repeating", "daily", "weekly", "monthly", "yearly", "custom", "all"
  filterPriority?: string | null // "all", "0", "1", "2", "3" for priority levels
  filterInLists?: string | null // "dont_filter", "not_in_list", "in_list"
  isVirtual?: boolean // For virtual lists
  virtualListType?: string | null // "today", "not-in-list", "assigned" for predefined virtual lists
  sortBy?: string | null
  manualSortOrder?: string[] | null
}

export interface ListPermission {
  userId: string
  listId: string
  role: "owner" | "admin" | "member" | "viewer"
}

export interface Comment {
  id: string
  content: string
  type: "TEXT" | "MARKDOWN" | "ATTACHMENT"
  author: User | null
  authorId: string | null
  taskId: string
  createdAt: Date
  updatedAt: Date
  attachmentUrl?: string
  attachmentName?: string
  attachmentType?: string
  attachmentSize?: number
  parentCommentId?: string
  replies?: Comment[]
  secureFiles?: SecureFile[]
}

export interface Attachment {
  id: string
  name: string
  url: string
  type: string
  size: number
  createdAt: Date
  taskId: string
}

export interface SecureFile {
  id: string
  blobUrl: string
  originalName: string
  mimeType: string
  fileSize: number
  uploadedBy: string
  taskId?: string | null
  listId?: string | null
  commentId?: string | null
  /**
   * What the file was uploaded for: "message" (a comment or chat composer) |
   * "task" (the task form) | null on rows predating the field (task ded31696).
   */
  attachTarget?: string | null
  createdAt: Date
  updatedAt: Date
}

import type { CustomRepeatingPattern } from "./repeating"

export type RepeatFromMode = "DUE_DATE" | "COMPLETION_DATE"

export interface Task {
  id: string
  title: string
  description: string
  assignee?: User | null
  assigneeId?: string | null
  creator: User
  creatorId: string
  when?: Date // Legacy due date field - kept for backward compatibility
  dueDate?: Date | null // Legacy field - kept for backward compatibility
  dueDateTime?: Date | null // New field with full datetime support
  isAllDay?: boolean // Whether this is an all-day task (true = all-day, false = timed)
  reminderTime?: Date | null // When to send reminder notification
  reminderSent?: boolean // Track if reminder was sent
  reminderType?: "push" | "email" | "both" | null // Type of reminder to send
  repeating: "never" | "daily" | "weekly" | "monthly" | "yearly" | "custom"
  repeatingData?: CustomRepeatingPattern
  repeatFrom: RepeatFromMode // How to calculate next occurrence: from due date or completion date
  occurrenceCount: number // Number of times this repeating task has been completed
  timerDuration?: number | null // Duration in minutes for the task timer
  lastTimerValue?: string | null // Last completion details for the timer
  priority: 0 | 1 | 2 | 3
  lists: TaskList[]
  isPrivate: boolean
  completed: boolean
  /**
   * When the task was completed. Backdatable by sync, so it is the real stamp;
   * readers fall back to updatedAt when absent (lib/recently-completed-window.ts
   * set the convention). Null/undefined while the task is open.
   */
  completedAt?: Date | string | null
  /**
   * Why the task was closed, when it was not simply done (task 11042ae3):
   * "canceled" | "duplicate" | "not_planned". Null/undefined means completed
   * normally, or still open — so it renders nothing until someone uses it.
   */
  closedReason?: string | null
  /**
   * Board status as a state on the task (AWTD-562): ready | doing | waiting |
   * a project's custom role. Null/undefined means Inbox; Done is derived from
   * `completed`. Replaces membership in a status list.
   */
  statusRole?: string | null
  /** Legacy attachment rows. Only the MCP handlers write these. */
  attachments: Attachment[]
  /**
   * Secure files hung on the task. Includes the ones its comments carry (they
   * are uploaded with a `{ taskId }` context), so read this through
   * lib/task-attachments rather than directly — task-level means
   * `commentId === null` (task b4a362f1).
   */
  secureFiles?: SecureFile[]
  comments: Comment[]
  createdAt: Date
  updatedAt: Date
  originalTaskId?: string
  parentTaskId?: string | null // Subtasks: parent task id (nil = top-level)
  subtaskDepth?: number // Client-only: nesting depth annotated by the list splice
  sourceListId?: string // Which public list this was copied from
}

export type RepeatOption = {
  value: Task["repeating"]
  /** i18n key naming the resulting state, not a literal (task ab01186a). */
  labelKey: string
}

export type PriorityLevel = {
  value: Task["priority"]
  label: string
  color: string
}
