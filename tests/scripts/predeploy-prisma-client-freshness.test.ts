/**
 * Task ea700455-896e-4629-ad09-3d6c3a0c64f7 — "🔴 Predeploy Failed: TypeScript"
 *
 * The reported type errors ("Property 'agentMailbox' does not exist on type
 * { ...MCPToken fields... }") were not a defect in lib/ — the schema declares
 * agentMailbox on all three models. tsc was reading a STALE generated Prisma
 * client, and the predeploy script guaranteed that outcome twice over:
 *
 *   1. TypeScript ran first; the Prisma Client check, whose auto-fix is
 *      `npx prisma generate`, ran ten checks later — far too late to rescue it.
 *   2. That check's command was `node -e "require('@prisma/client')"`, which
 *      succeeds against any generated client, fresh or stale, so it never fired
 *      its own auto-fix either.
 *
 * Net effect: every schema change filed a false-alarm "Predeploy Failed:
 * TypeScript" task that was already fixed by the time a human opened it.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getChecks } from '@/scripts/predeploy-self-healing'
import { isPrismaClientStale } from '@/scripts/lib/prisma-client-freshness'

describe('predeploy check order (task ea700455)', () => {
  const names = getChecks().map((check) => check.name)

  it('generates the Prisma client before type-checking against it', () => {
    const prismaIndex = names.indexOf('Prisma Client')
    const typescriptIndex = names.indexOf('TypeScript')

    expect(prismaIndex).toBeGreaterThanOrEqual(0)
    expect(typescriptIndex).toBeGreaterThanOrEqual(0)
    expect(prismaIndex).toBeLessThan(typescriptIndex)
  })

  it('detects a drifted client rather than merely requiring the package', () => {
    const prismaCheck = getChecks().find((check) => check.name === 'Prisma Client')!

    // `require('@prisma/client')` resolves against a stale client just fine,
    // which is exactly why the drift went unnoticed.
    expect(prismaCheck.command).not.toContain("require('@prisma/client')")
    expect(prismaCheck.autoFixable).toBe(true)
    expect(prismaCheck.fixCommand).toContain('prisma generate')
  })
})

describe('isPrismaClientStale (task ea700455)', () => {
  function workspace(): string {
    const dir = mkdtempSync(join(tmpdir(), 'prisma-freshness-'))
    mkdirSync(join(dir, 'prisma'), { recursive: true })
    mkdirSync(join(dir, 'node_modules/.prisma/client'), { recursive: true })
    return dir
  }

  const SCHEMA = [
    'model MCPToken {',
    '  id           String  @id',
    '  agentMailbox String?',
    '}',
    '',
  ].join('\n')

  it('is stale when the generated client is missing entirely', () => {
    const dir = workspace()
    writeFileSync(join(dir, 'prisma/schema.prisma'), SCHEMA)
    expect(isPrismaClientStale(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('is stale when the schema gained a field the generated client never saw', () => {
    const dir = workspace()
    writeFileSync(join(dir, 'prisma/schema.prisma'), SCHEMA)
    writeFileSync(
      join(dir, 'node_modules/.prisma/client/schema.prisma'),
      SCHEMA.replace('  agentMailbox String?\n', ''),
    )
    expect(isPrismaClientStale(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('is fresh when the two differ only by prisma format alignment', () => {
    const dir = workspace()
    writeFileSync(join(dir, 'prisma/schema.prisma'), SCHEMA)
    // `prisma generate` re-aligns the column padding in its stored copy; that
    // is the normal steady state, so a byte comparison would report drift on
    // every single run.
    writeFileSync(
      join(dir, 'node_modules/.prisma/client/schema.prisma'),
      SCHEMA.replace('  id           String  @id', '  id                 String @id').replace(
        '  agentMailbox String?',
        '  agentMailbox       String?   ',
      ),
    )
    expect(isPrismaClientStale(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('is fresh for this repository once the client has been generated', () => {
    expect(isPrismaClientStale(process.cwd())).toBe(false)
  })
})
