import type { Prisma } from '@prisma/client'
import { DEFAULT_LIST_COLOR } from '@/lib/brand/colors'

let sequence = 0

function nextSuffix(): string {
  sequence += 1
  return `${process.pid}-${Date.now()}-${sequence}`
}

export function buildUserCreate(
  overrides: Partial<Prisma.UserCreateInput> = {}
): Prisma.UserCreateInput {
  const suffix = nextSuffix()
  return {
    email: `risk-${suffix}@example.test`,
    name: `Risk fixture ${suffix}`,
    ...overrides,
  }
}

export function buildListCreate(
  ownerId: string,
  overrides: Partial<Prisma.TaskListCreateInput> = {}
): Prisma.TaskListCreateInput {
  return {
    name: `Risk list ${nextSuffix()}`,
    // Required since task 518ec534 dropped the database default; tests/** is
    // outside tsconfig, so the compiler cannot catch a missing colour here.
    color: DEFAULT_LIST_COLOR,
    owner: { connect: { id: ownerId } },
    ...overrides,
  }
}

export function buildTaskCreate(
  creatorId: string,
  listId: string,
  overrides: Partial<Prisma.TaskCreateInput> = {}
): Prisma.TaskCreateInput {
  return {
    title: `Risk task ${nextSuffix()}`,
    creator: { connect: { id: creatorId } },
    lists: { connect: { id: listId } },
    ...overrides,
  }
}
