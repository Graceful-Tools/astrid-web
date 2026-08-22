import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflows = [
  '.github/workflows/preview-deployment.yml',
  '.github/workflows/production-deployment.yml',
]

describe('Prisma drift workflow', () => {
  it.each(workflows)('%s recognizes idempotent CREATE TABLE migrations', workflow => {
    const source = readFileSync(workflow, 'utf8')

    expect(source).toContain('CREATE TABLE (IF NOT EXISTS )?')
  })
})
