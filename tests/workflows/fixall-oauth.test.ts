import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = fs.readFileSync(
  path.join(process.cwd(), '.github/workflows/fixall.yml'),
  'utf8',
)

describe('fixall workflow OAuth authentication', () => {
  it('does not require the legacy MCP token that was empty in run 33584352851', () => {
    expect(workflow).not.toContain('ASTRID_MCP_TOKEN')
    expect(workflow).toContain('X-OAuth-Token')
  })
})
