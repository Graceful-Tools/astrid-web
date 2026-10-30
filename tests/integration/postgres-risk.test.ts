import { spawnSync } from 'node:child_process'
import { createCipheriv, randomBytes } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildListCreate,
  buildTaskCreate,
  buildUserCreate,
} from '@/tests/fixtures/prisma'

let prisma: PrismaClient
const runPrefix = `risk-integration-${process.pid}-${Date.now()}`

function requireSafeTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL
  if (!value) {
    throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests')
  }

  const url = new URL(value)
  const databaseName = url.pathname.slice(1).toLowerCase()
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (!isLocal || !databaseName.includes('test')) {
    throw new Error(
      'TEST_DATABASE_URL must point to a localhost database whose name contains "test"'
    )
  }
  return value
}

beforeAll(async () => {
  const databaseUrl = requireSafeTestDatabaseUrl()
  process.env.DATABASE_URL = databaseUrl
  process.env.DATABASE_URL_DIRECT = databaseUrl

  const { createScriptPrisma } = await import('@/scripts/lib/script-prisma')
  prisma = createScriptPrisma({ url: databaseUrl })
  await prisma.$connect()
})

afterAll(async () => {
  if (!prisma) return
  await prisma.task.deleteMany({ where: { title: { startsWith: runPrefix } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: runPrefix } } })
  await prisma.$disconnect()
})

describe('ephemeral PostgreSQL risk behavior', () => {
  it('has applied the real Prisma migration history', async () => {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
    `
    expect(Number(rows[0]?.count)).toBeGreaterThan(0)
  })

  // AWTD-1199: three schema changes had reached production without a migration,
  // so a database built from the chain was not the one schema.prisma describes.
  // This database was just built by `prisma migrate deploy`, which makes it the
  // one place the two can be compared for real.
  it('is exactly the database schema.prisma describes (AWTD-1199)', () => {
    const diff = spawnSync(
      'npx',
      [
        'prisma', 'migrate', 'diff',
        // Prisma 7: the database is prisma.config.ts's datasource, which reads
        // the DATABASE_URL_DIRECT this suite set in beforeAll (AWTD-1408).
        '--from-config-datasource',
        '--to-schema', 'prisma/schema.prisma',
        '--script',
        '--exit-code',
      ],
      { encoding: 'utf8' },
    )

    // --exit-code: 0 is empty, 2 is a difference, 1 is an error. The SQL is the
    // message, so a failure names the drift instead of just reporting it.
    expect(`${diff.stdout}${diff.stderr}`.trim() + `\n(exit ${diff.status})`).toMatch(/\(exit 0\)$/)
  })

  it('rolls back a failed transaction and preserves unique constraints', async () => {
    const email = `${runPrefix}-transaction@example.test`

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.create({ data: buildUserCreate({ email }) })
        await tx.user.create({ data: buildUserCreate({ email }) })
      })
    ).rejects.toMatchObject({ code: 'P2002' })

    await expect(prisma.user.count({ where: { email } })).resolves.toBe(0)
  })

  it('cascades task children when their parent is deleted', async () => {
    const owner = await prisma.user.create({
      data: buildUserCreate({ email: `${runPrefix}-cascade@example.test` }),
    })
    const list = await prisma.taskList.create({ data: buildListCreate(owner.id) })
    const task = await prisma.task.create({
      data: buildTaskCreate(owner.id, list.id, { title: `${runPrefix}-cascade-task` }),
    })
    const comment = await prisma.comment.create({
      data: { taskId: task.id, authorId: owner.id, content: 'cascade sentinel' },
    })

    await prisma.task.delete({ where: { id: task.id } })

    await expect(prisma.comment.findUnique({ where: { id: comment.id } })).resolves.toBeNull()
  })

  // AWTD-1090: removeUserStatus filtered `task.updateMany({ where: { listId } })`
  // on a model with no listId. The unit test mocked Prisma and asserted that
  // shape, so only a real client could show that every status delete failed.
  it('deletes a custom board status against the real schema', async () => {
    const owner = await prisma.user.create({
      data: buildUserCreate({ email: `${runPrefix}-status@example.test` }),
    })
    const project = await prisma.project.create({
      data: {
        name: `${runPrefix}-board`,
        color: '#3b82f6',
        ownerId: owner.id,
        customStates: [{ role: 'custom-blocked', name: 'Blocked', order: 0 }],
      },
    })
    const list = await prisma.taskList.create({
      data: buildListCreate(owner.id, { project: { connect: { id: project.id } } }),
    })
    const inColumn = await prisma.task.create({
      data: buildTaskCreate(owner.id, list.id, {
        title: `${runPrefix}-in-column`,
        statusRole: 'custom-blocked',
      }),
    })
    const doneFromColumn = await prisma.task.create({
      data: buildTaskCreate(owner.id, list.id, {
        title: `${runPrefix}-done-from-column`,
        completed: true,
        statusRoleBeforeDone: 'custom-blocked',
      }),
    })

    const { removeUserStatus } = await import('@/lib/projects-service')
    const result = await removeUserStatus(owner.id, 'custom-blocked', project.id)

    expect(result).not.toHaveProperty('error')
    await expect(
      prisma.task.findUnique({ where: { id: inColumn.id }, select: { statusRole: true } }),
    ).resolves.toEqual({ statusRole: null })
    await expect(
      prisma.task.findUnique({ where: { id: doneFromColumn.id }, select: { statusRoleBeforeDone: true } }),
    ).resolves.toEqual({ statusRoleBeforeDone: null })
    await expect(
      prisma.project.findUnique({ where: { id: project.id }, select: { customStates: true } }),
    ).resolves.toEqual({ customStates: [] })
  })

  it('round-trips JSON and representative nested membership query shapes', async () => {
    const owner = await prisma.user.create({
      data: buildUserCreate({ email: `${runPrefix}-owner@example.test` }),
    })
    const member = await prisma.user.create({
      data: buildUserCreate({ email: `${runPrefix}-member@example.test` }),
    })
    const repeatingData = { unit: 'week', interval: 2, weekdays: ['MON', 'FRI'] }
    const list = await prisma.taskList.create({
      data: {
        ...buildListCreate(owner.id),
        listMembers: { create: { userId: member.id, role: 'member' } },
      },
    })
    const task = await prisma.task.create({
      data: buildTaskCreate(owner.id, list.id, {
        title: `${runPrefix}-query-task`,
        repeating: 'custom',
        repeatingData,
      }),
    })

    const visible = await prisma.task.findMany({
      where: {
        id: task.id,
        lists: { some: { listMembers: { some: { userId: member.id } } } },
      },
      select: {
        id: true,
        repeatingData: true,
        lists: { select: { id: true, listMembers: { select: { userId: true, role: true } } } },
      },
    })

    expect(visible).toEqual([
      {
        id: task.id,
        repeatingData,
        lists: [
          {
            id: list.id,
            listMembers: [{ userId: member.id, role: 'member' }],
          },
        ],
      },
    ])
  })
})

// AWTD-1328: per-run UI-test accounts. Four runners shared one account and every mint wiped it, so
// one run deleted another's data mid-test. These pin the isolation against a real database, since
// the whole risk is in which rows the raw DELETEs reach.
describe('per-run UI-test accounts (AWTD-1328)', () => {
  const runA = `pg${process.pid}-a`
  const runB = `pg${process.pid}-b`

  afterAll(async () => {
    const { deleteUITestRun } = await import('@/lib/uitest-run-accounts')
    await deleteUITestRun(prisma, runA)
    await deleteUITestRun(prisma, runB)
  })

  /** Every row a run's two accounts hold, counted the way --delete-run must clear them. */
  async function holdings(userIds: string[]) {
    const [tasks, lists, projects, comments, members] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n FROM "Task" WHERE "creatorId" = ANY($1::text[])`, userIds),
      prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n FROM "TaskList" WHERE "ownerId" = ANY($1::text[])`, userIds),
      prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n FROM "Project" WHERE "ownerId" = ANY($1::text[])`, userIds),
      prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n FROM "Comment" WHERE "authorId" = ANY($1::text[])`, userIds),
      prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n FROM "ListMember" WHERE "userId" = ANY($1::text[])`, userIds),
    ])
    const n = (rows: Array<{ n: bigint }>) => Number(rows[0].n)
    return { tasks: n(tasks), lists: n(lists), projects: n(projects), comments: n(comments), members: n(members) }
  }

  it('mints every fixture the E2E journeys need, readable as the app reads them', async () => {
    const { mintUITestRun } = await import('@/lib/uitest-run-accounts')
    const run = await mintUITestRun(prisma, runA, new Date('2026-10-22T15:00:00Z'))

    expect(run.user.email).toMatch(new RegExp(`^uitest\\+${runA}@`))
    expect(run.tasks.classic).toHaveLength(5)
    expect(run.tasks.dueToday.dueDateTime).toBe('2026-10-22T09:00:00.000Z')

    const board = await prisma.taskList.findUniqueOrThrow({
      where: { id: run.lists.board.id }, select: { projectId: true },
    })
    expect(board.projectId).toBe(run.lists.board.projectId)

    const doing = await prisma.task.findUniqueOrThrow({
      where: { id: run.tasks.boardDoing.id }, select: { statusRole: true },
    })
    expect(doing.statusRole).toBe('doing')

    const repeating = await prisma.task.findUniqueOrThrow({
      where: { id: run.tasks.dailyRepeating.id },
      select: { repeating: true, repeatFrom: true, isAllDay: true },
    })
    expect(repeating).toEqual({ repeating: 'daily', repeatFrom: 'DUE_DATE', isAllDay: true })

    const noList = await prisma.task.findUniqueOrThrow({
      where: { id: run.tasks.noList.id }, select: { lists: { select: { id: true } } },
    })
    expect(noList.lists).toEqual([])

    const comments = await prisma.comment.findMany({
      where: { taskId: run.tasks.withComment.id }, select: { id: true },
    })
    expect(comments).toEqual([{ id: run.tasks.withComment.commentId }])

    const seat = await prisma.listMember.findUniqueOrThrow({
      where: { listId_userId: { listId: run.lists.shared.id, userId: run.user.id } },
      select: { role: true, list: { select: { ownerId: true } } },
    })
    expect(seat).toEqual({ role: 'viewer', list: { ownerId: run.owner.id } })
  })

  it('is idempotent for the same run id: same accounts, one copy of each fixture', async () => {
    const { mintUITestRun } = await import('@/lib/uitest-run-accounts')
    const first = await mintUITestRun(prisma, runA)
    const before = await holdings([first.user.id, first.owner.id])
    const second = await mintUITestRun(prisma, runA)

    expect(second.user.id).toBe(first.user.id)
    expect(second.owner.id).toBe(first.owner.id)
    expect(await holdings([second.user.id, second.owner.id])).toEqual(before)
    // 5 classic + 2 board cards + due today + repeating + commented + no list + shared.
    expect(before).toEqual({ tasks: 12, lists: 3, projects: 1, comments: 1, members: 1 })
  })

  it('a mint for run A does not touch run B, and deleting A leaves nothing of A and all of B', async () => {
    const { mintUITestRun, deleteUITestRun } = await import('@/lib/uitest-run-accounts')
    const b = await mintUITestRun(prisma, runB)
    const bBefore = await holdings([b.user.id, b.owner.id])

    const a = await mintUITestRun(prisma, runA)
    expect(await holdings([b.user.id, b.owner.id])).toEqual(bBefore)

    expect(await deleteUITestRun(prisma, runA)).toBe(2)
    expect(await holdings([a.user.id, a.owner.id])).toEqual({
      tasks: 0, lists: 0, projects: 0, comments: 0, members: 0,
    })
    const users = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "User" WHERE id = ANY($1::text[])`, [a.user.id, a.owner.id])
    expect(users).toEqual([])
    expect(await holdings([b.user.id, b.owner.id])).toEqual(bBefore)
  })

  it('reaps a run only once every one of its accounts has gone quiet', async () => {
    const { mintUITestRun, findStaleUITestRuns } = await import('@/lib/uitest-run-accounts')
    const b = await mintUITestRun(prisma, runB)
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000)

    await prisma.$executeRawUnsafe(`UPDATE "User" SET "updatedAt" = $1 WHERE id = $2`, old, b.owner.id)
    expect(await findStaleUITestRuns(prisma, 24)).not.toContain(runB)

    await prisma.$executeRawUnsafe(`UPDATE "User" SET "updatedAt" = $1 WHERE id = $2`, old, b.user.id)
    expect(await findStaleUITestRuns(prisma, 24)).toContain(runB)
  })

  it('refuses to empty an account that is not a run account, however it is reached', async () => {
    const { deleteUITestRun } = await import('@/lib/uitest-run-accounts')
    await expect(deleteUITestRun(prisma, 'not a run id')).rejects.toThrow(/Invalid UI-test run id/)
  })
})

// AWTD-1380: the ENCRYPTION_KEY rotation pass, proved the way #524 asked for —
// rows seeded under an old key, then verify-before / dry run / rewrite /
// verify-after / read-back through the app's own readers. Unit tests stub the
// database, and the database is where a missed store or a lost write shows up.
describe('re-encryption pass against a real database (AWTD-1380)', () => {
  const OLD = randomBytes(32).toString('hex')
  const NEW = randomBytes(32).toString('hex')
  const saved = { key: process.env.ENCRYPTION_KEY, next: process.env.ENCRYPTION_KEY_NEXT }

  function ring(primary: string, next?: string) {
    process.env.ENCRYPTION_KEY = primary
    if (next) process.env.ENCRYPTION_KEY_NEXT = next
    else delete process.env.ENCRYPTION_KEY_NEXT
  }

  const options = (o: { dryRun?: boolean; verify?: boolean } = {}) => ({
    dryRun: false,
    verify: false,
    batchSize: 2, // small, so paging across batches is exercised too
    databaseUrlEnv: 'DATABASE_URL',
    ...o,
  })

  function legacyCbc(plaintext: string, keyHex: string) {
    const iv = randomBytes(16)
    const cipher = createCipheriv('aes-256-cbc', Buffer.from(keyHex, 'hex'), iv)
    return { encrypted: cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex'), iv: iv.toString('hex') }
  }

  afterAll(() => {
    if (saved.key === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = saved.key
    if (saved.next === undefined) delete process.env.ENCRYPTION_KEY_NEXT
    else process.env.ENCRYPTION_KEY_NEXT = saved.next
  })

  it('moves columns AND mcpSettings credentials from the old key to the new one', async () => {
    const fe = await import('@/lib/field-encryption')
    const cc = await import('@/lib/ai/credential-cipher')
    const { reencrypt } = await import('@/scripts/reencrypt-fields')

    ring(OLD)
    const mcpSettings = JSON.stringify({
      apiKeys: {
        claude: { ...cc.encryptCredential('sk-ant-db'), isValid: true },
        openai: legacyCbc('sk-openai-db', OLD),
        openclaw: {
          ...cc.encryptCredential('wss://gateway.example'),
          isGateway: true,
          authToken: cc.encryptCredential('gw-db-token'),
        },
      },
      modelPreferences: { claude: 'kept-as-is' },
    })
    const user = await prisma.user.create({
      data: buildUserCreate({ email: `${runPrefix}-reencrypt@example.test`, mcpSettings }),
    })
    const contact = await prisma.addressBookContact.create({
      data: {
        userId: user.id,
        email: `${runPrefix}-contact@example.test`,
        name: fe.encryptField('Ada Lovelace'),
        phoneNumber: fe.encryptField('0771 123 4567'),
      },
    })
    // 2 contact columns + claude + openai + openclaw URL + openclaw authToken
    const seeded = 6

    // verify-before: the new key alone cannot read what the old key wrote.
    ring(NEW)
    expect((await reencrypt(prisma, options({ verify: true }))).failed).toBeGreaterThanOrEqual(seeded)

    // Mid-rotation: ENCRYPTION_KEY is still the old key, NEXT the new one.
    ring(OLD, NEW)
    const dry = await reencrypt(prisma, options({ dryRun: true }))
    expect(dry.failed).toBe(0)
    expect(dry.rewritten).toBeGreaterThanOrEqual(seeded)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mcpSettings).toBe(mcpSettings)

    const rewrite = await reencrypt(prisma, options())
    expect(rewrite).toMatchObject({ failed: 0, conflicts: 0 })

    // verify-after, the finish line: the new key alone reads everything.
    ring(NEW)
    expect((await reencrypt(prisma, options({ verify: true }))).failed).toBe(0)

    // Read back through the app's own readers, under the new key only.
    const stored = JSON.parse((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mcpSettings!)
    expect(cc.decryptCredential(stored.apiKeys.claude)).toBe('sk-ant-db')
    expect(cc.decryptCredential(stored.apiKeys.openai)).toBe('sk-openai-db')
    expect(cc.decryptCredential(stored.apiKeys.openclaw)).toBe('wss://gateway.example')
    expect(cc.decryptCredential(stored.apiKeys.openclaw.authToken)).toBe('gw-db-token')
    expect(stored.apiKeys.claude.isValid).toBe(true)
    expect(stored.apiKeys.openclaw.isGateway).toBe(true)
    expect(stored.modelPreferences).toEqual({ claude: 'kept-as-is' })

    const row = await prisma.addressBookContact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(fe.decryptField(row.name)).toBe('Ada Lovelace')
    expect(fe.decryptField(row.phoneNumber)).toBe('0771 123 4567')
  })

  it('never overwrites a credential the app refreshed mid-pass — it is counted as a conflict', async () => {
    const cc = await import('@/lib/ai/credential-cipher')
    const { reencrypt } = await import('@/scripts/reencrypt-fields')

    ring(OLD)
    const user = await prisma.user.create({
      data: buildUserCreate({
        email: `${runPrefix}-reencrypt-race@example.test`,
        mcpSettings: JSON.stringify({ apiKeys: { claude: cc.encryptCredential('sk-stale') } }),
      }),
    })

    ring(OLD, NEW)
    // What the credentials route writes when the user saves a new key: under
    // the current key, between the pass's read and its write.
    const refreshed = JSON.stringify({ apiKeys: { claude: cc.encryptCredential('sk-fresh') } })
    let raced = false
    const racingUser = {
      findMany: async (args: Parameters<typeof prisma.user.findMany>[0]) => {
        const rows = await prisma.user.findMany(args)
        if (!raced && rows.some(r => r.id === user.id)) {
          raced = true
          await prisma.user.update({ where: { id: user.id }, data: { mcpSettings: refreshed } })
        }
        return rows
      },
      updateMany: (args: Parameters<typeof prisma.user.updateMany>[0]) => prisma.user.updateMany(args),
    }
    const racing = new Proxy(prisma, {
      get: (target, prop) => (prop === 'user' ? racingUser : Reflect.get(target, prop)),
    })

    const outcome = await reencrypt(racing, options())
    expect(raced).toBe(true)
    expect(outcome.conflicts).toBeGreaterThanOrEqual(1)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mcpSettings).toBe(refreshed)

    await prisma.user.delete({ where: { id: user.id } })
  })

  it('reports a credential no key decrypts, leaves it exactly as stored, and the pass reads failed', async () => {
    const cc = await import('@/lib/ai/credential-cipher')
    const { reencrypt } = await import('@/scripts/reencrypt-fields')

    ring(randomBytes(32).toString('hex')) // a key nobody holds any more
    const mcpSettings = JSON.stringify({ apiKeys: { gemini: cc.encryptCredential('sk-orphan') } })
    const user = await prisma.user.create({
      data: buildUserCreate({ email: `${runPrefix}-reencrypt-orphan@example.test`, mcpSettings }),
    })

    ring(OLD, NEW)
    const outcome = await reencrypt(prisma, options())
    expect(outcome.failed).toBeGreaterThanOrEqual(1)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mcpSettings).toBe(mcpSettings)

    await prisma.user.delete({ where: { id: user.id } })
  })
})
