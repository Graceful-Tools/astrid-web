/**
 * Builders for the app-facing domain models in `types/task.ts`.
 *
 * WHY THESE EXIST (AWTD-916). `Task`, `TaskList` and `User` each have a
 * required core that a hand-written literal almost never spells out in full:
 * Task alone requires sixteen fields, including `creator`, `attachments`,
 * `comments`, `repeatFrom` and `occurrenceCount` — none of which a test about
 * due-date rendering has any opinion about. The test tree was excluded from
 * tsconfig, so those literals were never checked, and roughly a hundred of
 * them had drifted into objects that are not the type they are passed as.
 *
 * The point of a builder here is not brevity. It is that the REQUIRED fields
 * come from one place, so adding a required field to `Task` breaks this file
 * rather than a hundred literals — and a test keeps saying only the thing it
 * is about, in its overrides.
 *
 * These follow the `buildX(overrides)` shape already used by
 * `tests/fixtures/prisma.ts` and `tests/fixtures/auth.ts`. Those build Prisma
 * INPUT types; these build the client-side models, which is a different job.
 */
import type { Comment, Task, TaskList, User } from '@/types/task'

let sequence = 0
const next = () => (sequence += 1)

/** A fixed epoch, so a fixture never makes a test depend on "now". */
export const FIXTURE_DATE = new Date('2026-01-01T00:00:00.000Z')

export function buildUser(overrides: Partial<User> = {}): User {
  const n = next()
  return {
    id: `user-${n}`,
    name: `Fixture User ${n}`,
    email: `user-${n}@example.test`,
    image: null,
    createdAt: FIXTURE_DATE,
    ...overrides,
  }
}

export function buildTaskList(overrides: Partial<TaskList> = {}): TaskList {
  const n = next()
  const owner = overrides.owner ?? buildUser()
  return {
    id: `list-${n}`,
    name: `Fixture List ${n}`,
    privacy: 'PRIVATE',
    owner,
    ownerId: owner.id,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    ...overrides,
  }
}

export function buildTask(overrides: Partial<Task> = {}): Task {
  const n = next()
  const creator = overrides.creator ?? buildUser()
  return {
    id: `task-${n}`,
    title: `Fixture Task ${n}`,
    description: '',
    creator,
    creatorId: creator.id,
    repeating: 'never',
    repeatFrom: 'DUE_DATE',
    occurrenceCount: 0,
    priority: 0,
    lists: [],
    isPrivate: false,
    completed: false,
    attachments: [],
    comments: [],
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    ...overrides,
  }
}

export function buildComment(overrides: Partial<Comment> = {}): Comment {
  const n = next()
  const author = overrides.author ?? buildUser()
  return {
    id: `comment-${n}`,
    content: `Fixture comment ${n}`,
    type: 'TEXT',
    author,
    authorId: author?.id ?? null,
    taskId: 'task-1',
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    ...overrides,
  }
}
