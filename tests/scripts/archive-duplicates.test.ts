import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const archiveDir = join(root, 'scripts/archive')

describe('script archive hygiene', () => {
  it('AWTD-hygiene does not keep byte-identical copies of active scripts', () => {
    const duplicates = readdirSync(archiveDir)
      .filter(name => statSync(join(archiveDir, name)).isFile())
      .filter(name => {
        const active = join(root, 'scripts', basename(name))
        return (
          existsSync(active) &&
          readFileSync(active).equals(readFileSync(join(archiveDir, name)))
        )
      })

    expect(duplicates).toEqual([])
  })

  it('0acc4d83 keeps only the manually reviewed divergent active/archive pairs', () => {
    const pairs = readdirSync(archiveDir)
      .filter(name => statSync(join(archiveDir, name)).isFile())
      .filter(name => existsSync(join(root, 'scripts', basename(name))))
      .sort()

    expect(pairs).toEqual([
      'create-specific-ai-agents.ts',
      'validate-secrets.ts',
    ])
  })
})
