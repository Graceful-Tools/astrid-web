/**
 * Priority is 0-3 EVERYWHERE, or it is 0-3 nowhere (task 17fea642).
 *
 * Four surfaces agree that a task's priority is one of 0, 1, 2, 3:
 *   mcp/schemas.ts            z.number().min(0).max(3)
 *   mcp/tool-definitions.ts   { minimum: 0, maximum: 3 }
 *   docs/API_CONTRACT.md      "0, 1, 2, 3"
 *   types/task.ts             priority: 0 | 1 | 2 | 3
 *
 * The v1 HTTP API agrees with none of them. lib/api-contracts/v1-request-
 * shapes.ts checks that priority is a finite NUMBER and stops there, so
 * `priority: 999` — or -1, or 2.5 — is written straight to an Int column.
 *
 * WHY THAT IS WORSE THAN IT SOUNDS. The TypeScript type is a lie the moment
 * such a row exists: every reader has been told priority is 0|1|2|3, so
 * lib/task-manager-utils.ts maps it to a colour by lookup and
 * lib/priority-glyph.ts to a glyph, with no branch for 999. The task is
 * created successfully, and then renders wrong forever. Meanwhile the same
 * task created through MCP is rejected at the door with a clear error — one
 * client is strict and the other silently accepts garbage.
 *
 * A FRACTION IS ALSO NOT A PRIORITY. Prisma will round or reject 2.5 depending
 * on the driver path; either way the caller did not get what they sent.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { validateV1TaskUpdate } from '@/lib/api-contracts/v1-request-shapes'

describe('v1 enforces the same priority range as every other surface (task 17fea642)', () => {
  it.each([0, 1, 2, 3])('accepts priority %i', p => {
    expect(validateV1TaskUpdate({ priority: p })).toEqual({ ok: true })
  })

  it('rejects a priority above the range', () => {
    const result = validateV1TaskUpdate({ priority: 999 })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/priority/)
  })

  it('rejects a negative priority', () => {
    expect(validateV1TaskUpdate({ priority: -1 }).ok).toBe(false)
  })

  it('rejects a fractional priority', () => {
    expect(validateV1TaskUpdate({ priority: 2.5 }).ok).toBe(false)
  })

  it('still rejects a non-number, and still allows priority to be omitted', () => {
    expect(validateV1TaskUpdate({ priority: 'high' }).ok).toBe(false)
    expect(validateV1TaskUpdate({ title: 'no priority here' })).toEqual({ ok: true })
  })

  it('states the range once, so MCP and v1 cannot drift apart again', () => {
    // The point of the shared constant: the next person to change the range
    // changes it in one place, and both surfaces move together.
    const mcpSchemas = readFileSync('mcp/schemas.ts', 'utf8')
    expect(mcpSchemas).toMatch(/MIN_TASK_PRIORITY|MAX_TASK_PRIORITY/)
  })
})
