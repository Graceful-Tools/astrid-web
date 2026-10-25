/**
 * Prisma include shapes the task service reads and returns. Moved out of
 * services/task.service.ts to keep it inside its size budget
 * (tests/rules/oversized-files-ratchet.test.ts).
 */

import type { Prisma } from '@prisma/client'

/**
 * The relations every side effect below needs, and the richest shape any
 * surface returns. Only services/task.service.ts should import it, for the
 * reason TASK_ACCESS_INCLUDE stays private there: the SSE fan-out reads
 * `lists.listMembers`, and a caller that created with a thinner include would
 * silently broadcast to nobody.
 *
 * Surfaces narrow this for the wire themselves. They must: legacy's shape
 * carries `list.owner` and `listMembers.user` — whole user records, emails
 * included — and handing that to v1 or MCP verbatim would newly publish list
 * members' email addresses to API consumers that have never received them.
 * Same DB state everywhere, unchanged wire contracts.
 */
export const TASK_CREATE_INCLUDE = {
  assignee: true,
  creator: true,
  lists: {
    include: {
      owner: true,
      listMembers: { include: { user: true } },
    },
  },
  comments: { include: { author: true } },
  attachments: true,
} as const

export type CreatedTask = Prisma.TaskGetPayload<{ include: typeof TASK_CREATE_INCLUDE }>

/** The pre-update columns the event diff and the change rules read. */
export const TASK_UPDATE_EXISTING_INCLUDE = {
  lists: {
    select: {
      id: true,
      name: true,
      listType: true,
      privacy: true,
      publicListType: true,
      ownerId: true,
      listMembers: { select: { userId: true, role: true } },
    },
  },
} as const
