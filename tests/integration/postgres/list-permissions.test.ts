import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  PROJECT_ACCESS_INCLUDE,
  canUserEditTasks,
  getUserRoleInList,
  listReadByIdWhere,
  listVisibilityWhere,
} from '@/lib/list-permissions'
import { buildListCreate, buildUserCreate } from '@/tests/fixtures/prisma'
import { cleanupPrefix, connectAppPrisma, runPrefix } from './support/db'

/**
 * ADEV-294: the membership and permission queries behind lib/list-permissions.ts,
 * run against real rows: owner, admin, member, viewer, project member, public, stranger.
 * A mocked client only echoes the `where` we wrote; here Postgres decides who matches.
 */
let prisma: PrismaClient
const prefix = runPrefix('perms')

type Users = Record<'owner' | 'admin' | 'member' | 'viewer' | 'projectMember' | 'stranger', { id: string }>
let users: Users
let privateList: { id: string }
let publicList: { id: string }
let projectList: { id: string }

beforeAll(async () => {
  prisma = await connectAppPrisma()
  const make = (name: string) =>
    prisma.user.create({ data: buildUserCreate({ email: `${prefix}-${name}@example.test` }) })
  users = {
    owner: await make('owner'),
    admin: await make('admin'),
    member: await make('member'),
    viewer: await make('viewer'),
    projectMember: await make('project-member'),
    stranger: await make('stranger'),
  }

  const created = await prisma.taskList.create({
    data: {
      ...buildListCreate(users.owner.id),
      listMembers: {
        create: [
          { userId: users.admin.id, role: 'admin' },
          { userId: users.member.id, role: 'member' },
          { userId: users.viewer.id, role: 'viewer' },
        ],
      },
    },
  })
  privateList = created
  publicList = await prisma.taskList.create({
    data: buildListCreate(users.owner.id, { privacy: 'PUBLIC', publicListType: 'copy_only' }),
  })
  const project = await prisma.project.create({
    data: {
      name: `${prefix}-project`,
      color: '#3b82f6',
      ownerId: users.owner.id,
      members: { create: { userId: users.projectMember.id, role: 'member' } },
    },
  })
  projectList = await prisma.taskList.create({
    data: buildListCreate(users.owner.id, { project: { connect: { id: project.id } } }),
  })
})

afterAll(async () => {
  if (prisma) {
    await cleanupPrefix(prisma, prefix)
    await prisma.$disconnect()
  }
})

/** Which of the three seeded lists the visibility clause returns for a user. */
async function visibleTo(userId: string, options: Parameters<typeof listVisibilityWhere>[1]) {
  const rows = await prisma.taskList.findMany({
    where: {
      id: { in: [privateList.id, publicList.id, projectList.id] },
      ...listVisibilityWhere(userId, options),
    },
    select: { id: true },
  })
  return new Set(rows.map(row => row.id))
}

describe('list visibility against real rows (ADEV-294)', () => {
  it('shows the owner every list they own', async () => {
    const ids = await visibleTo(users.owner.id, { includePublic: false })
    expect(ids).toEqual(new Set([privateList.id, publicList.id, projectList.id]))
  })

  it.each(['admin', 'member', 'viewer'] as const)(
    'shows a %s only the list they hold a seat on',
    async role => {
      const ids = await visibleTo(users[role].id, { includePublic: false })
      expect(ids).toEqual(new Set([privateList.id]))
    },
  )

  it('shows a project member the project list, and nothing else private', async () => {
    const ids = await visibleTo(users.projectMember.id, { includePublic: false })
    expect(ids).toEqual(new Set([projectList.id]))
  })

  it('shows a non-member nothing, unless public lists are asked for', async () => {
    expect(await visibleTo(users.stranger.id, { includePublic: false })).toEqual(new Set())
    expect(await visibleTo(users.stranger.id, { includePublic: true })).toEqual(new Set([publicList.id]))
  })

  it('drops a viewer seat from write checks but keeps an admin one', async () => {
    expect(await visibleTo(users.viewer.id, { includePublic: false, excludeViewers: true })).toEqual(new Set())
    expect(await visibleTo(users.member.id, { includePublic: false, excludeViewers: true })).toEqual(
      new Set([privateList.id]),
    )
  })

  it('opens a public list by id to a stranger but not the private one (listReadByIdWhere)', async () => {
    const rows = await prisma.taskList.findMany({
      where: { id: { in: [privateList.id, publicList.id] }, ...listReadByIdWhere(users.stranger.id) },
      select: { id: true },
    })
    expect(rows.map(r => r.id)).toEqual([publicList.id])
  })
})

describe('role resolution on lists loaded from the database (ADEV-294)', () => {
  async function load(id: string) {
    const list = await prisma.taskList.findUniqueOrThrow({
      where: { id },
      include: { listMembers: true, ...PROJECT_ACCESS_INCLUDE },
    })
    return list as unknown as Parameters<typeof getUserRoleInList>[1]
  }

  it('resolves owner, admin, member and viewer from ListMember rows', async () => {
    const list = await load(privateList.id)
    expect(getUserRoleInList(users.owner, list)).toBe('owner')
    expect(getUserRoleInList(users.admin, list)).toBe('admin')
    expect(getUserRoleInList(users.member, list)).toBe('member')
    expect(getUserRoleInList(users.viewer, list)).toBe('viewer')
    expect(getUserRoleInList(users.stranger, list)).toBeNull()
  })

  it('lets members edit tasks, but not viewers or strangers', async () => {
    const list = await load(privateList.id)
    expect(canUserEditTasks(users.member, list)).toBe(true)
    expect(canUserEditTasks(users.viewer, list)).toBe(false)
    expect(canUserEditTasks(users.stranger, list)).toBe(false)
  })

  it('gives a stranger read-only viewer access to a public list', async () => {
    const list = await load(publicList.id)
    expect(getUserRoleInList(users.stranger, list)).toBe('viewer')
    expect(canUserEditTasks(users.stranger, list)).toBe(false)
  })

  it('cascades project membership to the project list', async () => {
    const list = await load(projectList.id)
    expect(getUserRoleInList(users.projectMember, list)).toBe('member')
    expect(getUserRoleInList(users.stranger, list)).toBeNull()
  })
})
