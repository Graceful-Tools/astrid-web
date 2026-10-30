import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createScriptPrisma } from './lib/script-prisma'
import { mintSessionToken, sessionStorageState } from '../e2e/utils/minted-session'

function requireEnvironment(name: 'TEST_DATABASE_URL' | 'NEXTAUTH_SECRET'): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required to provision authenticated E2E state`)
  }
  return value
}

const databaseUrl = requireEnvironment('TEST_DATABASE_URL')
const secret = requireEnvironment('NEXTAUTH_SECRET')
const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000'
const parsedUrl = new URL(databaseUrl)
const databaseName = parsedUrl.pathname.slice(1).toLowerCase()
if (
  !['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname) ||
  !databaseName.includes('test')
) {
  throw new Error(
    'TEST_DATABASE_URL must point to a localhost database whose name contains "test"'
  )
}

process.env.DATABASE_URL = databaseUrl
process.env.DATABASE_URL_DIRECT = databaseUrl

const prisma = createScriptPrisma()
const authDirectory = path.resolve('.auth')

// A NextAuth JWT, not a database Session row: the web UI only reads the JWT,
// so a Session-row cookie left the browser signed out (AWTD-1039).
async function writeState(fileName: string, user: Parameters<typeof mintSessionToken>[0]) {
  const token = await mintSessionToken(user, secret)
  await writeFile(
    path.join(authDirectory, fileName),
    JSON.stringify(sessionStorageState(token, baseURL), null, 2)
  )
}

async function main() {
  await mkdir(authDirectory, { recursive: true })

  const owner = await prisma.user.upsert({
    where: { email: 'playwright-owner@example.test' },
    update: { name: 'Playwright Owner', isActive: true },
    create: { email: 'playwright-owner@example.test', name: 'Playwright Owner' },
  })
  const outsider = await prisma.user.upsert({
    where: { email: 'playwright-outsider@example.test' },
    update: { name: 'Playwright Outsider', isActive: true },
    create: { email: 'playwright-outsider@example.test', name: 'Playwright Outsider' },
  })
  // A third seat, so a sharing journey can hold an editor and a read-only
  // viewer at once (AWTD-1405).
  const viewer = await prisma.user.upsert({
    where: { email: 'playwright-viewer@example.test' },
    update: { name: 'Playwright Viewer', isActive: true },
    create: { email: 'playwright-viewer@example.test', name: 'Playwright Viewer' },
  })

  // The board specs need Project Mode (AWTD-1338): /api/v1/projects/from-list
  // answers 403 "not enabled for this account" without it. The flag row exists
  // after `prisma migrate deploy`; the owner is INCLUDEd rather than rolling it
  // out to everyone, so the outsider still sees the account default.
  const projectMode = await prisma.featureFlag.findUnique({ where: { key: 'project_mode' } })
  if (projectMode) {
    await prisma.featureFlagTarget.upsert({
      where: { featureFlagId_userId: { featureFlagId: projectMode.id, userId: owner.id } },
      update: { treatment: 'INCLUDE' },
      create: { featureFlagId: projectMode.id, userId: owner.id, treatment: 'INCLUDE' },
    })
  }

  await Promise.all([
    writeState('user.json', owner),
    writeState('outsider.json', outsider),
    writeState('viewer.json', viewer),
  ])
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
