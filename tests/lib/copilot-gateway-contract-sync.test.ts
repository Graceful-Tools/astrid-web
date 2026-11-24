/**
 * ADEV-244 / ADEV-245: the app and the Copilot gateway agree on one contract.
 *
 * The gateway is built from its own directory and cannot import the app, so it
 * keeps a byte-identical copy of the app's contract file. This fails the moment
 * one side changes without the other.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

describe('Copilot gateway contract (ADEV-244/ADEV-245)', () => {
  it('services/copilot-gateway/src/contract.ts is identical to lib/ai/providers/copilot-gateway-contract.ts', () => {
    const app = readFileSync('lib/ai/providers/copilot-gateway-contract.ts', 'utf8')
    const gateway = readFileSync('services/copilot-gateway/src/contract.ts', 'utf8')
    expect(gateway).toBe(app)
  })

  it('the contract is types only, so neither side pulls in the other at runtime', () => {
    const app = readFileSync('lib/ai/providers/copilot-gateway-contract.ts', 'utf8')
    expect(app).not.toMatch(/^\s*import\s/m)
    expect(app).not.toMatch(/^export\s+(const|function|class|let|var)\s/m)
  })
})
