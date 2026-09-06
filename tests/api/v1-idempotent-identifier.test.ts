/**
 * Regression guard for task 5bcd426b.
 *
 * POST /api/v1/tasks used to have two create paths. The non-idempotent one
 * minted the human-readable AST-nnn identifier; the idempotent one — taken
 * whenever the caller sends a clientRequestId, which iOS always does — did
 * not. So every task created from the phone into a project had no identifier
 * at all.
 *
 * The original fix hoisted the mint ABOVE the idempotency branch so neither
 * path could miss it. Extracting the CREATE verb (epic 9dedd8aa) removes the
 * branch instead: there is now exactly one create, in the service, and it is
 * reached by every surface. That also lets the mint move back BELOW the
 * idempotency return — which is strictly better, because minting above it
 * burned a project sequence number on every retry that created nothing.
 *
 * So this stays a structural check, retargeted at the service: the property
 * that matters is that there is only ONE place a create can happen, so there
 * is no second path to forget. The behaviour itself — a clientRequestId create
 * still gets its identifier — is asserted in tests/services/task-create-parity.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'

const service = fs.readFileSync('services/task.service.ts', 'utf8')
const v1Route = fs.readFileSync('app/api/v1/tasks/route.ts', 'utf8')

describe('task create identifier minting (task 5bcd426b, epic 9dedd8aa)', () => {
  it('mints exactly once, not once per branch', () => {
    const mints = service.match(/await allocateTaskIdentifier\(/g) ?? []

    expect(mints).toHaveLength(1)
  })

  it('has exactly one create for the mint to sit above', () => {
    // Two creates is how the identifier went missing the first time.
    const creates = service.match(/prisma\.task\.create\(/g) ?? []

    expect(creates).toHaveLength(1)
  })

  it('mints below the idempotency return, so a retry burns no sequence number', () => {
    const idempotencyAt = service.indexOf('Idempotency ')
    const mintAt = service.indexOf('await allocateTaskIdentifier(')

    expect(idempotencyAt).toBeGreaterThan(-1)
    expect(mintAt).toBeGreaterThan(idempotencyAt)
  })

  it('leaves the v1 route with no minting of its own to drift', () => {
    expect(v1Route).not.toMatch(/allocateTaskIdentifier/)
  })
})
