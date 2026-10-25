/**
 * Task AWTD-1369. Argument parsing for the re-encryption pass, kept pure and
 * tested because the alternative is finding a bad default while pointed at
 * production data.
 */
import { describe, it, expect } from 'vitest'
import { parseArgs } from '@/scripts/reencrypt-fields'

describe('reencrypt-fields parseArgs (AWTD-1369)', () => {
  it('writes only when neither --dry-run nor --verify is passed', () => {
    expect(parseArgs([])).toEqual({
      dryRun: false,
      verify: false,
      batchSize: 500,
      databaseUrlEnv: 'DATABASE_URL',
    })
  })

  it('recognises --dry-run and --verify', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true)
    expect(parseArgs(['--verify']).verify).toBe(true)
  })

  it('takes a batch size', () => {
    expect(parseArgs(['--batch-size', '50']).batchSize).toBe(50)
  })

  it('rejects a batch size that is not a usable integer', () => {
    // A NaN batch size makes `take: NaN` and Prisma returns nothing, so the
    // pass would report a clean sweep having read zero rows.
    for (const bad of ['0', '-1', 'abc', '5001', '1.5', '']) {
      expect(() => parseArgs(['--batch-size', bad])).toThrow(/batch-size/)
    }
    expect(() => parseArgs(['--batch-size'])).toThrow(/batch-size/)
  })
})

describe('reencrypt-fields target selection (AWTD-1369)', () => {
  it('defaults to DATABASE_URL', () => {
    expect(parseArgs([]).databaseUrlEnv).toBe('DATABASE_URL')
  })

  it('takes a named env var, so pointing at production is explicit', () => {
    // Exporting DATABASE_URL in the shell does not work: scripts/lib/load-env
    // loads .env.local with override:true and wins. Without this flag the
    // script would quietly use the local database.
    expect(parseArgs(['--database-url-env', 'DATABASE_URL_PROD']).databaseUrlEnv).toBe(
      'DATABASE_URL_PROD',
    )
  })

  it('rejects anything that is not an env var name', () => {
    for (const bad of ['', 'lower_case', 'postgresql://user@host/db', '--verify']) {
      expect(() => parseArgs(['--database-url-env', bad])).toThrow(/database-url-env/)
    }
    expect(() => parseArgs(['--database-url-env'])).toThrow(/database-url-env/)
  })
})
