import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

function requireEnvironment(name: 'TEST_DATABASE_URL'): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required to provision authenticated E2E state`)
  }
  return value
}

const databaseUrl = requireEnvironment('TEST_DATABASE_URL')
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

const prisma = new PrismaClient()
const authDirectory = path.resolve('.auth')

async function writeState(fileName: string, token: string) {
  await writeFile(
    path.join(authDirectory, fileName),
    JSON.stringify({
      cookies: [{
        name: 'next-auth.session-token',
        value: token,
        domain: 'localhost',
        path: '/',
        expires: Math.floor(Date.now() / 1000) + 60 * 60,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      }],
      origins: [],
    }, null, 2)
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
  const expires = new Date(Date.now() + 60 * 60 * 1000)
  const [ownerSession, outsiderSession] = await Promise.all([
    prisma.session.upsert({
      where: { sessionToken: 'playwright-owner-session' },
      update: { userId: owner.id, expires },
      create: { sessionToken: 'playwright-owner-session', userId: owner.id, expires },
    }),
    prisma.session.upsert({
      where: { sessionToken: 'playwright-outsider-session' },
      update: { userId: outsider.id, expires },
      create: { sessionToken: 'playwright-outsider-session', userId: outsider.id, expires },
    }),
  ])

  await Promise.all([
    writeState('user.json', ownerSession.sessionToken),
    writeState('outsider.json', outsiderSession.sessionToken),
  ])
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
