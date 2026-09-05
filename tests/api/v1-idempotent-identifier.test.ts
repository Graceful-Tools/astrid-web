/**
 * RED for task 5bcd426b.
 *
 * POST /api/v1/tasks has two create paths. The non-idempotent one minted the
 * human-readable AST-nnn identifier; the idempotent one — taken whenever the
 * caller sends a clientRequestId, which iOS always does — did not. So every
 * task created from the phone into a project had no identifier at all.
 *
 * This is a source-level check because the route is a 900-line handler with a
 * deep dependency graph; what matters is that the mint happens ABOVE the
 * branch, so neither path can miss it again.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'

const source = fs.readFileSync('app/api/v1/tasks/route.ts', 'utf8')

describe('v1 task create identifier minting', () => {
  it('mints exactly once, not once per branch', () => {
    const mints = source.match(/await allocateTaskIdentifier\(/g) ?? []

    expect(mints).toHaveLength(1)
  })

  it('mints before the idempotency branch, so both paths inherit it', () => {
    const mintAt = source.indexOf('await allocateTaskIdentifier(')
    const branchAt = source.indexOf('Idempotency: clientRequestId-based')

    expect(mintAt).toBeGreaterThan(-1)
    expect(branchAt).toBeGreaterThan(-1)
    expect(mintAt).toBeLessThan(branchAt)
  })

  it('writes the identifier in both create calls', () => {
    const writes = source.match(/identifier: minted\?\.identifier/g) ?? []

    expect(writes).toHaveLength(2)
  })
})
